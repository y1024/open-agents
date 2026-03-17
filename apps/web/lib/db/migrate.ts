import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { readMigrationFiles } from "drizzle-orm/migrator";
import postgres from "postgres";

const MIGRATIONS_FOLDER = "./lib/db/migrations";
const MIGRATIONS_SCHEMA = "drizzle";
const MIGRATIONS_TABLE = "__drizzle_migrations";
const MAX_CONNECTION_ATTEMPTS = 6;
const INITIAL_RETRY_DELAY_MS = 1_000;

const CONNECTION_URL_ENV_KEYS = [
  "DATABASE_URL_UNPOOLED",
  "POSTGRES_URL_NON_POOLING",
  "POSTGRES_PRISMA_URL",
  "POSTGRES_URL",
  "DATABASE_URL",
] as const;

const LEGACY_IGNORABLE_ERROR_CODES = new Set([
  "42P01", // undefined_table
  "42P06", // duplicate_schema
  "42P07", // duplicate_table / duplicate_relation
  "42701", // duplicate_column
  "42703", // undefined_column
  "42710", // duplicate_object
]);

const RETRYABLE_CONNECTION_ERROR_CODES = new Set([
  "EAI_AGAIN",
  "ECONNREFUSED",
  "ECONNRESET",
  "ENOTFOUND",
  "ESERVFAIL",
  "ETIMEDOUT",
]);

type MigrationFile = {
  sql: string[];
  bps: boolean;
  folderMillis: number;
  hash: string;
};

type ErrorWithCause = {
  code?: string;
  message?: string;
  cause?: unknown;
};

type DatabaseConnectionConfig = {
  envKey: (typeof CONNECTION_URL_ENV_KEYS)[number];
  url: string;
};

function getDatabaseConnectionConfig(): DatabaseConnectionConfig | null {
  for (const envKey of CONNECTION_URL_ENV_KEYS) {
    const url = process.env[envKey];
    if (typeof url === "string" && url.length > 0) {
      return { envKey, url };
    }
  }

  return null;
}

function getErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) {
    return undefined;
  }

  const current = error as ErrorWithCause;
  if (typeof current.code === "string") {
    return current.code;
  }

  return getErrorCode(current.cause);
}

function getErrorMessage(error: unknown): string {
  if (typeof error !== "object" || error === null) {
    return String(error);
  }

  const current = error as ErrorWithCause;
  if (typeof current.message === "string") {
    return current.message;
  }

  if (current.cause) {
    return getErrorMessage(current.cause);
  }

  return "Unknown database error";
}

function isIgnorableLegacyError(error: unknown): boolean {
  const code = getErrorCode(error);
  return code ? LEGACY_IGNORABLE_ERROR_CODES.has(code) : false;
}

function isRetryableConnectionError(error: unknown): boolean {
  const code = getErrorCode(error);
  if (code && RETRYABLE_CONNECTION_ERROR_CODES.has(code)) {
    return true;
  }

  const message = getErrorMessage(error).toLowerCase();
  return (
    message.includes("getaddrinfo") || message.includes("temporary failure")
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function runMigrations(url: string): Promise<void> {
  const client = postgres(url, { max: 1 });
  const db = drizzle(client);

  async function ensureMigrationsTable(): Promise<void> {
    await client.unsafe(`CREATE SCHEMA IF NOT EXISTS "${MIGRATIONS_SCHEMA}"`);
    await client.unsafe(`
      CREATE TABLE IF NOT EXISTS "${MIGRATIONS_SCHEMA}"."${MIGRATIONS_TABLE}" (
        id SERIAL PRIMARY KEY,
        hash text NOT NULL,
        created_at bigint
      )
    `);
  }

  async function hasRecordedMigrations(): Promise<boolean> {
    const rows = await client.unsafe(`
      SELECT 1
      FROM "${MIGRATIONS_SCHEMA}"."${MIGRATIONS_TABLE}"
      LIMIT 1
    `);

    return rows.length > 0;
  }

  async function hasLegacySchemaWithoutHistory(): Promise<boolean> {
    const rows = (await client.unsafe(`
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'accounts'
      ) AS has_accounts
    `)) as Array<{ has_accounts?: boolean }>;

    return rows[0]?.has_accounts === true;
  }

  async function reconcileLegacySchema(): Promise<void> {
    console.log(
      "Detected existing schema without migration history. Reconciling migration records…",
    );

    const migrations = readMigrationFiles({
      migrationsFolder: MIGRATIONS_FOLDER,
    }) as MigrationFile[];

    for (const migration of migrations) {
      for (const statement of migration.sql) {
        const sql = statement.trim();
        if (!sql) {
          continue;
        }

        try {
          await client.unsafe(sql);
        } catch (error) {
          if (isIgnorableLegacyError(error)) {
            console.log(
              `Skipping already-applied statement (${getErrorCode(error)}): ${getErrorMessage(error)}`,
            );
            continue;
          }

          throw error;
        }
      }

      await client.unsafe(
        `
          INSERT INTO "${MIGRATIONS_SCHEMA}"."${MIGRATIONS_TABLE}" ("hash", "created_at")
          SELECT $1, $2
          WHERE NOT EXISTS (
            SELECT 1 FROM "${MIGRATIONS_SCHEMA}"."${MIGRATIONS_TABLE}" WHERE created_at = $2
          )
        `,
        [migration.hash, migration.folderMillis],
      );
    }

    console.log("Legacy migration reconciliation complete");
  }

  try {
    await ensureMigrationsTable();

    const migrationsRecorded = await hasRecordedMigrations();
    if (!migrationsRecorded && (await hasLegacySchemaWithoutHistory())) {
      await reconcileLegacySchema();
    }

    console.log("Running database migrations…");
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  } finally {
    await client.end();
  }
}

const databaseConnectionConfig = getDatabaseConnectionConfig();
if (!databaseConnectionConfig) {
  console.log("No database URL set — skipping migrations");
  process.exit(0);
}

console.log(`Using ${databaseConnectionConfig.envKey} for database migrations`);

try {
  for (let attempt = 1; attempt <= MAX_CONNECTION_ATTEMPTS; attempt += 1) {
    try {
      await runMigrations(databaseConnectionConfig.url);
      console.log("Migrations applied successfully");
      process.exit(0);
    } catch (error) {
      const shouldRetry =
        attempt < MAX_CONNECTION_ATTEMPTS && isRetryableConnectionError(error);

      if (!shouldRetry) {
        throw error;
      }

      const delayMs = INITIAL_RETRY_DELAY_MS * 2 ** (attempt - 1);
      console.warn(
        `Database connection failed (${getErrorCode(error) ?? "unknown_error"}): ${getErrorMessage(error)}. Retrying in ${delayMs}ms…`,
      );
      await sleep(delayMs);
    }
  }
} catch (error) {
  console.error("Migration failed:", error);
  process.exit(1);
}

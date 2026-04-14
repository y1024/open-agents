import { nanoid } from "nanoid";
import {
  and,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  sql,
  type SQL,
} from "drizzle-orm";
import type { GlobalSkillRef } from "@/lib/skills/global-skill-refs";
import type {
  AutomationRunStatus,
  AutomationRunTrigger,
  AutomationUpsertInput,
} from "@/lib/automations/types";
import { db } from "./client";
import {
  automationConnections,
  automations,
  automationRuns,
  automationTools,
  automationTriggers,
  type Automation,
  type AutomationConnection,
  type AutomationRun,
  type AutomationTool,
  type AutomationTrigger,
  type NewAutomation,
  type NewAutomationConnection,
  type NewAutomationRun,
  type NewAutomationTool,
  type NewAutomationTrigger,
} from "./schema";

export type AutomationRecord = Automation & {
  triggers: AutomationTrigger[];
  tools: AutomationTool[];
  connections: AutomationConnection[];
};

export type AutomationListItem = AutomationRecord & {
  latestRun: AutomationRun | null;
};

function activeAutomationWhereClause(
  includeDeleted = false,
  ...conditions: SQL<unknown>[]
): SQL<unknown> {
  if (includeDeleted) {
    return conditions.length === 1 ? conditions[0] : and(...conditions)!;
  }

  return and(...conditions, isNull(automations.deletedAt))!;
}

async function listAutomationRelations(automationIds: string[]): Promise<{
  triggersByAutomationId: Map<string, AutomationTrigger[]>;
  toolsByAutomationId: Map<string, AutomationTool[]>;
  connectionsByAutomationId: Map<string, AutomationConnection[]>;
}> {
  if (automationIds.length === 0) {
    return {
      triggersByAutomationId: new Map(),
      toolsByAutomationId: new Map(),
      connectionsByAutomationId: new Map(),
    };
  }

  const [triggerRows, toolRows, connectionRows] = await Promise.all([
    db.query.automationTriggers.findMany({
      where: inArray(automationTriggers.automationId, automationIds),
      orderBy: [automationTriggers.createdAt],
    }),
    db.query.automationTools.findMany({
      where: inArray(automationTools.automationId, automationIds),
      orderBy: [automationTools.createdAt],
    }),
    db.query.automationConnections.findMany({
      where: inArray(automationConnections.automationId, automationIds),
      orderBy: [automationConnections.createdAt],
    }),
  ]);

  const triggersByAutomationId = new Map<string, AutomationTrigger[]>();
  const toolsByAutomationId = new Map<string, AutomationTool[]>();
  const connectionsByAutomationId = new Map<string, AutomationConnection[]>();

  for (const trigger of triggerRows) {
    const existing = triggersByAutomationId.get(trigger.automationId) ?? [];
    existing.push(trigger);
    triggersByAutomationId.set(trigger.automationId, existing);
  }

  for (const tool of toolRows) {
    const existing = toolsByAutomationId.get(tool.automationId) ?? [];
    existing.push(tool);
    toolsByAutomationId.set(tool.automationId, existing);
  }

  for (const connection of connectionRows) {
    const existing =
      connectionsByAutomationId.get(connection.automationId) ?? [];
    existing.push(connection);
    connectionsByAutomationId.set(connection.automationId, existing);
  }

  return {
    triggersByAutomationId,
    toolsByAutomationId,
    connectionsByAutomationId,
  };
}

async function listLatestRunsByAutomationId(
  automationIds: string[],
): Promise<Map<string, AutomationRun>> {
  if (automationIds.length === 0) {
    return new Map();
  }

  const rows = await db.query.automationRuns.findMany({
    where: inArray(automationRuns.automationId, automationIds),
    orderBy: [desc(automationRuns.triggeredAt), desc(automationRuns.createdAt)],
  });

  const latestRuns = new Map<string, AutomationRun>();
  for (const row of rows) {
    if (!latestRuns.has(row.automationId)) {
      latestRuns.set(row.automationId, row);
    }
  }

  return latestRuns;
}

function buildTriggerRows(
  automationId: string,
  triggers: AutomationUpsertInput["triggers"],
): NewAutomationTrigger[] {
  const now = new Date();
  return triggers.map((trigger) => ({
    id: nanoid(),
    automationId,
    type: trigger.type,
    enabled: true,
    config: trigger,
    createdAt: now,
    updatedAt: now,
  }));
}

function buildToolRows(
  automationId: string,
  tools: AutomationUpsertInput["tools"],
): NewAutomationTool[] {
  const now = new Date();
  return tools.map((tool) => ({
    id: nanoid(),
    automationId,
    toolType: tool.toolType,
    enabled: true,
    config: tool,
    createdAt: now,
    updatedAt: now,
  }));
}

function buildConnectionRows(
  automationId: string,
  connections: AutomationUpsertInput["connections"],
): NewAutomationConnection[] {
  const now = new Date();
  return connections.map((connection) => ({
    id: nanoid(),
    automationId,
    provider: connection.provider,
    connectionRef: connection.connectionRef,
    enabled: true,
    config: connection.config,
    createdAt: now,
    updatedAt: now,
  }));
}

function toAutomationInsert(params: {
  userId: string;
  input: AutomationUpsertInput;
  globalSkillRefs: GlobalSkillRef[];
  nextRunAt: Date | null;
}): NewAutomation {
  const { userId, input, globalSkillRefs, nextRunAt } = params;
  const now = new Date();

  return {
    id: nanoid(),
    userId,
    name: input.name,
    instructions: input.instructions,
    repoOwner: input.repoOwner,
    repoName: input.repoName,
    cloneUrl:
      input.cloneUrl ??
      `https://github.com/${input.repoOwner}/${input.repoName}`,
    baseBranch: input.baseBranch,
    modelId: input.modelId ?? "anthropic/claude-haiku-4.5",
    enabled: input.enabled,
    executionEnvironment: input.executionEnvironment,
    visibility: input.visibility,
    globalSkillRefs,
    lastRunAt: null,
    nextRunAt,
    schedulerRunId: null,
    schedulerState: input.enabled ? "scheduled" : "paused",
    lastRunStatus: null,
    lastRunSummary: null,
    createdAt: now,
    updatedAt: now,
  };
}

export async function listAutomationsByUserId(
  userId: string,
  options?: { includeDeleted?: boolean },
): Promise<AutomationListItem[]> {
  const rows = await db.query.automations.findMany({
    where: activeAutomationWhereClause(
      options?.includeDeleted,
      eq(automations.userId, userId),
    ),
    orderBy: [desc(automations.updatedAt), desc(automations.createdAt)],
  });
  const automationIds = rows.map((row) => row.id);
  const [relations, latestRuns] = await Promise.all([
    listAutomationRelations(automationIds),
    listLatestRunsByAutomationId(automationIds),
  ]);

  return rows.map((row) => ({
    ...row,
    triggers: relations.triggersByAutomationId.get(row.id) ?? [],
    tools: relations.toolsByAutomationId.get(row.id) ?? [],
    connections: relations.connectionsByAutomationId.get(row.id) ?? [],
    latestRun: latestRuns.get(row.id) ?? null,
  }));
}

export async function getAutomationById(
  automationId: string,
  options?: { includeDeleted?: boolean },
): Promise<AutomationRecord | null> {
  const automation = await db.query.automations.findFirst({
    where: activeAutomationWhereClause(
      options?.includeDeleted,
      eq(automations.id, automationId),
    ),
  });

  if (!automation) {
    return null;
  }

  const relations = await listAutomationRelations([automation.id]);
  return {
    ...automation,
    triggers: relations.triggersByAutomationId.get(automation.id) ?? [],
    tools: relations.toolsByAutomationId.get(automation.id) ?? [],
    connections: relations.connectionsByAutomationId.get(automation.id) ?? [],
  };
}

export async function getOwnedAutomationById(params: {
  automationId: string;
  userId: string;
  includeDeleted?: boolean;
}): Promise<AutomationRecord | null> {
  const automation = await getAutomationById(params.automationId, {
    includeDeleted: params.includeDeleted,
  });
  if (!automation || automation.userId !== params.userId) {
    return null;
  }

  return automation;
}

export async function createAutomationDefinition(params: {
  userId: string;
  input: AutomationUpsertInput;
  globalSkillRefs: GlobalSkillRef[];
  nextRunAt: Date | null;
}) {
  return db.transaction(async (tx) => {
    const automationInsert = toAutomationInsert(params);
    const [automation] = await tx
      .insert(automations)
      .values(automationInsert)
      .returning();

    if (!automation) {
      throw new Error("Failed to create automation");
    }

    const triggerRows = buildTriggerRows(automation.id, params.input.triggers);
    if (triggerRows.length > 0) {
      await tx.insert(automationTriggers).values(triggerRows);
    }

    const toolRows = buildToolRows(automation.id, params.input.tools);
    if (toolRows.length > 0) {
      await tx.insert(automationTools).values(toolRows);
    }

    const connectionRows = buildConnectionRows(
      automation.id,
      params.input.connections,
    );
    if (connectionRows.length > 0) {
      await tx.insert(automationConnections).values(connectionRows);
    }

    return automation.id;
  });
}

export async function updateAutomationDefinition(params: {
  automationId: string;
  userId: string;
  input: AutomationUpsertInput;
  globalSkillRefs: GlobalSkillRef[];
  nextRunAt: Date | null;
}) {
  return db.transaction(async (tx) => {
    const [automation] = await tx
      .update(automations)
      .set({
        name: params.input.name,
        instructions: params.input.instructions,
        repoOwner: params.input.repoOwner,
        repoName: params.input.repoName,
        cloneUrl:
          params.input.cloneUrl ??
          `https://github.com/${params.input.repoOwner}/${params.input.repoName}`,
        baseBranch: params.input.baseBranch,
        modelId: params.input.modelId ?? "anthropic/claude-haiku-4.5",
        enabled: params.input.enabled,
        executionEnvironment: params.input.executionEnvironment,
        visibility: params.input.visibility,
        globalSkillRefs: params.globalSkillRefs,
        nextRunAt: params.nextRunAt,
        schedulerState: params.input.enabled ? "scheduled" : "paused",
        updatedAt: new Date(),
      })
      .where(
        activeAutomationWhereClause(
          false,
          eq(automations.id, params.automationId),
          eq(automations.userId, params.userId),
        ),
      )
      .returning();

    if (!automation) {
      return null;
    }

    await tx
      .delete(automationTriggers)
      .where(eq(automationTriggers.automationId, automation.id));
    await tx
      .delete(automationTools)
      .where(eq(automationTools.automationId, automation.id));
    await tx
      .delete(automationConnections)
      .where(eq(automationConnections.automationId, automation.id));

    const triggerRows = buildTriggerRows(automation.id, params.input.triggers);
    if (triggerRows.length > 0) {
      await tx.insert(automationTriggers).values(triggerRows);
    }

    const toolRows = buildToolRows(automation.id, params.input.tools);
    if (toolRows.length > 0) {
      await tx.insert(automationTools).values(toolRows);
    }

    const connectionRows = buildConnectionRows(
      automation.id,
      params.input.connections,
    );
    if (connectionRows.length > 0) {
      await tx.insert(automationConnections).values(connectionRows);
    }

    return automation.id;
  });
}

export async function deleteAutomationDefinition(params: {
  automationId: string;
  userId: string;
}) {
  const [deleted] = await db
    .update(automations)
    .set({
      enabled: false,
      nextRunAt: null,
      schedulerRunId: null,
      schedulerState: "paused",
      deletedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      activeAutomationWhereClause(
        false,
        eq(automations.id, params.automationId),
        eq(automations.userId, params.userId),
      ),
    )
    .returning({ id: automations.id });

  return Boolean(deleted);
}

export async function listAutomationRunsByAutomationId(params: {
  automationId: string;
  limit?: number;
}): Promise<AutomationRun[]> {
  return db.query.automationRuns.findMany({
    where: eq(automationRuns.automationId, params.automationId),
    orderBy: [desc(automationRuns.triggeredAt), desc(automationRuns.createdAt)],
    limit: params.limit,
  });
}

export async function getLatestAutomationRunBySessionId(
  sessionId: string,
): Promise<AutomationRun | null> {
  const run = await db.query.automationRuns.findFirst({
    where: eq(automationRuns.sessionId, sessionId),
    orderBy: [desc(automationRuns.triggeredAt), desc(automationRuns.createdAt)],
  });

  return run ?? null;
}

export async function createAutomationRun(params: {
  automationId: string;
  userId: string;
  trigger: AutomationRunTrigger;
  status?: AutomationRunStatus;
  sessionId?: string | null;
  chatId?: string | null;
}) {
  const now = new Date();
  const values: NewAutomationRun = {
    id: nanoid(),
    automationId: params.automationId,
    userId: params.userId,
    sessionId: params.sessionId ?? null,
    chatId: params.chatId ?? null,
    workflowRunId: null,
    trigger: params.trigger,
    status: params.status ?? "queued",
    triggeredAt: now,
    startedAt: params.status === "running" ? now : null,
    finishedAt: null,
    resultSummary: null,
    prNumber: null,
    prUrl: null,
    compareUrl: null,
    error: null,
    needsAttentionReason: null,
    createdAt: now,
    updatedAt: now,
  };

  const [run] = await db.insert(automationRuns).values(values).returning();
  if (!run) {
    throw new Error("Failed to create automation run");
  }

  return run;
}

export async function updateAutomationRun(
  runId: string,
  patch: Partial<Omit<NewAutomationRun, "id" | "automationId" | "userId">>,
) {
  const [run] = await db
    .update(automationRuns)
    .set({
      ...patch,
      updatedAt: new Date(),
    })
    .where(eq(automationRuns.id, runId))
    .returning();

  return run ?? null;
}

export async function markAutomationRunStarted(params: {
  runId: string;
  sessionId: string;
  chatId: string;
}) {
  return updateAutomationRun(params.runId, {
    sessionId: params.sessionId,
    chatId: params.chatId,
    status: "running",
    startedAt: new Date(),
  });
}

export async function finalizeAutomationRun(params: {
  runId: string;
  automationId: string;
  status: AutomationRunStatus;
  resultSummary?: string | null;
  workflowRunId?: string | null;
  prNumber?: number | null;
  prUrl?: string | null;
  compareUrl?: string | null;
  error?: string | null;
  needsAttentionReason?: string | null;
}) {
  const now = new Date();
  const [run] = await db
    .update(automationRuns)
    .set({
      status: params.status,
      resultSummary: params.resultSummary ?? null,
      workflowRunId: params.workflowRunId ?? null,
      prNumber: params.prNumber ?? null,
      prUrl: params.prUrl ?? null,
      compareUrl: params.compareUrl ?? null,
      error: params.error ?? null,
      needsAttentionReason: params.needsAttentionReason ?? null,
      finishedAt: now,
      updatedAt: now,
    })
    .where(eq(automationRuns.id, params.runId))
    .returning();

  await db
    .update(automations)
    .set({
      lastRunAt: now,
      lastRunStatus: params.status,
      lastRunSummary: params.resultSummary ?? null,
      updatedAt: now,
    })
    .where(eq(automations.id, params.automationId));

  return run ?? null;
}

export async function claimAutomationSchedulerRunId(
  automationId: string,
  runId: string,
) {
  const [updated] = await db
    .update(automations)
    .set({
      schedulerRunId: runId,
      schedulerState: "scheduled",
      updatedAt: new Date(),
    })
    .where(
      and(eq(automations.id, automationId), isNull(automations.schedulerRunId)),
    )
    .returning({ id: automations.id });

  return Boolean(updated);
}

export async function clearAutomationSchedulerRunIdIfOwned(params: {
  automationId: string;
  runId: string;
  schedulerState?: "idle" | "paused" | "scheduled";
}) {
  const [updated] = await db
    .update(automations)
    .set({
      schedulerRunId: null,
      schedulerState: params.schedulerState ?? "idle",
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(automations.id, params.automationId),
        eq(automations.schedulerRunId, params.runId),
      ),
    )
    .returning({ id: automations.id });

  return Boolean(updated);
}

export async function setAutomationSchedulerState(params: {
  automationId: string;
  schedulerRunId?: string | null;
  schedulerState: "idle" | "scheduled" | "running" | "paused";
  nextRunAt?: Date | null;
}) {
  const patch: Partial<NewAutomation> = {
    schedulerState: params.schedulerState,
    updatedAt: new Date(),
  };

  if (params.schedulerRunId !== undefined) {
    patch.schedulerRunId = params.schedulerRunId;
  }

  if (params.nextRunAt !== undefined) {
    patch.nextRunAt = params.nextRunAt;
  }

  const [automation] = await db
    .update(automations)
    .set(patch)
    .where(eq(automations.id, params.automationId))
    .returning();

  return automation ?? null;
}

export async function listAutomationRunsByUserId(
  userId: string,
  limit = 50,
): Promise<AutomationRun[]> {
  return db.query.automationRuns.findMany({
    where: eq(automationRuns.userId, userId),
    orderBy: [desc(automationRuns.triggeredAt), desc(automationRuns.createdAt)],
    limit,
  });
}

export async function getAutomationRunStats(userId: string) {
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const rows = await db
    .select({
      status: automationRuns.status,
      count: sql<number>`count(*)::int`,
    })
    .from(automationRuns)
    .where(
      and(
        eq(automationRuns.userId, userId),
        gte(automationRuns.triggeredAt, sevenDaysAgo),
      ),
    )
    .groupBy(automationRuns.status);

  let successful = 0;
  let failed = 0;
  let total = 0;
  for (const row of rows) {
    total += row.count;
    if (row.status === "completed") {
      successful += row.count;
    } else if (row.status === "failed" || row.status === "cancelled") {
      failed += row.count;
    }
  }

  return { successful, failed, total };
}

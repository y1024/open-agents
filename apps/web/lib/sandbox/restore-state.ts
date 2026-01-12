import path from "node:path";
import type { Sandbox } from "@open-harness/sandbox";
import type { TaskDiff } from "@/lib/db/schema";

const COMMAND_TIMEOUT_MS = 30_000;
const DIFF_TIMEOUT_MS = 60_000;
const RESTORE_DIR_NAME = ".open-harness";
const PATCH_FILENAME = "restore.patch";
const BASE64_FILENAME = "restore.b64";

function shellEscape(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function isSafeRelativePath(filePath: string): boolean {
  if (path.posix.isAbsolute(filePath)) {
    return false;
  }

  const normalized = path.posix.normalize(filePath);
  if (normalized.startsWith("..") || normalized.includes("/../")) {
    return false;
  }

  return normalized.length > 0;
}

async function decodeBase64ToFile(
  sandbox: Sandbox,
  base64Path: string,
  targetPath: string,
  cwd: string,
): Promise<boolean> {
  const primary = await sandbox.exec(
    `base64 -d ${shellEscape(base64Path)} > ${shellEscape(targetPath)}`,
    cwd,
    COMMAND_TIMEOUT_MS,
  );

  if (primary.success) {
    return true;
  }

  const fallback = await sandbox.exec(
    `base64 --decode ${shellEscape(base64Path)} > ${shellEscape(targetPath)}`,
    cwd,
    COMMAND_TIMEOUT_MS,
  );

  return fallback.success;
}

export async function restoreSandboxState(
  sandbox: Sandbox,
  diff: TaskDiff,
): Promise<{ success: boolean; error?: string }> {
  const cwd = sandbox.workingDirectory;
  const errors: string[] = [];

  const restoreDir = path.posix.join(cwd, RESTORE_DIR_NAME);
  await sandbox.mkdir(restoreDir, { recursive: true });

  if (diff.diffContent.trim().length > 0) {
    const patchPath = path.posix.join(restoreDir, PATCH_FILENAME);
    await sandbox.writeFile(patchPath, diff.diffContent, "utf-8");

    const applyResult = await sandbox.exec(
      `git apply --3way ${shellEscape(patchPath)}`,
      cwd,
      DIFF_TIMEOUT_MS,
    );

    if (!applyResult.success) {
      const rejectResult = await sandbox.exec(
        `git apply --reject ${shellEscape(patchPath)}`,
        cwd,
        DIFF_TIMEOUT_MS,
      );

      if (!rejectResult.success) {
        errors.push("Failed to apply git diff");
      } else {
        errors.push("Git diff applied with rejects");
      }
    }
  }

  const untrackedFiles = diff.untrackedFiles ?? [];

  for (const file of untrackedFiles) {
    if (!isSafeRelativePath(file.path)) {
      errors.push(`Skipped unsafe path: ${file.path}`);
      continue;
    }

    const targetPath = path.posix.join(cwd, file.path);

    try {
      await sandbox.access(targetPath);
      continue;
    } catch {
      // File does not exist; continue.
    }

    const targetDir = path.posix.dirname(targetPath);
    await sandbox.mkdir(targetDir, { recursive: true });

    const base64Path = path.posix.join(restoreDir, BASE64_FILENAME);
    await sandbox.writeFile(base64Path, file.content, "utf-8");

    const decoded = await decodeBase64ToFile(
      sandbox,
      base64Path,
      targetPath,
      cwd,
    );

    if (!decoded) {
      errors.push(`Failed to restore ${file.path}`);
    }
  }

  await sandbox.exec(
    `rm -f ${shellEscape(path.posix.join(restoreDir, PATCH_FILENAME))} ` +
      `${shellEscape(path.posix.join(restoreDir, BASE64_FILENAME))}`,
    cwd,
    COMMAND_TIMEOUT_MS,
  );

  if (errors.length > 0) {
    return { success: false, error: errors.join("; ") };
  }

  return { success: true };
}

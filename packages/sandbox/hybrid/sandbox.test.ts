import { describe, expect, test } from "bun:test";
import type { Dirent } from "fs";
import type { ExecResult, Sandbox, SandboxStats } from "../interface";
import { HybridSandbox } from "./sandbox";

function createStubSandbox(): Sandbox {
  return {
    type: "in-memory",
    workingDirectory: "/workspace",
    readFile: async () => "",
    writeFile: async () => {},
    stat: async () =>
      ({
        isDirectory: () => false,
        isFile: () => true,
        size: 0,
        mtimeMs: Date.now(),
      }) satisfies SandboxStats,
    access: async () => {},
    mkdir: async () => {},
    readdir: async () => [] as Dirent[],
    exec: async () =>
      ({
        success: true,
        exitCode: 0,
        stdout: "",
        stderr: "",
        truncated: false,
      }) satisfies ExecResult,
    stop: async () => {},
  };
}

describe("HybridSandbox.execDetached", () => {
  test("throws before cloud handoff", async () => {
    const sandbox = new HybridSandbox({ justBash: createStubSandbox() });

    await expect(
      sandbox.execDetached("npm run dev", sandbox.workingDirectory),
    ).rejects.toThrow(
      "Detached commands are only available after cloud sandbox is ready",
    );
  });
});

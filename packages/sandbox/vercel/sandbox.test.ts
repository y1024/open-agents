import { beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";

const portDomains = new Map<number, string>();
const missingPorts = new Set<number>();

function domainForPort(port: number): string {
  if (missingPorts.has(port)) {
    throw new Error(`No route found for port ${port}`);
  }

  const domain = portDomains.get(port);
  if (!domain) {
    throw new Error(`No route found for port ${port}`);
  }

  return domain;
}

mock.module("@vercel/sandbox", () => ({
  Sandbox: {
    get: async ({ sandboxId }: { sandboxId: string }) => ({
      sandboxId,
      domain: (port: number) => domainForPort(port),
      runCommand: async () => ({
        exitCode: 0,
        cmdId: "cmd-1",
        stdout: async () => "",
      }),
      stop: async () => {},
    }),
  },
}));

let sandboxModule: typeof import("./sandbox");

beforeAll(async () => {
  sandboxModule = await import("./sandbox");
});

beforeEach(() => {
  portDomains.clear();
  missingPorts.clear();
  portDomains.set(80, "https://sbx-80.vercel.run");
});

describe("VercelSandbox.environmentDetails", () => {
  test("skips preview URLs for ports that are missing routes", async () => {
    portDomains.set(3000, "https://sbx-3000.vercel.run");
    missingPorts.add(5173);

    const sandbox = await sandboxModule.VercelSandbox.connect("sbx-test", {
      ports: [3000, 5173],
      remainingTimeout: 0,
    });

    const details = sandbox.environmentDetails;

    expect(details).toContain("Dev server preview URLs");
    expect(details).toContain("Port 3000: https://sbx-3000.vercel.run");
    expect(details).not.toContain("Port 5173:");
  });
});

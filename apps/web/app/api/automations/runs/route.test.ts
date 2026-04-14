import { beforeEach, describe, expect, mock, test } from "bun:test";

let authResult:
  | { ok: true; userId: string }
  | { ok: false; response: Response } = {
  ok: true,
  userId: "user-1",
};

let runs = [
  {
    id: "run-1",
    automationId: "automation-1",
    sessionId: "session-1",
    chatId: "chat-1",
    status: "completed",
    triggeredAt: new Date("2026-04-15T08:00:00.000Z"),
    finishedAt: new Date("2026-04-15T08:05:00.000Z"),
    resultSummary: "Opened a draft PR",
    prUrl: "https://github.com/vercel/open-agents/pull/1",
    compareUrl: null,
    needsAttentionReason: null,
  },
];

let automations = [
  {
    id: "automation-1",
    name: "Daily PR",
    enabled: false,
    deletedAt: new Date("2026-04-15T09:00:00.000Z"),
  },
];

const listAutomationRunsByUserId = mock(() => Promise.resolve(runs));
const listAutomationsByUserId = mock(() => Promise.resolve(automations));

mock.module("@/app/api/sessions/_lib/session-context", () => ({
  requireAuthenticatedUser: () => Promise.resolve(authResult),
}));

mock.module("@/lib/db/automations", () => ({
  listAutomationRunsByUserId,
  listAutomationsByUserId,
}));

const routeModulePromise = import("./route");

describe("GET /api/automations/runs", () => {
  beforeEach(() => {
    authResult = { ok: true, userId: "user-1" };
    runs = [
      {
        id: "run-1",
        automationId: "automation-1",
        sessionId: "session-1",
        chatId: "chat-1",
        status: "completed",
        triggeredAt: new Date("2026-04-15T08:00:00.000Z"),
        finishedAt: new Date("2026-04-15T08:05:00.000Z"),
        resultSummary: "Opened a draft PR",
        prUrl: "https://github.com/vercel/open-agents/pull/1",
        compareUrl: null,
        needsAttentionReason: null,
      },
    ];
    automations = [
      {
        id: "automation-1",
        name: "Daily PR",
        enabled: false,
        deletedAt: new Date("2026-04-15T09:00:00.000Z"),
      },
    ];
    listAutomationRunsByUserId.mockClear();
    listAutomationsByUserId.mockClear();
  });

  test("returns the auth response when unauthenticated", async () => {
    const { GET } = await routeModulePromise;
    authResult = {
      ok: false,
      response: new Response("Unauthorized", { status: 401 }),
    };

    const response = await GET();

    expect(response.status).toBe(401);
  });

  test("includes deleted automation metadata so run history remains visible", async () => {
    const { GET } = await routeModulePromise;

    const response = await GET();
    const body = (await response.json()) as {
      runs: Array<Record<string, unknown>>;
    };

    expect(response.status).toBe(200);
    expect(listAutomationRunsByUserId).toHaveBeenCalledWith("user-1", 50);
    expect(listAutomationsByUserId).toHaveBeenCalledWith("user-1", {
      includeDeleted: true,
    });
    expect(body.runs).toEqual([
      expect.objectContaining({
        id: "run-1",
        automationId: "automation-1",
        automationName: "Daily PR",
        automationEnabled: false,
        automationDeleted: true,
      }),
    ]);
  });
});

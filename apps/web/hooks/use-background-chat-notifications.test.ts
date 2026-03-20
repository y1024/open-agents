import { describe, expect, test } from "bun:test";
import {
  COMPLETION_PERSISTENCE_TIMEOUT_MS,
  detectStoppedSessionsAwaitingPersistence,
  hasPersistedAssistantAdvanced,
  pruneExpiredPendingCompletionCandidates,
  resolvePendingCompletionCandidates,
} from "./use-background-chat-notifications";

function makeItem(
  id: string,
  options?: {
    streaming?: boolean;
    latestAssistantMessageAt?: string | null;
  },
) {
  return {
    id,
    streaming: options?.streaming ?? false,
    latestAssistantMessageAt: options?.latestAssistantMessageAt ?? null,
  };
}

describe("hasPersistedAssistantAdvanced", () => {
  test("returns false when there is still no persisted assistant timestamp", () => {
    expect(hasPersistedAssistantAdvanced(null, null)).toBe(false);
  });

  test("returns true when the first assistant timestamp appears", () => {
    expect(
      hasPersistedAssistantAdvanced(null, "2026-03-20T10:00:00.000Z"),
    ).toBe(true);
  });

  test("returns true when the assistant timestamp moves forward", () => {
    expect(
      hasPersistedAssistantAdvanced(
        "2026-03-20T10:00:00.000Z",
        "2026-03-20T10:00:03.000Z",
      ),
    ).toBe(true);
  });

  test("returns false when the assistant timestamp is unchanged", () => {
    expect(
      hasPersistedAssistantAdvanced(
        "2026-03-20T10:00:00.000Z",
        "2026-03-20T10:00:00.000Z",
      ),
    ).toBe(false);
  });
});

describe("detectStoppedSessionsAwaitingPersistence", () => {
  test("reports an immediate completion when persistence already landed", () => {
    const result = detectStoppedSessionsAwaitingPersistence(
      [
        makeItem("session-1", {
          streaming: true,
          latestAssistantMessageAt: null,
        }),
      ],
      [
        makeItem("session-1", {
          streaming: false,
          latestAssistantMessageAt: "2026-03-20T10:00:02.000Z",
        }),
      ],
      null,
    );

    expect(result).toEqual({
      completedIds: ["session-1"],
      awaitingPersistence: [],
    });
  });

  test("keeps waiting when the stream stopped but the assistant is not persisted yet", () => {
    const result = detectStoppedSessionsAwaitingPersistence(
      [
        makeItem("session-1", {
          streaming: true,
          latestAssistantMessageAt: "2026-03-20T09:59:00.000Z",
        }),
      ],
      [
        makeItem("session-1", {
          streaming: false,
          latestAssistantMessageAt: "2026-03-20T09:59:00.000Z",
        }),
      ],
      null,
    );

    expect(result).toEqual({
      completedIds: [],
      awaitingPersistence: [
        {
          id: "session-1",
          baselineAssistantMessageAt: "2026-03-20T09:59:00.000Z",
        },
      ],
    });
  });

  test("ignores the active session", () => {
    const result = detectStoppedSessionsAwaitingPersistence(
      [
        makeItem("session-1", {
          streaming: true,
          latestAssistantMessageAt: null,
        }),
      ],
      [
        makeItem("session-1", {
          streaming: false,
          latestAssistantMessageAt: null,
        }),
      ],
      "session-1",
    );

    expect(result).toEqual({
      completedIds: [],
      awaitingPersistence: [],
    });
  });
});

describe("pruneExpiredPendingCompletionCandidates", () => {
  test("keeps pending candidates before the timeout", () => {
    const pendingCandidates = new Map([
      [
        "session-1",
        {
          baselineAssistantMessageAt: null,
          waitingSinceMs: 1_000,
        },
      ],
    ]);

    const result = pruneExpiredPendingCompletionCandidates(
      pendingCandidates,
      1_000 + COMPLETION_PERSISTENCE_TIMEOUT_MS - 1,
    );

    expect(result).toEqual(pendingCandidates);
  });

  test("drops timed-out candidates without needing refreshed session data", () => {
    const pendingCandidates = new Map([
      [
        "session-1",
        {
          baselineAssistantMessageAt: null,
          waitingSinceMs: 1_000,
        },
      ],
    ]);

    const result = pruneExpiredPendingCompletionCandidates(
      pendingCandidates,
      1_000 + COMPLETION_PERSISTENCE_TIMEOUT_MS + 1,
    );

    expect(result.size).toBe(0);
  });
});

describe("resolvePendingCompletionCandidates", () => {
  test("completes a pending notification once the assistant timestamp advances", () => {
    const pendingCandidates = new Map([
      [
        "session-1",
        {
          baselineAssistantMessageAt: "2026-03-20T10:00:00.000Z",
          waitingSinceMs: 1_000,
        },
      ],
    ]);

    const result = resolvePendingCompletionCandidates(
      pendingCandidates,
      [
        makeItem("session-1", {
          streaming: false,
          latestAssistantMessageAt: "2026-03-20T10:00:02.000Z",
        }),
      ],
      null,
      5_000,
    );

    expect(result.completedIds).toEqual(["session-1"]);
    expect(result.nextPendingCandidates.size).toBe(0);
  });

  test("drops a pending notification after the timeout without firing", () => {
    const pendingCandidates = new Map([
      [
        "session-1",
        {
          baselineAssistantMessageAt: null,
          waitingSinceMs: 1_000,
        },
      ],
    ]);

    const result = resolvePendingCompletionCandidates(
      pendingCandidates,
      [
        makeItem("session-1", {
          streaming: false,
          latestAssistantMessageAt: null,
        }),
      ],
      null,
      1_000 + COMPLETION_PERSISTENCE_TIMEOUT_MS + 1,
    );

    expect(result.completedIds).toEqual([]);
    expect(result.nextPendingCandidates.size).toBe(0);
  });

  test("keeps pending sessions that are still waiting for persisted data", () => {
    const pendingCandidates = new Map([
      [
        "session-1",
        {
          baselineAssistantMessageAt: null,
          waitingSinceMs: 1_000,
        },
      ],
    ]);

    const result = resolvePendingCompletionCandidates(
      pendingCandidates,
      [
        makeItem("session-1", {
          streaming: false,
          latestAssistantMessageAt: null,
        }),
      ],
      null,
      5_000,
    );

    expect(result.completedIds).toEqual([]);
    expect(result.nextPendingCandidates).toEqual(pendingCandidates);
  });
});

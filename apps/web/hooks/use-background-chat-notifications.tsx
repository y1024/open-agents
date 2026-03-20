"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { SessionWithUnread } from "@/hooks/use-sessions";

type SessionNotificationItem = {
  id: string;
  streaming: boolean;
  latestAssistantMessageAt: string | null;
};

type PendingCompletionCandidate = {
  baselineAssistantMessageAt: string | null;
  waitingSinceMs: number;
};

const FINISHED_CHAT_SOUND_PATH = "/Submarine.wav";
export const COMPLETION_PERSISTENCE_POLL_MS = 1_500;
export const COMPLETION_PERSISTENCE_TIMEOUT_MS = 20_000;

function playFinishedChatSound() {
  if (typeof window === "undefined" || typeof window.Audio === "undefined") {
    return;
  }

  const audio = new window.Audio(FINISHED_CHAT_SOUND_PATH);
  audio.play().catch(() => undefined);
}

function toAssistantTimestamp(
  value: SessionWithUnread["latestAssistantMessageAt"],
): string | null {
  if (!value) {
    return null;
  }

  return value instanceof Date ? value.toISOString() : value;
}

function toNotificationItems(
  sessions: SessionWithUnread[],
): SessionNotificationItem[] {
  return sessions.map((session) => ({
    id: session.id,
    streaming: session.hasStreaming,
    latestAssistantMessageAt: toAssistantTimestamp(
      session.latestAssistantMessageAt,
    ),
  }));
}

export function hasPersistedAssistantAdvanced(
  previous: string | null,
  current: string | null,
): boolean {
  if (!current) {
    return false;
  }

  if (!previous) {
    return true;
  }

  const previousMs = Date.parse(previous);
  const currentMs = Date.parse(current);
  if (Number.isNaN(previousMs) || Number.isNaN(currentMs)) {
    return current !== previous;
  }

  return currentMs > previousMs;
}

export function detectStoppedSessionsAwaitingPersistence(
  previousItems: SessionNotificationItem[],
  currentItems: SessionNotificationItem[],
  activeId: string | null,
): {
  completedIds: string[];
  awaitingPersistence: Array<{
    id: string;
    baselineAssistantMessageAt: string | null;
  }>;
} {
  const previousById = new Map(previousItems.map((item) => [item.id, item]));
  const completedIds: string[] = [];
  const awaitingPersistence: Array<{
    id: string;
    baselineAssistantMessageAt: string | null;
  }> = [];

  for (const item of currentItems) {
    const previous = previousById.get(item.id);
    if (
      !previous ||
      !previous.streaming ||
      item.streaming ||
      item.id === activeId
    ) {
      continue;
    }

    if (
      hasPersistedAssistantAdvanced(
        previous.latestAssistantMessageAt,
        item.latestAssistantMessageAt,
      )
    ) {
      completedIds.push(item.id);
      continue;
    }

    awaitingPersistence.push({
      id: item.id,
      baselineAssistantMessageAt: previous.latestAssistantMessageAt,
    });
  }

  return {
    completedIds,
    awaitingPersistence,
  };
}

export function pruneExpiredPendingCompletionCandidates(
  pendingCandidates: Map<string, PendingCompletionCandidate>,
  now: number,
  timeoutMs = COMPLETION_PERSISTENCE_TIMEOUT_MS,
): Map<string, PendingCompletionCandidate> {
  const nextPendingCandidates = new Map<string, PendingCompletionCandidate>();

  for (const [sessionId, candidate] of pendingCandidates) {
    if (now - candidate.waitingSinceMs >= timeoutMs) {
      continue;
    }

    nextPendingCandidates.set(sessionId, candidate);
  }

  return nextPendingCandidates;
}

export function resolvePendingCompletionCandidates(
  pendingCandidates: Map<string, PendingCompletionCandidate>,
  currentItems: SessionNotificationItem[],
  activeId: string | null,
  now: number,
  timeoutMs = COMPLETION_PERSISTENCE_TIMEOUT_MS,
): {
  completedIds: string[];
  nextPendingCandidates: Map<string, PendingCompletionCandidate>;
} {
  const currentById = new Map(currentItems.map((item) => [item.id, item]));
  const completedIds: string[] = [];
  const nextPendingCandidates = new Map<string, PendingCompletionCandidate>();
  const activePendingCandidates = pruneExpiredPendingCompletionCandidates(
    pendingCandidates,
    now,
    timeoutMs,
  );

  for (const [sessionId, candidate] of activePendingCandidates) {
    const current = currentById.get(sessionId);
    if (!current || sessionId === activeId) {
      continue;
    }

    if (
      hasPersistedAssistantAdvanced(
        candidate.baselineAssistantMessageAt,
        current.latestAssistantMessageAt,
      )
    ) {
      completedIds.push(sessionId);
      continue;
    }

    nextPendingCandidates.set(sessionId, candidate);
  }

  return {
    completedIds,
    nextPendingCandidates,
  };
}

/**
 * Watches the sessions list for background chat completions and only notifies
 * once the assistant message is durably persisted.
 */
export function useBackgroundChatNotifications(
  sessions: SessionWithUnread[],
  activeSessionId: string | null,
  onNavigateToSession: (session: SessionWithUnread) => void,
  refreshSessions: () => Promise<unknown>,
) {
  const previousItemsRef = useRef<SessionNotificationItem[]>([]);
  const pendingCandidatesRef = useRef<Map<string, PendingCompletionCandidate>>(
    new Map(),
  );
  const hasMountedRef = useRef(false);
  const navigateRef = useRef(onNavigateToSession);
  const refreshSessionsRef = useRef(refreshSessions);
  const [pendingCount, setPendingCount] = useState(0);

  navigateRef.current = onNavigateToSession;
  refreshSessionsRef.current = refreshSessions;

  useEffect(() => {
    const items = toNotificationItems(sessions);

    if (hasMountedRef.current) {
      const now = Date.now();
      const { completedIds: immediateCompletedIds, awaitingPersistence } =
        detectStoppedSessionsAwaitingPersistence(
          previousItemsRef.current,
          items,
          activeSessionId,
        );

      const nextPendingCandidates = new Map(pendingCandidatesRef.current);
      for (const candidate of awaitingPersistence) {
        if (!nextPendingCandidates.has(candidate.id)) {
          nextPendingCandidates.set(candidate.id, {
            baselineAssistantMessageAt: candidate.baselineAssistantMessageAt,
            waitingSinceMs: now,
          });
        }
      }

      const {
        completedIds: persistedCompletedIds,
        nextPendingCandidates: reconciledPendingCandidates,
      } = resolvePendingCompletionCandidates(
        nextPendingCandidates,
        items,
        activeSessionId,
        now,
      );

      pendingCandidatesRef.current = reconciledPendingCandidates;
      setPendingCount(reconciledPendingCandidates.size);

      const completedSessionIds = new Set([
        ...immediateCompletedIds,
        ...persistedCompletedIds,
      ]);

      let hasCompleted = false;
      for (const sessionId of completedSessionIds) {
        const session = sessions.find(
          (candidate) => candidate.id === sessionId,
        );
        if (!session) {
          continue;
        }

        hasCompleted = true;
        const title = session.title || "A session";

        toast("Agent finished", {
          description: title,
          position: "top-center",
          duration: 8000,
          action: {
            label: "Go to chat",
            onClick: () => navigateRef.current(session),
          },
        });
      }

      if (hasCompleted) {
        playFinishedChatSound();
      }
    }

    hasMountedRef.current = true;
    previousItemsRef.current = items;
  }, [sessions, activeSessionId]);

  useEffect(() => {
    if (pendingCount === 0) {
      return;
    }

    const refreshPendingSessions = () => {
      const nextPendingCandidates = pruneExpiredPendingCompletionCandidates(
        pendingCandidatesRef.current,
        Date.now(),
      );

      if (nextPendingCandidates.size !== pendingCandidatesRef.current.size) {
        pendingCandidatesRef.current = nextPendingCandidates;
        setPendingCount(nextPendingCandidates.size);
      }

      if (nextPendingCandidates.size === 0) {
        return;
      }

      void refreshSessionsRef.current().catch(() => undefined);
    };

    refreshPendingSessions();

    const interval = setInterval(() => {
      refreshPendingSessions();
    }, COMPLETION_PERSISTENCE_POLL_MS);

    return () => clearInterval(interval);
  }, [pendingCount]);
}

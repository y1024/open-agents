"use client";

import {
  Archive,
  EllipsisVertical,
  ExternalLink,
  GitMerge,
  GitPullRequest,
  Loader2,
  Pencil,
  Plus,
  Settings,
} from "lucide-react";
import { useRouter } from "next/navigation";
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent } from "react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { InboxSidebarRenameDialog } from "@/components/inbox-sidebar-rename-dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useSession } from "@/hooks/use-session";
import type { SessionWithUnread } from "@/hooks/use-sessions";
import type { Session as AuthSession } from "@/lib/session/types";
import { cn } from "@/lib/utils";

type InboxSidebarProps = {
  sessions: SessionWithUnread[];
  archivedCount: number;
  sessionsLoading: boolean;
  activeSessionId: string;
  pendingSessionId: string | null;
  onSessionClick: (session: SessionWithUnread) => void;
  onSessionPrefetch: (session: SessionWithUnread) => void;
  onRenameSession: (sessionId: string, title: string) => Promise<void>;
  onArchiveSession: (sessionId: string) => Promise<void>;
  onOpenNewSession: () => void;
  initialUser?: AuthSession["user"];
};

type ArchivedSessionsResponse = {
  sessions: SessionWithUnread[];
  archivedCount: number;
  pagination?: {
    hasMore: boolean;
    nextOffset: number;
  };
  error?: string;
};

type InboxFilter = "action" | "waiting" | "all";

const ARCHIVED_SESSIONS_PAGE_SIZE = 50;

const sessionRowPerformanceStyle: CSSProperties = {
  contentVisibility: "auto",
  containIntrinsicSize: "3.25rem",
};

function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60_000);
  const diffHours = Math.floor(diffMs / 3_600_000);
  const diffDays = Math.floor(diffMs / 86_400_000);

  if (diffMins < 1) return "now";
  if (diffMins < 60) return `${diffMins}m`;
  if (diffHours < 24) return `${diffHours}h`;
  if (diffDays < 7) return `${diffDays}d`;

  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function getAvatarFallback(username: string): string {
  const normalized = username.trim();
  if (!normalized) {
    return "?";
  }

  return normalized.slice(0, 2).toUpperCase();
}

function isWaitingOnAgent(session: SessionWithUnread): boolean {
  return session.hasStreaming;
}

/**
 * A session needs action when the agent has responded and the user hasn't
 * replied yet (needsResponse), OR when a PR is open and ready for review.
 * Streaming sessions are excluded — they're "waiting", not "action".
 */
function needsAction(session: SessionWithUnread): boolean {
  return (
    !session.hasStreaming &&
    (session.needsResponse || session.prStatus === "open")
  );
}

function getInboxPriority(session: SessionWithUnread): number {
  if (needsAction(session)) return 0;
  if (isWaitingOnAgent(session)) return 1;
  if (session.prStatus === "merged") return 2;
  return 3;
}

function sortSessionsForInbox(
  sessions: SessionWithUnread[],
): SessionWithUnread[] {
  return [...sessions].sort((left, right) => {
    const priorityDelta = getInboxPriority(left) - getInboxPriority(right);
    if (priorityDelta !== 0) {
      return priorityDelta;
    }

    return (
      new Date(right.lastActivityAt ?? right.createdAt).getTime() -
      new Date(left.lastActivityAt ?? left.createdAt).getTime()
    );
  });
}

/** Repo · branch text for the metadata line (excludes PR — that's a badge). */
function getRepoMeta(session: SessionWithUnread): string | null {
  const parts: string[] = [];

  if (session.repoOwner && session.repoName) {
    parts.push(`${session.repoOwner}/${session.repoName}`);
  } else if (session.repoName) {
    parts.push(session.repoName);
  }

  if (session.branch) {
    parts.push(session.branch);
  }

  return parts.length > 0 ? parts.join(" · ") : null;
}

function getGitHubPrUrl(session: SessionWithUnread): string | null {
  if (!session.prNumber || !session.repoOwner || !session.repoName) return null;
  return `https://github.com/${session.repoOwner}/${session.repoName}/pull/${session.prNumber}`;
}

function getGitHubRepoUrl(session: SessionWithUnread): string | null {
  if (!session.repoOwner || !session.repoName) return null;
  return `https://github.com/${session.repoOwner}/${session.repoName}`;
}

function PrBadge({ session }: { session: SessionWithUnread }) {
  if (!session.prNumber) return null;

  const isMerged = session.prStatus === "merged";

  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-md border px-1.5 py-px text-[10px] font-medium",
        isMerged
          ? "border-purple-500/20 bg-purple-500/10 text-purple-700 dark:text-purple-400"
          : "border-green-500/20 bg-green-500/10 text-green-700 dark:text-green-400",
      )}
    >
      {isMerged ? (
        <GitMerge className="h-2.5 w-2.5" />
      ) : (
        <GitPullRequest className="h-2.5 w-2.5" />
      )}
      #{session.prNumber}
    </span>
  );
}

function DiffStats({
  added,
  removed,
}: {
  added: number | null;
  removed: number | null;
}) {
  if (added === null && removed === null) return null;

  return (
    <span className="ml-auto flex shrink-0 items-center gap-0.5 font-mono text-[10px]">
      {added !== null ? (
        <span className="text-green-600 dark:text-green-500">+{added}</span>
      ) : null}
      {removed !== null ? (
        <span className="text-red-600 dark:text-red-400">-{removed}</span>
      ) : null}
    </span>
  );
}

type SessionRowProps = {
  session: SessionWithUnread;
  isActive: boolean;
  isPending: boolean;
  isFocused: boolean;
  onSessionClick: (session: SessionWithUnread) => void;
  onSessionPrefetch: (session: SessionWithUnread) => void;
  onOpenRenameDialog: (session: SessionWithUnread) => void;
  onArchiveSession: (session: SessionWithUnread) => void;
};

const SessionRow = memo(function SessionRow({
  session,
  isActive,
  isPending,
  isFocused,
  onSessionClick,
  onSessionPrefetch,
  onOpenRenameDialog,
  onArchiveSession,
}: SessionRowProps) {
  const hasAction = needsAction(session);
  const isWorking = isWaitingOnAgent(session);
  const isHighlighted = hasAction || isWorking;
  const lastActivityLabel = useMemo(
    () =>
      formatRelativeTime(new Date(session.lastActivityAt ?? session.createdAt)),
    [session.createdAt, session.lastActivityAt],
  );
  const repoMeta = getRepoMeta(session);
  const hasSecondLine =
    Boolean(repoMeta) ||
    Boolean(session.prNumber) ||
    session.linesAdded !== null ||
    session.linesRemoved !== null;
  const prUrl = getGitHubPrUrl(session);
  const repoUrl = getGitHubRepoUrl(session);

  return (
    <div
      className={cn(
        "group relative border-b border-border/50 transition-colors",
        isActive
          ? "bg-accent/50"
          : isFocused
            ? "bg-accent/30"
            : "hover:bg-accent/30",
        isPending ? "opacity-70" : "opacity-100",
      )}
      style={sessionRowPerformanceStyle}
      data-session-id={session.id}
    >
      <button
        type="button"
        onClick={() => onSessionClick(session)}
        onMouseEnter={() => onSessionPrefetch(session)}
        onFocus={() => onSessionPrefetch(session)}
        className="flex w-full items-start gap-3 px-4 py-2.5 pr-8 text-left"
        tabIndex={-1}
        aria-busy={isPending}
      >
        {/* Status dot — aligned to first line of text */}
        <div className="mt-[7px] w-2 shrink-0">
          {isWorking ? (
            <span className="block h-1.5 w-1.5 rounded-full bg-blue-500 animate-pulse" />
          ) : hasAction ? (
            <span className="block h-1.5 w-1.5 rounded-full bg-foreground" />
          ) : null}
        </div>

        {/* Two-line content */}
        <div className="min-w-0 flex-1">
          {/* Line 1: title + timestamp */}
          <div className="flex items-baseline gap-2">
            <p
              className={cn(
                "min-w-0 flex-1 truncate text-sm",
                isHighlighted
                  ? "font-semibold text-foreground"
                  : "text-foreground",
              )}
            >
              {session.title}
            </p>
            <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
              {isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
              <span className="tabular-nums">{lastActivityLabel}</span>
            </span>
          </div>

          {/* Line 2: repo · branch + PR badge + diff stats */}
          {hasSecondLine ? (
            <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
              {repoMeta ? (
                <span className="min-w-0 truncate font-mono">{repoMeta}</span>
              ) : null}
              <PrBadge session={session} />
              <DiffStats
                added={session.linesAdded}
                removed={session.linesRemoved}
              />
            </div>
          ) : null}
        </div>
      </button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            onClick={(e) => e.stopPropagation()}
            className="absolute right-2 top-2.5 rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground group-hover:opacity-100 data-[state=open]:opacity-100"
            tabIndex={-1}
            aria-label={`Open menu for ${session.title}`}
          >
            <EllipsisVertical className="h-3.5 w-3.5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuItem
            onClick={() => onSessionClick(session)}
            className="gap-2"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            <span>Open session</span>
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => onOpenRenameDialog(session)}
            className="gap-2"
          >
            <Pencil className="h-3.5 w-3.5" />
            <span>Rename</span>
          </DropdownMenuItem>
          {session.status !== "archived" ? (
            <DropdownMenuItem
              onClick={() => onArchiveSession(session)}
              className="gap-2"
            >
              <Archive className="h-3.5 w-3.5" />
              <span>Archive</span>
            </DropdownMenuItem>
          ) : null}
          {prUrl || repoUrl ? <DropdownMenuSeparator /> : null}
          {prUrl ? (
            <DropdownMenuItem
              onClick={() =>
                window.open(prUrl, "_blank", "noopener,noreferrer")
              }
              className="gap-2"
            >
              {session.prStatus === "merged" ? (
                <GitMerge className="h-3.5 w-3.5" />
              ) : (
                <GitPullRequest className="h-3.5 w-3.5" />
              )}
              <span>
                {session.prStatus === "merged" ? "View merged PR" : "View PR"} #
                {session.prNumber}
              </span>
            </DropdownMenuItem>
          ) : null}
          {repoUrl ? (
            <DropdownMenuItem
              onClick={() =>
                window.open(repoUrl, "_blank", "noopener,noreferrer")
              }
              className="gap-2"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              <span>View on GitHub</span>
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}, areSessionRowsEqual);

function areSessionRowsEqual(
  prev: SessionRowProps,
  next: SessionRowProps,
): boolean {
  if (
    prev.isActive !== next.isActive ||
    prev.isPending !== next.isPending ||
    prev.isFocused !== next.isFocused
  ) {
    return false;
  }

  return (
    prev.session.id === next.session.id &&
    prev.session.title === next.session.title &&
    prev.session.hasStreaming === next.session.hasStreaming &&
    prev.session.hasUnread === next.session.hasUnread &&
    prev.session.needsResponse === next.session.needsResponse &&
    prev.session.repoOwner === next.session.repoOwner &&
    prev.session.repoName === next.session.repoName &&
    prev.session.branch === next.session.branch &&
    prev.session.prNumber === next.session.prNumber &&
    prev.session.prStatus === next.session.prStatus &&
    prev.session.linesAdded === next.session.linesAdded &&
    prev.session.linesRemoved === next.session.linesRemoved &&
    String(prev.session.lastActivityAt) === String(next.session.lastActivityAt)
  );
}

export function InboxSidebar({
  sessions,
  archivedCount,
  sessionsLoading,
  activeSessionId,
  pendingSessionId,
  onSessionClick,
  onSessionPrefetch,
  onRenameSession,
  onArchiveSession,
  onOpenNewSession,
  initialUser,
}: InboxSidebarProps) {
  const router = useRouter();
  const { session } = useSession();
  const [showArchived, setShowArchived] = useState(false);
  const [activeFilter, setActiveFilter] = useState<InboxFilter>("action");
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const listRef = useRef<HTMLDivElement>(null);
  const [archivedSessions, setArchivedSessions] = useState<SessionWithUnread[]>(
    [],
  );
  const [archivedSessionsLoading, setArchivedSessionsLoading] = useState(false);
  const [archivedSessionsError, setArchivedSessionsError] = useState<
    string | null
  >(null);
  const [hasMoreArchivedSessions, setHasMoreArchivedSessions] = useState(false);
  const archivedRequestInFlightRef = useRef(false);
  const lastLoadedArchivedCountRef = useRef(0);
  const [renameDialogSession, setRenameDialogSession] =
    useState<SessionWithUnread | null>(null);

  const fetchArchivedSessionsPage = useCallback(
    async ({ offset, replace }: { offset: number; replace: boolean }) => {
      if (archivedRequestInFlightRef.current) {
        return;
      }

      archivedRequestInFlightRef.current = true;
      setArchivedSessionsLoading(true);
      setArchivedSessionsError(null);

      try {
        const query = new URLSearchParams({
          status: "archived",
          limit: String(ARCHIVED_SESSIONS_PAGE_SIZE),
          offset: String(offset),
        });
        const res = await fetch(`/api/sessions?${query.toString()}`);
        const data = (await res.json()) as ArchivedSessionsResponse;

        if (!res.ok) {
          throw new Error(data.error ?? "Failed to load archived sessions");
        }

        setArchivedSessions((current) => {
          if (replace) {
            return data.sessions;
          }

          const existingIds = new Set(current.map((s) => s.id));
          const nextSessions = data.sessions.filter(
            (s) => !existingIds.has(s.id),
          );

          return [...current, ...nextSessions];
        });
        lastLoadedArchivedCountRef.current = data.archivedCount;
        setHasMoreArchivedSessions(Boolean(data.pagination?.hasMore));
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Failed to load archived sessions";
        setArchivedSessionsError(message);
      } finally {
        archivedRequestInFlightRef.current = false;
        setArchivedSessionsLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (!showArchived) {
      return;
    }

    if (archivedCount === 0) {
      setArchivedSessions([]);
      setHasMoreArchivedSessions(false);
      setArchivedSessionsError(null);
      lastLoadedArchivedCountRef.current = 0;
      return;
    }

    if (lastLoadedArchivedCountRef.current === archivedCount) {
      return;
    }

    void fetchArchivedSessionsPage({ offset: 0, replace: true });
  }, [archivedCount, fetchArchivedSessionsPage, showArchived]);

  const activeSessions = useMemo(
    () => sortSessionsForInbox(sessions),
    [sessions],
  );
  const sortedArchivedSessions = useMemo(
    () => sortSessionsForInbox(archivedSessions),
    [archivedSessions],
  );
  const counts = useMemo(
    () => ({
      needsAction: activeSessions.filter(needsAction).length,
      waiting: activeSessions.filter(isWaitingOnAgent).length,
      total: activeSessions.length,
    }),
    [activeSessions],
  );
  const filteredActiveSessions = useMemo(() => {
    if (activeFilter === "action") {
      return activeSessions.filter(needsAction);
    }

    if (activeFilter === "waiting") {
      return activeSessions.filter(isWaitingOnAgent);
    }

    return activeSessions;
  }, [activeFilter, activeSessions]);
  const displayedSessions = showArchived
    ? sortedArchivedSessions
    : filteredActiveSessions;
  const showLoadingSkeleton =
    (!showArchived && sessionsLoading && sessions.length === 0) ||
    (showArchived && archivedSessionsLoading && archivedSessions.length === 0);
  const sidebarUser = session?.user ?? initialUser;

  // Reset keyboard focus when displayed list changes
  useEffect(() => {
    setFocusedIndex(-1);
  }, [displayedSessions.length, showArchived, activeFilter]);

  const handleSessionClick = useCallback(
    (targetSession: SessionWithUnread) => {
      onSessionClick(targetSession);
    },
    [onSessionClick],
  );

  const handleSessionPrefetch = useCallback(
    (targetSession: SessionWithUnread) => {
      onSessionPrefetch(targetSession);
    },
    [onSessionPrefetch],
  );

  const handleArchiveSession = useCallback(
    async (targetSession: SessionWithUnread) => {
      try {
        await onArchiveSession(targetSession.id);
        setArchivedSessions((current) => {
          const nextSessions = [
            { ...targetSession, status: "archived" as const },
            ...current.filter((s) => s.id !== targetSession.id),
          ];
          const maxCachedSessions = Math.max(
            current.length,
            ARCHIVED_SESSIONS_PAGE_SIZE,
          );

          return nextSessions.slice(0, maxCachedSessions);
        });
        setHasMoreArchivedSessions(
          (currentHasMore) =>
            currentHasMore || archivedCount + 1 > ARCHIVED_SESSIONS_PAGE_SIZE,
        );
      } catch (error) {
        console.error("Failed to archive session:", error);
      }
    },
    [archivedCount, onArchiveSession],
  );

  const handleLoadMoreArchivedSessions = useCallback(() => {
    if (archivedSessionsLoading) {
      return;
    }

    void fetchArchivedSessionsPage({
      offset: archivedSessions.length,
      replace: false,
    });
  }, [
    archivedSessions.length,
    archivedSessionsLoading,
    fetchArchivedSessionsPage,
  ]);

  const handleRetryArchivedSessions = useCallback(() => {
    void fetchArchivedSessionsPage({ offset: 0, replace: true });
  }, [fetchArchivedSessionsPage]);

  const closeRenameDialog = useCallback(() => {
    setRenameDialogSession(null);
  }, []);

  const handleOpenRenameDialog = useCallback(
    (targetSession: SessionWithUnread) => {
      setRenameDialogSession(targetSession);
    },
    [],
  );

  const handleRenameArchivedSession = useCallback(
    (sessionId: string, title: string) => {
      setArchivedSessions((current) =>
        current.map((s) => (s.id === sessionId ? { ...s, title } : s)),
      );
    },
    [],
  );

  // Keyboard navigation: up/down to move, enter to open, escape to reset
  const handleListKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLDivElement>) => {
      if (displayedSessions.length === 0) return;

      switch (e.key) {
        case "ArrowDown":
        case "j": {
          e.preventDefault();
          setFocusedIndex((prev) =>
            prev < displayedSessions.length - 1 ? prev + 1 : prev,
          );
          break;
        }
        case "ArrowUp":
        case "k": {
          e.preventDefault();
          setFocusedIndex((prev) => (prev > 0 ? prev - 1 : 0));
          break;
        }
        case "Enter": {
          e.preventDefault();
          const focused = displayedSessions[focusedIndex];
          if (focused) {
            onSessionClick(focused);
          }
          break;
        }
        case "Escape": {
          e.preventDefault();
          setFocusedIndex(-1);
          break;
        }
      }
    },
    [displayedSessions, focusedIndex, onSessionClick],
  );

  // Scroll focused row into view
  useEffect(() => {
    if (focusedIndex < 0 || !listRef.current) return;
    const focusedSession = displayedSessions[focusedIndex];
    if (!focusedSession) return;

    const row = listRef.current.querySelector(
      `[data-session-id="${focusedSession.id}"]`,
    );
    if (row) {
      row.scrollIntoView({ block: "nearest" });
    }
  }, [focusedIndex, displayedSessions]);

  return (
    <>
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-border px-4 py-2">
        <span className="text-sm font-medium text-foreground">Inbox</span>

        {/* Tabs inline */}
        <div className="flex gap-px">
          <button
            type="button"
            onClick={() => setShowArchived(false)}
            className={cn(
              "rounded-md px-2 py-1 text-xs font-medium transition-colors",
              !showArchived
                ? "bg-accent text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            Active
            {counts.total > 0 ? (
              <span className="ml-1 tabular-nums text-muted-foreground">
                {counts.total}
              </span>
            ) : null}
          </button>
          <button
            type="button"
            onClick={() => setShowArchived(true)}
            className={cn(
              "flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors",
              showArchived
                ? "bg-accent text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Archive className="h-3 w-3" />
            Archive
            {archivedCount > 0 ? (
              <span className="ml-0.5 tabular-nums text-muted-foreground">
                {archivedCount}
              </span>
            ) : null}
          </button>
        </div>

        {/* Filters */}
        {!showArchived ? (
          <div className="ml-auto flex gap-px">
            {(
              [
                { key: "action", label: "Action", count: counts.needsAction },
                { key: "waiting", label: "Waiting", count: counts.waiting },
                { key: "all", label: "All", count: counts.total },
              ] as const
            ).map((filter) => (
              <button
                key={filter.key}
                type="button"
                onClick={() => setActiveFilter(filter.key)}
                className={cn(
                  "rounded-md px-2 py-1 text-[11px] font-medium transition-colors",
                  activeFilter === filter.key
                    ? "bg-accent text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {filter.label}
                {filter.count > 0 ? (
                  <span className="ml-1 tabular-nums text-muted-foreground">
                    {filter.count}
                  </span>
                ) : null}
              </button>
            ))}
          </div>
        ) : (
          <div className="ml-auto" />
        )}

        {/* User + New session */}
        <div className="flex items-center gap-1">
          {sidebarUser ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0 text-muted-foreground hover:text-foreground"
              onClick={() => router.push("/settings")}
              aria-label="Open settings"
            >
              <Avatar className="h-5 w-5">
                {sidebarUser.avatar ? (
                  <AvatarImage
                    src={sidebarUser.avatar}
                    alt={sidebarUser.username}
                  />
                ) : null}
                <AvatarFallback className="text-[8px]">
                  {getAvatarFallback(sidebarUser.username)}
                </AvatarFallback>
              </Avatar>
            </Button>
          ) : (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0 text-muted-foreground hover:text-foreground"
              onClick={() => router.push("/settings")}
              aria-label="Open settings"
            >
              <Settings className="h-3.5 w-3.5" />
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onOpenNewSession}
            className="h-7 w-7"
            aria-label="New session"
          >
            <Plus className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Session list */}
      <div
        ref={listRef}
        className="min-h-0 flex-1 overflow-y-auto focus:outline-none"
        tabIndex={0}
        onKeyDown={handleListKeyDown}
        role="listbox"
        aria-label="Sessions"
      >
        {showLoadingSkeleton ? (
          <div>
            {Array.from({ length: 8 }).map((_, index) => (
              <div key={index} className="space-y-1.5 px-4 py-2.5">
                <div className="h-3.5 w-3/4 animate-pulse rounded bg-muted" />
                <div className="h-3 w-1/2 animate-pulse rounded bg-muted" />
              </div>
            ))}
          </div>
        ) : displayedSessions.length === 0 ? (
          <div className="px-4 py-12 text-center text-sm text-muted-foreground">
            {showArchived
              ? (archivedSessionsError ?? "No archived sessions")
              : activeFilter === "action"
                ? "Nothing needs attention"
                : activeFilter === "waiting"
                  ? "No sessions in progress"
                  : "No sessions yet"}
            {showArchived && archivedSessionsError ? (
              <div className="mt-3">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleRetryArchivedSessions}
                >
                  Retry
                </Button>
              </div>
            ) : null}
          </div>
        ) : (
          <>
            <div>
              {displayedSessions.map((targetSession, index) => (
                <SessionRow
                  key={targetSession.id}
                  session={targetSession}
                  isActive={targetSession.id === activeSessionId}
                  isPending={targetSession.id === pendingSessionId}
                  isFocused={index === focusedIndex}
                  onSessionClick={handleSessionClick}
                  onSessionPrefetch={handleSessionPrefetch}
                  onOpenRenameDialog={handleOpenRenameDialog}
                  onArchiveSession={handleArchiveSession}
                />
              ))}
            </div>
            {showArchived &&
            (hasMoreArchivedSessions || archivedSessionsError) ? (
              <div className="px-3 pb-3">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={
                    archivedSessionsError
                      ? handleRetryArchivedSessions
                      : handleLoadMoreArchivedSessions
                  }
                  disabled={archivedSessionsLoading}
                >
                  {archivedSessionsLoading
                    ? "Loading..."
                    : archivedSessionsError
                      ? "Retry loading archived sessions"
                      : "Load more archived sessions"}
                </Button>
              </div>
            ) : null}
          </>
        )}
      </div>

      <InboxSidebarRenameDialog
        session={renameDialogSession}
        onClose={closeRenameDialog}
        onRenameSession={onRenameSession}
        onRenamed={handleRenameArchivedSession}
      />
    </>
  );
}

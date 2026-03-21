"use client";

import {
  Archive,
  ChevronDown,
  EllipsisVertical,
  FolderGit2,
  GitMerge,
  Loader2,
  Pencil,
  Plus,
  Settings,
} from "lucide-react";
import { useRouter } from "next/navigation";
import type { CSSProperties } from "react";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { InboxSidebarRenameDialog } from "@/components/inbox-sidebar-rename-dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useSidebar } from "@/components/ui/sidebar";
import { useSession } from "@/hooks/use-session";
import type { SessionWithUnread } from "@/hooks/use-sessions";
import type { Session as AuthSession } from "@/lib/session/types";
import {
  getSessionBucket,
  type AttentionReason,
} from "@/lib/sessions/get-session-bucket";

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

function DiffStats({
  added,
  removed,
}: {
  added: number | null;
  removed: number | null;
}) {
  if (added === null && removed === null) return null;

  return (
    <span className="flex items-center gap-0.5 font-mono text-[10px]">
      {added !== null ? (
        <span className="text-green-600 dark:text-green-500">+{added}</span>
      ) : null}
      {removed !== null ? (
        <span className="text-red-600 dark:text-red-400">-{removed}</span>
      ) : null}
    </span>
  );
}

function PrBadge({
  prNumber,
  status,
}: {
  prNumber: number | null;
  status: "open" | "merged" | "closed" | null;
}) {
  if (!prNumber) return null;

  if (status === "merged") {
    return (
      <span className="flex items-center gap-0.5 text-[10px] text-purple-700 dark:text-purple-400">
        <GitMerge className="h-2.5 w-2.5" />
        <span>#{prNumber}</span>
      </span>
    );
  }

  return <span className="text-[10px] text-muted-foreground">#{prNumber}</span>;
}

function AttentionReasonBadge({ reason }: { reason: AttentionReason }) {
  switch (reason) {
    case "failed":
    case "lifecycle_failed":
      return (
        <span className="text-[10px] font-medium text-red-600 dark:text-red-400">
          failed
        </span>
      );
    case "unread":
      return (
        <span className="text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
          new activity
        </span>
      );
    default:
      return null;
  }
}

function SectionLabel({
  children,
  count,
}: {
  children: React.ReactNode;
  count?: number;
}) {
  return (
    <div className="flex items-center gap-1.5 px-2 pb-1 pt-2">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
        {children}
      </span>
      {count !== undefined && count > 0 ? (
        <span className="rounded-full bg-muted/70 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
          {count}
        </span>
      ) : null}
    </div>
  );
}

type SessionRepoGroup = {
  id: string;
  label: string;
  sessions: SessionWithUnread[];
};

function getRepoGroupId(session: SessionWithUnread): string {
  const repoName = session.repoName?.trim();
  const repoOwner = session.repoOwner?.trim();

  if (!repoName) {
    return "repo:unscoped";
  }

  return `repo:${repoOwner ?? ""}/${repoName}`.toLowerCase();
}

function getRepoGroupLabel(session: SessionWithUnread): string {
  const repoName = session.repoName?.trim();
  const repoOwner = session.repoOwner?.trim();

  if (!repoName) {
    return "No repository";
  }

  return repoOwner ? `${repoOwner}/${repoName}` : repoName;
}

function groupSessionsByRepo(
  sessions: SessionWithUnread[],
): SessionRepoGroup[] {
  const groups = new Map<string, SessionRepoGroup>();

  for (const session of sessions) {
    const groupId = getRepoGroupId(session);
    const existingGroup = groups.get(groupId);

    if (existingGroup) {
      existingGroup.sessions.push(session);
      continue;
    }

    groups.set(groupId, {
      id: groupId,
      label: getRepoGroupLabel(session),
      sessions: [session],
    });
  }

  return Array.from(groups.values());
}

function getRepoGroupContentId(groupId: string): string {
  return `repo-group-panel-${groupId.replace(/[^a-z0-9-]+/gi, "-")}`;
}

type SessionRowProps = {
  session: SessionWithUnread;
  isActive: boolean;
  isPending: boolean;
  attentionReason?: AttentionReason;
  onSessionClick: (session: SessionWithUnread) => void;
  onSessionPrefetch: (session: SessionWithUnread) => void;
  onOpenRenameDialog: (session: SessionWithUnread) => void;
  onArchiveSession: (session: SessionWithUnread) => void;
};

const SessionRow = memo(function SessionRow({
  session,
  isActive,
  isPending,
  attentionReason,
  onSessionClick,
  onSessionPrefetch,
  onOpenRenameDialog,
  onArchiveSession,
}: SessionRowProps) {
  const isWorking = session.hasStreaming;
  const isUnread = session.hasUnread && !isActive;
  const lastActivityLabel = useMemo(
    () =>
      formatRelativeTime(new Date(session.lastActivityAt ?? session.createdAt)),
    [session.createdAt, session.lastActivityAt],
  );
  const metadataLabel =
    session.branch ??
    (isWorking ? "Working..." : !session.repoName ? "No repository" : null);
  const metadataLabelClassName = session.branch
    ? "truncate font-mono text-[11px]"
    : "truncate";
  const showMetadata =
    Boolean(metadataLabel) ||
    Boolean(attentionReason) ||
    session.prNumber !== null ||
    session.linesAdded !== null ||
    session.linesRemoved !== null;

  return (
    <div
      className={`group relative flex w-full items-start gap-2.5 rounded-xl border px-3 py-2.5 text-left transition-[background-color,border-color,box-shadow,opacity] ${
        isActive
          ? "border-border/70 bg-sidebar-active shadow-sm"
          : "border-transparent hover:border-border/40 hover:bg-muted/50"
      } ${isPending ? "opacity-80" : "opacity-100"}`}
      style={sessionRowPerformanceStyle}
    >
      <div className="flex h-5 w-3 shrink-0 items-center justify-center">
        {isWorking ? (
          <span className="h-2 w-2 rounded-full bg-foreground/70 animate-pulse" />
        ) : isUnread ? (
          <span className="h-2 w-2 rounded-full bg-emerald-500" />
        ) : null}
      </div>

      <div className="min-w-0 flex-1">
        <button
          type="button"
          onClick={() => onSessionClick(session)}
          onMouseEnter={() => onSessionPrefetch(session)}
          onFocus={() => onSessionPrefetch(session)}
          className="block w-full text-left"
          aria-busy={isPending}
        >
          <div className="flex min-w-0 items-center gap-2 pr-7">
            <p
              className={`min-w-0 flex-1 truncate text-sm ${
                isUnread || isWorking
                  ? "font-semibold text-foreground"
                  : "font-medium text-foreground"
              }`}
            >
              {session.title}
            </p>
            <span className="flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground">
              {isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
              <span>{lastActivityLabel}</span>
            </span>
          </div>

          {showMetadata ? (
            <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
              {attentionReason ? (
                <AttentionReasonBadge reason={attentionReason} />
              ) : metadataLabel ? (
                <span className={metadataLabelClassName}>{metadataLabel}</span>
              ) : null}
              <span className="ml-auto flex shrink-0 items-center gap-1.5">
                <PrBadge
                  prNumber={session.prNumber}
                  status={session.prStatus}
                />
                <DiffStats
                  added={session.linesAdded}
                  removed={session.linesRemoved}
                />
              </span>
            </div>
          ) : null}
        </button>
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            onClick={(e) => e.stopPropagation()}
            className="absolute right-2 top-2.5 rounded p-1 text-muted-foreground hover:bg-background/60 hover:text-foreground"
            aria-label={`Open menu for ${session.title}`}
          >
            <EllipsisVertical className="h-3 w-3" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            onClick={() => onOpenRenameDialog(session)}
            className="gap-2"
          >
            <Pencil className="h-3.5 w-3.5" />
            <span>Rename session</span>
          </DropdownMenuItem>
          {session.status !== "archived" ? (
            <DropdownMenuItem
              onClick={() => onArchiveSession(session)}
              className="gap-2"
            >
              <Archive className="h-3.5 w-3.5" />
              <span>Archive session</span>
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
  if (prev.isActive !== next.isActive || prev.isPending !== next.isPending) {
    return false;
  }

  if (prev.attentionReason !== next.attentionReason) {
    return false;
  }

  return (
    prev.session.id === next.session.id &&
    prev.session.title === next.session.title &&
    prev.session.hasStreaming === next.session.hasStreaming &&
    prev.session.hasUnread === next.session.hasUnread &&
    prev.session.status === next.session.status &&
    prev.session.lifecycleState === next.session.lifecycleState &&
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
  archivedCount: _archivedCount,
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
  const { isMobile, setOpenMobile } = useSidebar();
  const [cookingExpanded, setCookingExpanded] = useState(false);
  const [renameDialogSession, setRenameDialogSession] =
    useState<SessionWithUnread | null>(null);

  // Classify all sessions into buckets
  const { attentionSessions, cookingSessions, idleSessions, attentionReasons } =
    useMemo(() => {
      const attention: SessionWithUnread[] = [];
      const cooking: SessionWithUnread[] = [];
      const idle: SessionWithUnread[] = [];
      const reasons = new Map<string, AttentionReason>();

      for (const s of sessions) {
        const result = getSessionBucket(s);
        if (result.bucket === "attention") {
          attention.push(s);
          if (result.reason) {
            reasons.set(s.id, result.reason);
          }
        } else if (result.bucket === "cooking") {
          cooking.push(s);
        } else if (result.bucket === "idle") {
          idle.push(s);
        }
        // "done" sessions are filtered out by the API (status=active excludes archived)
      }

      return {
        attentionSessions: attention,
        cookingSessions: cooking,
        idleSessions: idle,
        attentionReasons: reasons,
      };
    }, [sessions]);

  const idleGroupedByRepo = useMemo(
    () => groupSessionsByRepo(idleSessions),
    [idleSessions],
  );

  const idleActiveGroupId = useMemo(
    () =>
      idleGroupedByRepo.find((group) =>
        group.sessions.some((s) => s.id === activeSessionId),
      )?.id ?? null,
    [activeSessionId, idleGroupedByRepo],
  );

  const [collapsedGroupIds, setCollapsedGroupIds] = useState<
    Record<string, boolean>
  >({});

  useEffect(() => {
    setCollapsedGroupIds((current) => {
      const next: Record<string, boolean> = {};
      let changed = false;

      for (const group of idleGroupedByRepo) {
        const nextCollapsed =
          group.id === idleActiveGroupId ? false : (current[group.id] ?? false);

        next[group.id] = nextCollapsed;

        if (current[group.id] !== nextCollapsed) {
          changed = true;
        }
      }

      if (!changed) {
        const currentIds = Object.keys(current);
        if (currentIds.length !== idleGroupedByRepo.length) {
          changed = true;
        }
      }

      return changed ? next : current;
    });
  }, [idleActiveGroupId, idleGroupedByRepo]);

  const sidebarUser = session?.user ?? initialUser;
  const showLoadingSkeleton = sessionsLoading && sessions.length === 0;

  const handleSessionClick = useCallback(
    (s: SessionWithUnread) => {
      if (isMobile) {
        setOpenMobile(false);
      }
      onSessionClick(s);
    },
    [isMobile, onSessionClick, setOpenMobile],
  );

  const handleSessionPrefetch = useCallback(
    (s: SessionWithUnread) => {
      onSessionPrefetch(s);
    },
    [onSessionPrefetch],
  );

  const handleToggleRepoGroup = useCallback((groupId: string) => {
    setCollapsedGroupIds((current) => ({
      ...current,
      [groupId]: !current[groupId],
    }));
  }, []);

  const handleArchiveSession = useCallback(
    async (s: SessionWithUnread) => {
      try {
        await onArchiveSession(s.id);
      } catch (err) {
        console.error("Failed to archive session:", err);
      }
    },
    [onArchiveSession],
  );

  const closeRenameDialog = useCallback(() => {
    setRenameDialogSession(null);
  }, []);

  const handleOpenRenameDialog = useCallback((s: SessionWithUnread) => {
    setRenameDialogSession(s);
  }, []);

  return (
    <>
      <div className="border-b border-border p-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center px-2 py-1.5 text-sm text-primary">
            <span>Sessions</span>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onOpenNewSession}
            className="h-7 w-7"
          >
            <Plus className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {showLoadingSkeleton ? (
          <div className="space-y-1 p-2">
            {Array.from({ length: 5 }).map((_, index) => (
              <div key={index} className="space-y-1.5 rounded-md px-3 py-2.5">
                <div className="h-3.5 w-3/4 animate-pulse rounded bg-muted" />
                <div className="h-3 w-1/2 animate-pulse rounded bg-muted" />
              </div>
            ))}
          </div>
        ) : sessions.length === 0 ? (
          <div className="px-4 py-12 text-center text-sm text-muted-foreground">
            No sessions yet
          </div>
        ) : (
          <div className="p-1.5">
            {/* Attention section */}
            {attentionSessions.length > 0 ? (
              <div>
                <SectionLabel count={attentionSessions.length}>
                  Needs attention
                </SectionLabel>
                <div className="space-y-1">
                  {attentionSessions.map((s) => (
                    <SessionRow
                      key={s.id}
                      session={s}
                      isActive={s.id === activeSessionId}
                      isPending={s.id === pendingSessionId}
                      attentionReason={attentionReasons.get(s.id)}
                      onSessionClick={handleSessionClick}
                      onSessionPrefetch={handleSessionPrefetch}
                      onOpenRenameDialog={handleOpenRenameDialog}
                      onArchiveSession={handleArchiveSession}
                    />
                  ))}
                </div>
              </div>
            ) : null}

            {/* Idle sessions — grouped by repo */}
            {idleGroupedByRepo.length > 0 ? (
              <div className={attentionSessions.length > 0 ? "mt-2" : ""}>
                <SectionLabel count={idleSessions.length}>
                  Sessions
                </SectionLabel>
                <div className="space-y-3">
                  {idleGroupedByRepo.map((group) => {
                    const isCollapsed = collapsedGroupIds[group.id] ?? false;
                    const groupHasActiveSession =
                      group.id === idleActiveGroupId;
                    const groupContentId = getRepoGroupContentId(group.id);

                    return (
                      <section key={group.id} className="space-y-1.5">
                        <button
                          type="button"
                          onClick={() => handleToggleRepoGroup(group.id)}
                          aria-controls={groupContentId}
                          aria-expanded={!isCollapsed}
                          className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors ${
                            groupHasActiveSession
                              ? "bg-muted/35 text-foreground"
                              : "text-muted-foreground hover:bg-muted/20 hover:text-foreground/85"
                          }`}
                        >
                          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-border/40 bg-background/70 text-muted-foreground/80">
                            <FolderGit2 className="h-3.5 w-3.5" />
                          </span>
                          <span className="min-w-0 flex-1 truncate text-[12px] font-medium">
                            {group.label}
                          </span>
                          <span
                            className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                              groupHasActiveSession
                                ? "bg-background/80 text-foreground/65"
                                : "bg-muted/70 text-muted-foreground"
                            }`}
                          >
                            {group.sessions.length}
                          </span>
                          <ChevronDown
                            className={`h-3.5 w-3.5 shrink-0 text-muted-foreground/70 transition-transform duration-200 ${
                              isCollapsed ? "-rotate-90" : "rotate-0"
                            }`}
                          />
                        </button>
                        <div
                          id={groupContentId}
                          aria-hidden={isCollapsed}
                          inert={isCollapsed}
                          className={`grid transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none ${
                            isCollapsed
                              ? "grid-rows-[0fr] opacity-0 pointer-events-none"
                              : "grid-rows-[1fr] opacity-100"
                          }`}
                        >
                          <div className="overflow-hidden">
                            <div className="ml-5 space-y-1 border-l border-border/40 pl-2">
                              {group.sessions.map((s) => (
                                <SessionRow
                                  key={s.id}
                                  session={s}
                                  isActive={s.id === activeSessionId}
                                  isPending={s.id === pendingSessionId}
                                  onSessionClick={handleSessionClick}
                                  onSessionPrefetch={handleSessionPrefetch}
                                  onOpenRenameDialog={handleOpenRenameDialog}
                                  onArchiveSession={handleArchiveSession}
                                />
                              ))}
                            </div>
                          </div>
                        </div>
                      </section>
                    );
                  })}
                </div>
              </div>
            ) : null}

            {/* Cooking section — streaming sessions, collapsed */}
            {cookingSessions.length > 0 ? (
              <div
                className={`${attentionSessions.length > 0 || idleGroupedByRepo.length > 0 ? "mt-2" : ""}`}
              >
                <button
                  type="button"
                  onClick={() => setCookingExpanded((v) => !v)}
                  className="flex w-full items-center gap-1.5 px-2 pb-1 pt-2 text-left"
                >
                  <ChevronDown
                    className={`h-3 w-3 shrink-0 text-muted-foreground/70 transition-transform duration-200 ${
                      cookingExpanded ? "rotate-0" : "-rotate-90"
                    }`}
                  />
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                    Cooking
                  </span>
                  <span className="rounded-full bg-muted/70 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                    {cookingSessions.length}
                  </span>
                </button>

                <div
                  className={`grid transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none ${
                    cookingExpanded
                      ? "grid-rows-[1fr] opacity-100"
                      : "grid-rows-[0fr] opacity-0 pointer-events-none"
                  }`}
                  aria-hidden={!cookingExpanded}
                  inert={!cookingExpanded}
                >
                  <div className="overflow-hidden">
                    <div className="space-y-1">
                      {cookingSessions.map((s) => (
                        <SessionRow
                          key={s.id}
                          session={s}
                          isActive={s.id === activeSessionId}
                          isPending={s.id === pendingSessionId}
                          onSessionClick={handleSessionClick}
                          onSessionPrefetch={handleSessionPrefetch}
                          onOpenRenameDialog={handleOpenRenameDialog}
                          onArchiveSession={handleArchiveSession}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        )}
      </div>

      {sidebarUser ? (
        <div className="border-t border-border p-3">
          <div className="flex items-center gap-2 rounded-lg p-2">
            <Avatar className="h-9 w-9 shrink-0">
              {sidebarUser.avatar ? (
                <AvatarImage
                  src={sidebarUser.avatar}
                  alt={sidebarUser.username}
                />
              ) : null}
              <AvatarFallback>
                {getAvatarFallback(sidebarUser.username)}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold leading-none text-foreground">
                {sidebarUser.username}
              </p>
              {sidebarUser.email ? (
                <p className="mt-1 truncate text-xs text-muted-foreground">
                  {sidebarUser.email}
                </p>
              ) : null}
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground"
              onClick={() => router.push("/settings")}
              aria-label="Open settings"
            >
              <Settings className="h-4 w-4" />
            </Button>
          </div>
        </div>
      ) : null}

      <InboxSidebarRenameDialog
        session={renameDialogSession}
        onClose={closeRenameDialog}
        onRenameSession={onRenameSession}
      />
    </>
  );
}

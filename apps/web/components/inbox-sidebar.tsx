"use client";

import {
  Archive,
  Check,
  ChevronsUpDown,
  EllipsisVertical,
  GitMerge,
  Pencil,
  Plus,
  Settings,
  UserPlus,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  getValidRenameTitle,
  isRenameSaveDisabled,
} from "@/components/inbox-sidebar-rename";
import { NewSessionDialog } from "@/components/new-session-dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { useSidebar } from "@/components/ui/sidebar";
import { useSession } from "@/hooks/use-session";
import type { SessionWithUnread } from "@/hooks/use-sessions";
import type { SessionScope } from "@/lib/db/sessions";
import type { Session as AuthSession } from "@/lib/session/types";

type CreateSessionInput = {
  repoOwner?: string;
  repoName?: string;
  branch?: string;
  cloneUrl?: string;
  isNewBranch: boolean;
  sandboxType: "hybrid" | "vercel" | "just-bash";
};

type InboxSidebarProps = {
  sessions: SessionWithUnread[];
  archivedCount: number;
  sessionsLoading: boolean;
  sessionScope: SessionScope;
  onSessionScopeChange: (scope: SessionScope) => void;
  activeSessionId: string;
  onSessionClick: (session: SessionWithUnread) => void;
  onSessionPrefetch: (session: SessionWithUnread) => void;
  onRenameSession: (sessionId: string, title: string) => Promise<void>;
  onArchiveSession: (sessionId: string) => Promise<void>;
  onTeamSwitch?: () => Promise<unknown> | void;
  createSession: (input: CreateSessionInput) => Promise<{
    session: { id: string };
    chat: { id: string };
  }>;
  lastRepo: { owner: string; repo: string } | null;
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

const ARCHIVED_SESSIONS_PAGE_SIZE = 50;

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
      {added !== null ? <span className="text-green-500">+{added}</span> : null}
      {removed !== null ? (
        <span className="text-red-400">-{removed}</span>
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
      <span className="flex items-center gap-0.5 text-[10px] text-purple-400">
        <GitMerge className="h-2.5 w-2.5" />
        <span>#{prNumber}</span>
      </span>
    );
  }

  return <span className="text-[10px] text-muted-foreground">#{prNumber}</span>;
}

type SessionRowProps = {
  session: SessionWithUnread;
  isActive: boolean;
  onSessionClick: (session: SessionWithUnread) => void;
  onSessionPrefetch: (session: SessionWithUnread) => void;
  onOpenRenameDialog: (session: SessionWithUnread) => void;
  onArchiveSession: (session: SessionWithUnread) => void;
};

const SessionRow = memo(function SessionRow({
  session,
  isActive,
  onSessionClick,
  onSessionPrefetch,
  onOpenRenameDialog,
  onArchiveSession,
}: SessionRowProps) {
  const isWorking = session.hasStreaming;
  const isUnread = session.hasUnread && !isActive;
  const createdAtLabel = useMemo(
    () => formatRelativeTime(new Date(session.createdAt)),
    [session.createdAt],
  );

  return (
    <div
      className={`group relative flex w-full items-start gap-2.5 rounded-lg px-3 py-2.5 text-left transition-colors ${
        isActive ? "bg-sidebar-active" : "hover:bg-muted/50"
      }`}
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
        >
          <div className="flex items-baseline justify-between gap-2">
            <p
              className={`truncate text-sm ${
                isUnread || isWorking
                  ? "font-semibold text-foreground"
                  : "font-medium text-foreground"
              }`}
            >
              {session.title}
            </p>
            <span className="shrink-0 text-[11px] text-muted-foreground">
              {createdAtLabel}
            </span>
          </div>

          <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
            {session.repoName && (
              <span className="truncate">
                {session.repoName}
                {session.branch && (
                  <span className="text-muted-foreground/50">
                    /{session.branch}
                  </span>
                )}
              </span>
            )}
            {!session.repoName && isWorking && (
              <span className="text-muted-foreground/60">Working...</span>
            )}
            <span className="ml-auto flex shrink-0 items-center gap-1.5">
              <PrBadge prNumber={session.prNumber} status={session.prStatus} />
              <DiffStats
                added={session.linesAdded}
                removed={session.linesRemoved}
              />
            </span>
          </div>
        </button>
      </div>

      {session.isOwnedByCurrentUser ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              onClick={(e) => e.stopPropagation()}
              className="absolute right-2 top-2.5 rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-background/60 hover:text-foreground group-hover:opacity-100"
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
      ) : null}
    </div>
  );
}, areSessionRowsEqual);

function areSessionRowsEqual(
  prev: SessionRowProps,
  next: SessionRowProps,
): boolean {
  if (prev.isActive !== next.isActive) {
    return false;
  }

  return (
    prev.session.id === next.session.id &&
    prev.session.title === next.session.title &&
    prev.session.hasStreaming === next.session.hasStreaming &&
    prev.session.hasUnread === next.session.hasUnread &&
    prev.session.isOwnedByCurrentUser === next.session.isOwnedByCurrentUser &&
    prev.session.repoName === next.session.repoName &&
    prev.session.branch === next.session.branch &&
    prev.session.prNumber === next.session.prNumber &&
    prev.session.prStatus === next.session.prStatus &&
    prev.session.linesAdded === next.session.linesAdded &&
    prev.session.linesRemoved === next.session.linesRemoved &&
    String(prev.session.createdAt) === String(next.session.createdAt)
  );
}

export function InboxSidebar({
  sessions,
  archivedCount,
  sessionsLoading,
  sessionScope,
  onSessionScopeChange,
  activeSessionId,
  onSessionClick,
  onSessionPrefetch,
  onRenameSession,
  onArchiveSession,
  onTeamSwitch,
  createSession,
  lastRepo,
  initialUser,
}: InboxSidebarProps) {
  const router = useRouter();
  const { session, teams, activeTeamId, setActiveTeam, refreshSession } =
    useSession();
  const { isMobile, setOpenMobile } = useSidebar();
  const [showArchived, setShowArchived] = useState(false);
  const [archivedSessions, setArchivedSessions] = useState<SessionWithUnread[]>(
    [],
  );
  const [archivedSessionsLoading, setArchivedSessionsLoading] = useState(false);
  const [archivedSessionsError, setArchivedSessionsError] = useState<
    string | null
  >(null);
  const [hasMoreArchivedSessions, setHasMoreArchivedSessions] = useState(false);
  const archivedRequestInFlightRef = useRef(false);
  const [newSessionOpen, setNewSessionOpen] = useState(false);
  const [renameDialogSession, setRenameDialogSession] =
    useState<SessionWithUnread | null>(null);
  const [renameTitle, setRenameTitle] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [isSwitchingTeam, setIsSwitchingTeam] = useState(false);
  const [teamSwitchError, setTeamSwitchError] = useState<string | null>(null);
  const [createTeamOpen, setCreateTeamOpen] = useState(false);
  const [createTeamName, setCreateTeamName] = useState("");
  const [createTeamError, setCreateTeamError] = useState<string | null>(null);
  const [isCreatingTeam, setIsCreatingTeam] = useState(false);
  const [inviteMemberOpen, setInviteMemberOpen] = useState(false);
  const [inviteUsername, setInviteUsername] = useState("");
  const [inviteMemberError, setInviteMemberError] = useState<string | null>(
    null,
  );
  const [isInvitingMember, setIsInvitingMember] = useState(false);
  const renameInputRef = useRef<HTMLInputElement | null>(null);

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
          scope: sessionScope,
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

          const existingIds = new Set(current.map((session) => session.id));
          const nextSessions = data.sessions.filter(
            (session) => !existingIds.has(session.id),
          );

          return [...current, ...nextSessions];
        });
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
    [sessionScope],
  );

  useEffect(() => {
    if (renameDialogSession && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renameDialogSession]);

  useEffect(() => {
    setArchivedSessions([]);
    setHasMoreArchivedSessions(false);
    setArchivedSessionsError(null);
  }, [sessionScope]);

  useEffect(() => {
    if (!showArchived) {
      return;
    }

    if (archivedCount === 0) {
      setArchivedSessions([]);
      setHasMoreArchivedSessions(false);
      setArchivedSessionsError(null);
      return;
    }

    void fetchArchivedSessionsPage({ offset: 0, replace: true });
  }, [archivedCount, fetchArchivedSessionsPage, showArchived]);

  const activeSessions = sessions;
  const displayedSessions = showArchived ? archivedSessions : activeSessions;
  const showLoadingSkeleton =
    (!showArchived && sessionsLoading && sessions.length === 0) ||
    (showArchived && archivedSessionsLoading && archivedSessions.length === 0);
  const sidebarUser = session?.user ?? initialUser;
  const currentTeam = useMemo(
    () => teams.find((team) => team.id === activeTeamId) ?? teams[0],
    [activeTeamId, teams],
  );
  const canInviteMembers = Boolean(
    currentTeam && !currentTeam.isPersonal && currentTeam.role === "owner",
  );

  const handleSessionClick = useCallback(
    (session: SessionWithUnread) => {
      if (isMobile) {
        setOpenMobile(false);
      }
      onSessionClick(session);
    },
    [isMobile, onSessionClick, setOpenMobile],
  );

  const handleSessionPrefetch = useCallback(
    (session: SessionWithUnread) => {
      onSessionPrefetch(session);
    },
    [onSessionPrefetch],
  );

  const handleArchiveSession = useCallback(
    async (session: SessionWithUnread) => {
      try {
        await onArchiveSession(session.id);
      } catch (err) {
        console.error("Failed to archive session:", err);
      }
    },
    [onArchiveSession],
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

  const handleTeamSwitch = useCallback(
    async (nextTeamId: string) => {
      if (isSwitchingTeam || nextTeamId === activeTeamId) {
        return;
      }

      setTeamSwitchError(null);
      setIsSwitchingTeam(true);

      try {
        await setActiveTeam(nextTeamId);
        setShowArchived(false);
        setArchivedSessions([]);
        setHasMoreArchivedSessions(false);
        setArchivedSessionsError(null);
        await onTeamSwitch?.();

        if (activeSessionId) {
          router.push("/sessions");
          router.refresh();
        }

        if (isMobile) {
          setOpenMobile(false);
        }
      } catch (error) {
        setTeamSwitchError(
          error instanceof Error ? error.message : "Failed to switch team",
        );
      } finally {
        setIsSwitchingTeam(false);
      }
    },
    [
      activeSessionId,
      activeTeamId,
      isMobile,
      isSwitchingTeam,
      onTeamSwitch,
      router,
      setActiveTeam,
      setOpenMobile,
    ],
  );

  const handleOpenCreateTeam = useCallback(() => {
    setCreateTeamName("");
    setCreateTeamError(null);
    setCreateTeamOpen(true);
  }, []);

  const handleCreateTeam = useCallback(async () => {
    const teamName = createTeamName.trim();
    if (!teamName) {
      setCreateTeamError("Team name is required");
      return;
    }

    setCreateTeamError(null);
    setIsCreatingTeam(true);

    try {
      const response = await fetch("/api/teams", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: teamName,
          switchToTeam: true,
        }),
      });
      const data = (await response.json()) as { error?: string };

      if (!response.ok) {
        throw new Error(data.error ?? "Failed to create team");
      }

      await refreshSession();
      await onTeamSwitch?.();

      setShowArchived(false);
      setArchivedSessions([]);
      setHasMoreArchivedSessions(false);
      setArchivedSessionsError(null);
      setCreateTeamOpen(false);
      setCreateTeamName("");

      if (activeSessionId) {
        router.push("/sessions");
        router.refresh();
      }

      if (isMobile) {
        setOpenMobile(false);
      }
    } catch (error) {
      setCreateTeamError(
        error instanceof Error ? error.message : "Failed to create team",
      );
    } finally {
      setIsCreatingTeam(false);
    }
  }, [
    activeSessionId,
    createTeamName,
    isMobile,
    onTeamSwitch,
    refreshSession,
    router,
    setOpenMobile,
  ]);

  const handleOpenInviteMember = useCallback(() => {
    if (!canInviteMembers) {
      return;
    }

    setInviteUsername("");
    setInviteMemberError(null);
    setInviteMemberOpen(true);
  }, [canInviteMembers]);

  const handleInviteMember = useCallback(async () => {
    if (!currentTeam) {
      return;
    }

    const username = inviteUsername.trim();
    if (!username) {
      setInviteMemberError("Username is required");
      return;
    }

    setInviteMemberError(null);
    setIsInvitingMember(true);

    try {
      const response = await fetch(`/api/teams/${currentTeam.id}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username }),
      });
      const data = (await response.json()) as { error?: string };

      if (!response.ok) {
        throw new Error(data.error ?? "Failed to invite member");
      }

      setInviteMemberOpen(false);
      setInviteUsername("");
    } catch (error) {
      setInviteMemberError(
        error instanceof Error ? error.message : "Failed to invite member",
      );
    } finally {
      setIsInvitingMember(false);
    }
  }, [currentTeam, inviteUsername]);

  const closeRenameDialog = useCallback(() => {
    setRenameDialogSession(null);
    setRenameTitle("");
    setRenaming(false);
  }, []);

  const handleOpenRenameDialog = useCallback((session: SessionWithUnread) => {
    setRenameDialogSession(session);
    setRenameTitle(session.title);
  }, []);

  const handleRenameSubmit = useCallback(async () => {
    if (!renameDialogSession) {
      return;
    }

    const nextTitle = getValidRenameTitle({
      draftTitle: renameTitle,
      originalTitle: renameDialogSession.title,
    });
    if (!nextTitle) {
      closeRenameDialog();
      return;
    }

    setRenaming(true);
    try {
      await onRenameSession(renameDialogSession.id, nextTitle);
      setArchivedSessions((current) =>
        current.map((session) =>
          session.id === renameDialogSession.id
            ? { ...session, title: nextTitle }
            : session,
        ),
      );
      closeRenameDialog();
    } catch (err) {
      console.error("Failed to rename session:", err);
      setRenaming(false);
    }
  }, [closeRenameDialog, onRenameSession, renameDialogSession, renameTitle]);

  const isSaveDisabled = isRenameSaveDisabled({
    renaming,
    hasTargetSession: Boolean(renameDialogSession),
    draftTitle: renameTitle,
    originalTitle: renameDialogSession?.title ?? null,
  });

  return (
    <>
      <div className="border-b border-border p-3">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center px-2 py-1.5 text-sm text-primary">
            <span>Sessions</span>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => setNewSessionOpen(true)}
            className="h-7 w-7"
          >
            <Plus className="h-4 w-4" />
          </Button>
        </div>

        <div className="mb-2 flex gap-1">
          <button
            type="button"
            onClick={() => onSessionScopeChange("mine")}
            className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
              sessionScope === "mine"
                ? "bg-muted text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Mine
          </button>
          <button
            type="button"
            onClick={() => onSessionScopeChange("team")}
            className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
              sessionScope === "team"
                ? "bg-muted text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Team
          </button>
        </div>

        <div className="flex gap-1">
          <button
            type="button"
            onClick={() => setShowArchived(false)}
            className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
              !showArchived
                ? "bg-muted text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Active
            {activeSessions.length > 0 && (
              <span className="ml-1.5 text-muted-foreground">
                {activeSessions.length}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={() => setShowArchived(true)}
            className={`flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
              showArchived
                ? "bg-muted text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Archive className="h-3 w-3" />
            Archive
            {archivedCount > 0 && (
              <span className="ml-1 text-muted-foreground">
                {archivedCount}
              </span>
            )}
          </button>
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
        ) : displayedSessions.length === 0 ? (
          <div className="px-4 py-12 text-center text-sm text-muted-foreground">
            {showArchived
              ? (archivedSessionsError ?? "No archived sessions")
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
            <div className="space-y-px p-1.5">
              {displayedSessions.map((session) => (
                <SessionRow
                  key={session.id}
                  session={session}
                  isActive={session.id === activeSessionId}
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

      {sidebarUser ? (
        <div className="border-t border-border p-3">
          {currentTeam ? (
            <div className="mb-2">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    disabled={isSwitchingTeam}
                    className="flex w-full items-center justify-between rounded-lg border border-border bg-background px-2.5 py-2 text-left transition-colors hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <span className="min-w-0">
                      <span className="block text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                        Team
                      </span>
                      <span className="block truncate text-sm font-medium text-foreground">
                        {currentTeam.name}
                      </span>
                    </span>
                    <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-64">
                  {teams.map((team) => {
                    const teamRoleLabel = team.isPersonal
                      ? "Personal"
                      : team.role === "owner"
                        ? "Owner"
                        : "Member";
                    const isActive = team.id === activeTeamId;

                    return (
                      <DropdownMenuItem
                        key={team.id}
                        disabled={isSwitchingTeam || isActive}
                        onClick={() => {
                          void handleTeamSwitch(team.id);
                        }}
                        className="flex items-start justify-between gap-2"
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-sm text-foreground">
                            {team.name}
                          </span>
                          <span className="block text-xs text-muted-foreground">
                            {teamRoleLabel}
                          </span>
                        </span>
                        {isActive ? (
                          <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        ) : null}
                      </DropdownMenuItem>
                    );
                  })}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    disabled={isCreatingTeam}
                    onClick={handleOpenCreateTeam}
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Create team
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={!canInviteMembers || isInvitingMember}
                    onClick={handleOpenInviteMember}
                  >
                    <UserPlus className="h-3.5 w-3.5" />
                    Invite member
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              {teamSwitchError ? (
                <p className="mt-1.5 text-xs text-red-500">{teamSwitchError}</p>
              ) : null}
            </div>
          ) : null}
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

      <Dialog
        open={Boolean(renameDialogSession)}
        onOpenChange={(open) => {
          if (!open) {
            closeRenameDialog();
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit session</DialogTitle>
            <DialogDescription>
              Update the session name shown in your sidebar.
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void handleRenameSubmit();
            }}
            className="space-y-4"
          >
            <Input
              ref={renameInputRef}
              value={renameTitle}
              onChange={(e) => setRenameTitle(e.target.value)}
              placeholder="Session title"
              maxLength={120}
              disabled={renaming}
            />
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={closeRenameDialog}
                disabled={renaming}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isSaveDisabled}>
                {renaming ? "Saving..." : "Save"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={createTeamOpen}
        onOpenChange={(open) => {
          setCreateTeamOpen(open);
          if (!open) {
            setCreateTeamError(null);
            setCreateTeamName("");
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Create team</DialogTitle>
            <DialogDescription>
              Create a shared team workspace for collaborative sessions.
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void handleCreateTeam();
            }}
            className="space-y-4"
          >
            <Input
              value={createTeamName}
              onChange={(e) => setCreateTeamName(e.target.value)}
              placeholder="Team name"
              maxLength={80}
              disabled={isCreatingTeam}
            />
            {createTeamError ? (
              <p className="text-xs text-red-500">{createTeamError}</p>
            ) : null}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setCreateTeamOpen(false)}
                disabled={isCreatingTeam}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={isCreatingTeam || createTeamName.trim().length === 0}
              >
                {isCreatingTeam ? "Creating..." : "Create team"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={inviteMemberOpen}
        onOpenChange={(open) => {
          setInviteMemberOpen(open);
          if (!open) {
            setInviteMemberError(null);
            setInviteUsername("");
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Invite member</DialogTitle>
            <DialogDescription>
              Add a teammate by username to {currentTeam?.name ?? "this team"}.
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void handleInviteMember();
            }}
            className="space-y-4"
          >
            <Input
              value={inviteUsername}
              onChange={(e) => setInviteUsername(e.target.value)}
              placeholder="Username"
              maxLength={80}
              disabled={isInvitingMember}
            />
            {inviteMemberError ? (
              <p className="text-xs text-red-500">{inviteMemberError}</p>
            ) : null}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setInviteMemberOpen(false)}
                disabled={isInvitingMember}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={
                  isInvitingMember || inviteUsername.trim().length === 0
                }
              >
                {isInvitingMember ? "Inviting..." : "Invite"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <NewSessionDialog
        open={newSessionOpen}
        onOpenChange={setNewSessionOpen}
        lastRepo={lastRepo}
        createSession={createSession}
      />
    </>
  );
}

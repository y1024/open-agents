"use client";

import { ArrowUp, ExternalLink, GitPullRequest, Play, Zap } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import {
  useAutomations,
  useAutomationStats,
  useAllAutomationRuns,
  type AutomationRunWithName,
} from "@/hooks/use-automations";

function formatShortDate(value: string | null) {
  if (!value) return "--";
  const date = new Date(value);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 30) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

function getRunStatusDotColor(status: string) {
  switch (status) {
    case "completed":
      return "bg-emerald-500";
    case "running":
      return "bg-blue-500 animate-pulse";
    case "queued":
      return "bg-blue-400";
    case "needs_attention":
      return "bg-amber-500";
    case "failed":
    case "cancelled":
      return "bg-red-500";
    default:
      return "bg-zinc-400";
  }
}

function StatsBar() {
  const { stats, isLoading } = useAutomationStats();

  if (isLoading) {
    return (
      <div className="grid grid-cols-3 divide-x divide-border/60 rounded-lg border border-border/70">
        {[1, 2, 3].map((i) => (
          <div key={i} className="space-y-1.5 px-4 py-3">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-6 w-10" />
          </div>
        ))}
      </div>
    );
  }

  if (!stats) return null;

  const successRate =
    stats.runs7d.total > 0
      ? ((stats.runs7d.successful / stats.runs7d.total) * 100).toFixed(0)
      : "0";

  return (
    <div className="grid grid-cols-3 divide-x divide-border/60 rounded-lg border border-border/70">
      <div className="px-4 py-3">
        <p className="text-xs text-muted-foreground">Total Automations</p>
        <p className="text-xl font-semibold tabular-nums">
          {stats.totalAutomations}
        </p>
      </div>
      <div className="px-4 py-3">
        <p className="text-xs text-muted-foreground">Total Runs (7d)</p>
        <p className="text-xl font-semibold tabular-nums">
          {stats.runs7d.total}
        </p>
      </div>
      <div className="px-4 py-3">
        <p className="text-xs text-muted-foreground">Successful (7d)</p>
        <p className="text-xl font-semibold tabular-nums">
          {stats.runs7d.successful}{" "}
          <span className="text-sm font-normal text-muted-foreground">
            {successRate}%
          </span>
        </p>
      </div>
    </div>
  );
}

function QuickCreateInput() {
  const router = useRouter();
  const [value, setValue] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = value.trim();
    if (!trimmed) return;
    router.push(
      `/settings/automations/new?instructions=${encodeURIComponent(trimmed)}`,
    );
  }

  return (
    <form onSubmit={handleSubmit} className="relative">
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            handleSubmit(e);
          }
        }}
        placeholder="Describe what this automation should do..."
        rows={3}
        className="border-input placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 dark:bg-input/30 w-full resize-none rounded-lg border bg-transparent px-3 py-3 pr-12 text-sm shadow-xs outline-none transition-[color,box-shadow] focus-visible:ring-[3px]"
      />
      <Button
        type="submit"
        size="icon"
        disabled={!value.trim()}
        className="absolute right-2 bottom-2 h-8 w-8 rounded-full bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-30"
      >
        <ArrowUp className="h-4 w-4" />
      </Button>
    </form>
  );
}

function AutomationsTable() {
  const router = useRouter();
  const { automations, isLoading, runNow } = useAutomations();

  if (isLoading) {
    return (
      <div className="space-y-2">
        {[1, 2, 3].map((i) => (
          <div key={i} className="flex items-center gap-3 px-2 py-3">
            <Skeleton className="h-2 w-2 rounded-full" />
            <Skeleton className="h-4 w-40" />
            <Skeleton className="ml-auto h-4 w-24" />
          </div>
        ))}
      </div>
    );
  }

  if (automations.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Zap />
          </EmptyMedia>
          <EmptyTitle>No automations yet</EmptyTitle>
          <EmptyDescription>
            Create one to start recurring repo work.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button asChild>
            <Link href="/settings/automations/new">New automation</Link>
          </Button>
        </EmptyContent>
      </Empty>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Automation</TableHead>
          <TableHead className="hidden sm:table-cell">Schedule</TableHead>
          <TableHead className="hidden md:table-cell">Last Run</TableHead>
          <TableHead className="hidden lg:table-cell">Tools</TableHead>
          <TableHead className="w-12" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {automations.map((automation) => (
          <TableRow key={automation.id}>
            <TableCell>
              <Link
                href={`/settings/automations/${automation.id}`}
                className="flex items-center gap-2 hover:underline"
              >
                <span
                  className={cn(
                    "h-2 w-2 shrink-0 rounded-full",
                    automation.enabled ? "bg-emerald-500" : "bg-zinc-400",
                  )}
                />
                <span className="font-medium">{automation.name}</span>
              </Link>
            </TableCell>
            <TableCell className="hidden text-muted-foreground sm:table-cell">
              {automation.scheduleSummary}
            </TableCell>
            <TableCell className="hidden md:table-cell">
              {automation.lastRunStatus ? (
                <span className="flex items-center gap-1.5">
                  <span
                    className={cn(
                      "h-1.5 w-1.5 rounded-full",
                      getRunStatusDotColor(automation.lastRunStatus),
                    )}
                  />
                  <span className="text-xs text-muted-foreground">
                    {automation.lastRunStatus.replaceAll("_", " ")}
                  </span>
                  <span className="text-xs text-muted-foreground/60">
                    {formatShortDate(automation.lastRunAt)}
                  </span>
                </span>
              ) : (
                <span className="text-xs text-muted-foreground">--</span>
              )}
            </TableCell>
            <TableCell className="hidden lg:table-cell">
              {automation.enabledToolTypes.length > 0 ? (
                <span className="flex gap-1">
                  {automation.enabledToolTypes.map((t) => (
                    <span
                      key={t}
                      className="inline-flex items-center rounded-full border border-border px-1.5 py-0 text-[10px] uppercase tracking-wide text-muted-foreground"
                    >
                      {t.replaceAll("_", " ")}
                    </span>
                  ))}
                </span>
              ) : (
                <span className="text-xs text-muted-foreground">--</span>
              )}
            </TableCell>
            <TableCell>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 w-7 p-0"
                onClick={async () => {
                  const result = await runNow(automation.id);
                  router.push(
                    `/sessions/${result.session.id}/chats/${result.chat.id}`,
                  );
                }}
              >
                <Play className="h-3.5 w-3.5" />
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function RunHistoryTable() {
  const { runs, isLoading } = useAllAutomationRuns();

  if (isLoading) {
    return (
      <div className="space-y-2">
        {[1, 2, 3].map((i) => (
          <div key={i} className="flex items-center gap-3 px-2 py-3">
            <Skeleton className="h-2 w-2 rounded-full" />
            <Skeleton className="h-4 w-32" />
            <Skeleton className="ml-auto h-4 w-20" />
          </div>
        ))}
      </div>
    );
  }

  if (runs.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Zap />
          </EmptyMedia>
          <EmptyTitle>No runs yet</EmptyTitle>
          <EmptyDescription>
            Runs from all automations will appear here.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Automation</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="hidden sm:table-cell">Triggered</TableHead>
          <TableHead className="hidden md:table-cell">Summary</TableHead>
          <TableHead className="w-20" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {runs.map((run) => (
          <RunHistoryTableRow key={run.id} run={run} />
        ))}
      </TableBody>
    </Table>
  );
}

function RunHistoryTableRow({ run }: { run: AutomationRunWithName }) {
  const automationLabel = (
    <>
      <span
        className={cn(
          "h-2 w-2 shrink-0 rounded-full",
          run.automationDeleted
            ? "bg-zinc-300"
            : run.automationEnabled
              ? "bg-emerald-500"
              : "bg-zinc-400",
        )}
      />
      <span>{run.automationName}</span>
      {run.automationDeleted ? (
        <span className="rounded-full border border-border px-1.5 py-0 text-[10px] uppercase tracking-wide text-muted-foreground">
          Deleted
        </span>
      ) : null}
    </>
  );

  return (
    <TableRow>
      <TableCell>
        <Link
          href={`/settings/automations/${run.automationId}`}
          className="flex items-center gap-2 text-sm font-medium hover:underline"
        >
          {automationLabel}
        </Link>
      </TableCell>
      <TableCell>
        <span className="flex items-center gap-1.5">
          <span
            className={cn(
              "h-1.5 w-1.5 rounded-full",
              getRunStatusDotColor(run.status),
            )}
          />
          <span className="text-xs">{run.status.replaceAll("_", " ")}</span>
        </span>
      </TableCell>
      <TableCell className="hidden text-xs text-muted-foreground sm:table-cell">
        {formatShortDate(run.triggeredAt)}
      </TableCell>
      <TableCell className="hidden max-w-xs truncate text-xs text-muted-foreground md:table-cell">
        {run.resultSummary ?? "--"}
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-1">
          {run.sessionId ? (
            <Button asChild size="sm" variant="ghost" className="h-7 px-2">
              <Link href={`/sessions/${run.sessionId}`}>
                <ExternalLink className="h-3.5 w-3.5" />
              </Link>
            </Button>
          ) : null}
          {run.prUrl ? (
            <Button asChild size="sm" variant="ghost" className="h-7 px-2">
              <a href={run.prUrl} rel="noreferrer" target="_blank">
                <GitPullRequest className="h-3.5 w-3.5" />
              </a>
            </Button>
          ) : null}
        </div>
      </TableCell>
    </TableRow>
  );
}

export function AutomationsListPage() {
  return (
    <>
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">Automations</h1>
        <Button asChild>
          <Link href="/settings/automations/new">New automation</Link>
        </Button>
      </div>

      <StatsBar />
      <QuickCreateInput />

      <Tabs defaultValue="automations">
        <TabsList>
          <TabsTrigger value="automations">Automations</TabsTrigger>
          <TabsTrigger value="runs">Run History</TabsTrigger>
        </TabsList>
        <TabsContent value="automations">
          <AutomationsTable />
        </TabsContent>
        <TabsContent value="runs">
          <RunHistoryTable />
        </TabsContent>
      </Tabs>
    </>
  );
}

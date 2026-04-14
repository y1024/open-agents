"use client";

import { useCallback } from "react";
import { toast } from "sonner";
import useSWR from "swr";
import { fetcher } from "@/lib/swr";
import type {
  AutomationRunNowInput,
  AutomationUpsertInput,
} from "@/lib/automations/types";

export interface AutomationRunRecord {
  id: string;
  sessionId: string | null;
  chatId: string | null;
  status: string;
  triggeredAt: string;
  finishedAt: string | null;
  resultSummary: string | null;
  prUrl: string | null;
  compareUrl: string | null;
  needsAttentionReason: string | null;
}

export interface AutomationRecord {
  id: string;
  name: string;
  instructions: string;
  repoOwner: string;
  repoName: string;
  cloneUrl: string | null;
  baseBranch: string;
  modelId: string;
  enabled: boolean;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastRunStatus: string | null;
  lastRunSummary: string | null;
  deletedAt: string | null;
  scheduleSummary: string;
  enabledToolTypes: string[];
  triggers: Array<{
    id: string;
    type: string;
    enabled: boolean;
    config: AutomationUpsertInput["triggers"][number];
  }>;
  tools: Array<{
    id: string;
    toolType: string;
    enabled: boolean;
    config: AutomationUpsertInput["tools"][number];
  }>;
  latestRun?: AutomationRunRecord | null;
  connections: Array<{
    id: string;
    provider: string;
    connectionRef: string;
    enabled: boolean;
    config: Record<string, unknown>;
  }>;
}

type AutomationListResponse = {
  automations: AutomationRecord[];
};

type AutomationDetailResponse = {
  automation: AutomationRecord;
  runs: AutomationRunRecord[];
};

async function sendJson<T>(url: string, init: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init.headers,
    },
  });

  const body = (await response.json().catch(() => ({}))) as {
    error?: string;
  } & T;

  if (!response.ok) {
    throw new Error(body.error ?? "Request failed");
  }

  return body;
}

export function useAutomations() {
  const { data, error, isLoading, mutate } = useSWR<AutomationListResponse>(
    "/api/automations",
    fetcher,
  );

  const createAutomation = useCallback(
    async (input: AutomationUpsertInput) => {
      const response = await sendJson<{ automation: AutomationRecord }>(
        "/api/automations",
        {
          method: "POST",
          body: JSON.stringify(input),
        },
      );

      await mutate();
      return response.automation;
    },
    [mutate],
  );

  const updateAutomation = useCallback(
    async (automationId: string, input: AutomationUpsertInput) => {
      const response = await sendJson<{ automation: AutomationRecord }>(
        `/api/automations/${automationId}`,
        {
          method: "PATCH",
          body: JSON.stringify(input),
        },
      );

      await mutate();
      return response.automation;
    },
    [mutate],
  );

  const deleteAutomation = useCallback(
    async (automationId: string) => {
      await sendJson(`/api/automations/${automationId}`, {
        method: "DELETE",
      });
      await mutate();
    },
    [mutate],
  );

  const runNow = useCallback(
    async (automationId: string, input?: AutomationRunNowInput) => {
      const response = await sendJson<{
        runId: string;
        session: { id: string };
        chat: { id: string };
      }>(`/api/automations/${automationId}/run`, {
        method: "POST",
        body: JSON.stringify(input ?? { trigger: "manual" }),
      });

      toast.success("Automation run started");
      await mutate();
      return response;
    },
    [mutate],
  );

  return {
    automations: data?.automations ?? [],
    error,
    isLoading,
    createAutomation,
    updateAutomation,
    deleteAutomation,
    runNow,
  };
}

export function useAutomationDetail(automationId: string | null) {
  const { data, error, isLoading, mutate } = useSWR<AutomationDetailResponse>(
    automationId ? `/api/automations/${automationId}` : null,
    fetcher,
  );

  return {
    automation: data?.automation ?? null,
    runs: data?.runs ?? [],
    error,
    isLoading,
    mutate,
  };
}

type AutomationStatsResponse = {
  totalAutomations: number;
  enabledAutomations: number;
  runs7d: {
    successful: number;
    failed: number;
    total: number;
  };
};

export function useAutomationStats() {
  const { data, error, isLoading } = useSWR<AutomationStatsResponse>(
    "/api/automations/stats",
    fetcher,
  );

  return {
    stats: data ?? null,
    error,
    isLoading,
  };
}

export interface AutomationRunWithName extends AutomationRunRecord {
  automationId: string;
  automationName: string;
  automationEnabled: boolean;
  automationDeleted: boolean;
}

type AllRunsResponse = {
  runs: AutomationRunWithName[];
};

export function useAllAutomationRuns() {
  const { data, error, isLoading } = useSWR<AllRunsResponse>(
    "/api/automations/runs",
    fetcher,
  );

  return {
    runs: data?.runs ?? [],
    error,
    isLoading,
  };
}

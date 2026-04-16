"use client";

import { useState } from "react";
import useSWR from "swr";
import { Check, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useSession } from "@/hooks/use-session";
import { fetcher } from "@/lib/swr";

interface VercelTeam {
  id: string;
  slug: string;
  name: string;
  avatar: string | null;
  membership: { role: string };
}

interface TeamsResponse {
  teams: VercelTeam[];
}

interface OnboardingStatus {
  teamId: string | null;
  teamSlug: string | null;
  hasGatewayKey: boolean;
}

function VercelIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 76 65" fill="currentColor">
      <path d="M37.5274 0L75.0548 65H0L37.5274 0Z" />
    </svg>
  );
}

export function VercelSectionSkeleton() {
  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-border/50 bg-muted/10">
        <div className="flex items-center justify-between border-b border-border/50 px-4 py-3">
          <div className="flex items-center gap-3">
            <Skeleton className="h-5 w-5 rounded" />
            <Skeleton className="h-4 w-16" />
          </div>
          <Skeleton className="h-8 w-40" />
        </div>
        <div className="p-4">
          <div className="flex items-center justify-between rounded-lg border border-border/50 p-3">
            <div className="space-y-1">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-3 w-48" />
            </div>
            <Skeleton className="h-9 w-48" />
          </div>
        </div>
      </div>
    </div>
  );
}

export function VercelSection() {
  const { session } = useSession();
  const [isSwitching, setIsSwitching] = useState(false);

  const { data: teamsData } = useSWR<TeamsResponse>(
    "/api/vercel/teams",
    fetcher,
  );

  const {
    data: statusData,
    mutate: mutateStatus,
  } = useSWR<OnboardingStatus>("/api/onboarding/status", fetcher);

  const teams = teamsData?.teams ?? [];
  const currentTeamId = statusData?.teamId ?? undefined;
  const currentTeam = teams.find((t) => t.id === currentTeamId);

  async function handleTeamChange(teamId: string) {
    const team = teams.find((t) => t.id === teamId);
    if (!team) return;

    setIsSwitching(true);
    try {
      const res = await fetch("/api/vercel/gateway-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teamId: team.id, teamSlug: team.slug }),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(
          (errorData as { error?: string }).error ||
            "Failed to update billing team",
        );
      }

      await mutateStatus();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to update billing team",
      );
    } finally {
      setIsSwitching(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-border/50 bg-muted/10">
        <div className="flex items-center justify-between border-b border-border/50 px-4 py-3">
          <div className="flex items-center gap-3">
            <VercelIcon className="size-5" />
            <span className="font-medium">Vercel</span>
          </div>
          <p className="hidden text-sm text-muted-foreground sm:block">
            AI model usage is billed through Vercel
          </p>
        </div>
        <div className="p-4">
          <p className="mb-4 text-sm text-muted-foreground">
            Your account is managed through Vercel. AI model usage is billed
            through the selected team&apos;s AI Gateway.
          </p>
          <div className="flex items-center justify-between rounded-lg border border-border/50 p-3">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">Billing Team</span>
              {currentTeam && !isSwitching ? (
                <span className="flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
                  <Check className="size-3" />
                  Connected
                </span>
              ) : !currentTeam && !isSwitching ? (
                <span className="text-xs text-muted-foreground">
                  No team selected
                </span>
              ) : null}
            </div>
            <div className="flex items-center gap-2">
              {isSwitching && (
                <Loader2 className="size-4 animate-spin text-muted-foreground" />
              )}
              <Select
                value={currentTeamId}
                onValueChange={handleTeamChange}
                disabled={isSwitching || !teams.length}
              >
                <SelectTrigger className="w-48">
                  <SelectValue placeholder="Select a team…" />
                </SelectTrigger>
                <SelectContent>
                  {teams.map((team) => (
                    <SelectItem key={team.id} value={team.id}>
                      <div className="flex items-center gap-2">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={`https://vercel.com/api/www/avatar?teamId=${team.id}&s=48`}
                          alt={team.name}
                          className="size-5 rounded-full"
                        />
                        <span>{team.name}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

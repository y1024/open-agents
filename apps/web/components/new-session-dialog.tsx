"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { SandboxType } from "@/components/sandbox-selector-compact";
import { SessionStarter } from "@/components/session-starter";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useSessions } from "@/hooks/use-sessions";

interface NewSessionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lastRepo: { owner: string; repo: string } | null;
}

export function NewSessionDialog({
  open,
  onOpenChange,
  lastRepo,
}: NewSessionDialogProps) {
  const router = useRouter();
  const { createSession } = useSessions({ enabled: true });
  const [isCreating, setIsCreating] = useState(false);

  const handleCreateSession = async (input: {
    repoOwner?: string;
    repoName?: string;
    branch?: string;
    cloneUrl?: string;
    isNewBranch: boolean;
    sandboxType: SandboxType;
  }) => {
    setIsCreating(true);
    try {
      const { session: createdSession, chat } = await createSession({
        repoOwner: input.repoOwner,
        repoName: input.repoName,
        branch: input.branch,
        cloneUrl: input.cloneUrl,
        isNewBranch: input.isNewBranch,
        sandboxType: input.sandboxType,
      });

      onOpenChange(false);
      router.push(`/sessions/${createdSession.id}/chats/${chat.id}`);
    } catch (error) {
      console.error("Failed to create session:", error);
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(96vw,86rem)] max-w-none gap-0 border-none bg-transparent p-0 shadow-none [&>button]:hidden">
        <DialogHeader className="sr-only">
          <DialogTitle>New Session</DialogTitle>
        </DialogHeader>
        <SessionStarter
          onSubmit={handleCreateSession}
          isLoading={isCreating}
          lastRepo={lastRepo}
          className="max-w-none rounded-[28px] border-border/60 bg-card p-8 shadow-[0_10px_30px_rgba(0,0,0,0.08)] backdrop-blur-none supports-[backdrop-filter]:bg-card sm:p-10"
        />
      </DialogContent>
    </Dialog>
  );
}

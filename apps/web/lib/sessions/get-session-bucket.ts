export type SessionBucket = "attention" | "cooking" | "idle" | "done";

export type AttentionReason = "failed" | "lifecycle_failed" | "unread";

export type SessionBucketResult = {
  bucket: SessionBucket;
  reason?: AttentionReason;
};

type SessionBucketInput = {
  status: "running" | "completed" | "failed" | "archived";
  lifecycleState?:
    | "provisioning"
    | "active"
    | "hibernating"
    | "hibernated"
    | "restoring"
    | "archived"
    | "failed"
    | null;
  hasUnread: boolean;
  hasStreaming: boolean;
};

/**
 * Classifies a session into one of four buckets based on its current signals.
 *
 * - **attention**: Something needs human action (failed, unread output).
 * - **cooking**: Agent is actively streaming right now. Hidden by default.
 * - **idle**: Not attention, not streaming, not archived. Visible in sidebar.
 * - **done**: Work is complete (archived). Not shown in sidebar.
 *
 * `hasUnread` only triggers attention when the agent is NOT streaming,
 * because streaming means the agent is still working.
 */
export function getSessionBucket(
  session: SessionBucketInput,
): SessionBucketResult {
  // Session-level failure
  if (session.status === "failed") {
    return { bucket: "attention", reason: "failed" };
  }

  // Sandbox lifecycle failure
  if (session.lifecycleState === "failed") {
    return { bucket: "attention", reason: "lifecycle_failed" };
  }

  // Unread output, but only when agent is not actively streaming
  if (session.hasUnread && !session.hasStreaming) {
    return { bucket: "attention", reason: "unread" };
  }

  // Archived = done
  if (session.status === "archived") {
    return { bucket: "done" };
  }

  // Agent is actively streaming — cooking, hidden by default
  if (session.hasStreaming) {
    return { bucket: "cooking" };
  }

  // Everything else: read, hibernated, PR open, idle, etc.
  return { bucket: "idle" };
}

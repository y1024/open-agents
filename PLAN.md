Summary: Fix the two regressions introduced by the persisted-completion changes: make pending background notifications age out even when refreshes fail or session data stays unchanged, and ensure persisted assistant activity advances when post-finish persistence updates an existing assistant row.

Context: `apps/web/hooks/use-background-chat-notifications.tsx` currently only evaluates pending-candidate timeout inside the `[sessions, activeSessionId]` effect. Once `pendingCount` is non-zero, the polling effect keeps calling `refreshSessions()`, but a failure or unchanged SWR payload does not advance the timeout bookkeeping, so polling can continue forever. Separately, `apps/web/app/api/chat/_lib/persist-tool-results.ts` can eagerly insert the assistant message before the workflow ends, while `apps/web/app/workflows/chat-post-finish.ts` only calls `updateChatAssistantActivity()` when `persistAssistantMessage()` inserts a new row. For tool-result turns that finish as an update, `latestAssistantMessageAt` never moves forward, so completion notifications can wait until timeout even though the response is already durable.

Approach: Keep the existing two-phase notification model, but make timeout pruning independent from session-data changes by reconciling pending candidates against a clock tick during the polling loop. Keep the assistant-persistence contract simple by treating both insert and update as persisted assistant activity, while still preserving the existing conflict guard.

Changes:
- `apps/web/hooks/use-background-chat-notifications.tsx` - extract notification reconciliation into a shared helper, run it from both the sessions-change effect and the polling loop, and prune timed-out pending candidates even when session refreshes fail or return unchanged data.
- `apps/web/hooks/use-background-chat-notifications.test.ts` - add coverage for timeout cleanup when session data does not advance and for the polling reconciliation behavior.
- `apps/web/app/workflows/chat-post-finish.ts` - update assistant activity when `persistAssistantMessage()` either inserts or updates the assistant row, so `latestAssistantMessageAt` remains a reliable persistence-ready signal.
- `apps/web/app/workflows/chat-post-finish.test.ts` - update the persistence tests to assert activity updates on both insert and update, while still skipping conflicts.

Verification:
- Run `bun test apps/web/hooks/use-background-chat-notifications.test.ts`.
- Run `bun test apps/web/app/workflows/chat-post-finish.test.ts`.
- Run `bun test "apps/web/app/api/sessions/[sessionId]/chats/[chatId]/messages/route.test.ts"`.
- Run `bun test "apps/web/app/sessions/[sessionId]/chats/[chatId]/page.test.ts"`.
- Run `bun run typecheck`.
- Run `bun run ci`.
- Edge cases to check: pending completion polling stops after timeout even when refreshes fail or sessions data stays unchanged; a tool-result turn that persisted the assistant row early still produces a completion notification once post-finish persistence runs.
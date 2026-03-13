# API Route Refactor Plan

## Goal
Apply the same refactor style used in `apps/web/app/api/chat/` to other API routes with repeated auth/ownership logic and large inline control flow.

## Refactor Pattern We Are Following
- Extract repeated request guards into focused helper modules.
- Keep route handlers small and orchestration-focused.
- Preserve behavior/status codes exactly.
- Validate with existing project scripts after each refactor pass.

## Phase 1 — Sessions Chat Subtree (completed)
Target routes:
- `apps/web/app/api/sessions/[sessionId]/chats/route.ts`
- `apps/web/app/api/sessions/[sessionId]/chats/[chatId]/route.ts`
- `apps/web/app/api/sessions/[sessionId]/chats/[chatId]/read/route.ts`
- `apps/web/app/api/sessions/[sessionId]/chats/[chatId]/messages/[messageId]/route.ts`
- `apps/web/app/api/sessions/[sessionId]/chats/[chatId]/share/route.ts`

Checklist:
- [x] Add shared sessions chat context helper (auth + owned session/chat guards)
- [x] Refactor target routes to use helper
- [x] Run typecheck/lint/tests for affected app
- [x] Record completion notes

Completion notes:
- Added `apps/web/app/api/sessions/_lib/session-context.ts` with shared guards:
  - `requireAuthenticatedUser`
  - `requireOwnedSession`
  - `requireOwnedSessionChat`
- Refactored all Phase 1 target routes to use shared guards and keep handler logic focused on endpoint-specific behavior.
- Verification run:
  - `bun run typecheck --filter=web` ✅
  - `bun run lint --filter=web` ✅ (existing max-lines warnings in unrelated files)
  - `bun test <target-file>` ✅ (targeted API route tests used for deterministic verification)
  - `bun run build --filter=web` ✅

## Phase 1.1 — Sessions Chat Regression Tests (completed)
Target tests:
- `apps/web/app/api/sessions/_lib/session-context.test.ts`
- `apps/web/app/api/sessions/[sessionId]/chats/route.test.ts`
- `apps/web/app/api/sessions/[sessionId]/chats/[chatId]/route.test.ts`
- `apps/web/app/api/sessions/[sessionId]/chats/[chatId]/read/route.test.ts`
- `apps/web/app/api/sessions/[sessionId]/chats/[chatId]/messages/[messageId]/route.test.ts`

Checklist:
- [x] Add helper guard tests (401/403/404/success paths)
- [x] Add route behavior tests for PATCH/DELETE/read/message delete flows
- [x] Keep `share/route.test.ts` passing with shared helper
- [x] Verify tests run cleanly

Completion notes:
- Added regression coverage for the shared sessions chat helper and refactored chat routes.
- Added explicit status-path tests for auth/ownership guard forwarding and route-specific behavior.
- Verification run:
  - `bun run typecheck --filter=web` ✅
  - `bun run lint --filter=web` ✅ (existing unrelated max-lines warnings)
  - `bun test 'apps/web/app/api/sessions/_lib/session-context.test.ts'` ✅
  - `bun test 'apps/web/app/api/sessions/[sessionId]/chats/route.test.ts'` ✅
  - `bun test 'apps/web/app/api/sessions/[sessionId]/chats/[chatId]/route.test.ts'` ✅
  - `bun test 'apps/web/app/api/sessions/[sessionId]/chats/[chatId]/read/route.test.ts'` ✅
  - `bun test 'apps/web/app/api/sessions/[sessionId]/chats/[chatId]/messages/[messageId]/route.test.ts'` ✅
  - `bun test 'apps/web/app/api/sessions/[sessionId]/chats/[chatId]/share/route.test.ts'` ✅
  - `bun run build --filter=web` ✅

## Phase 2 — Session/Sandbox utility routes (planned)
Candidate routes:
- `apps/web/app/api/sessions/[sessionId]/files/route.ts`
- `apps/web/app/api/sessions/[sessionId]/skills/route.ts`
- `apps/web/app/api/sessions/[sessionId]/diff/route.ts`
- `apps/web/app/api/sessions/[sessionId]/diff/cached/route.ts`
- `apps/web/app/api/sessions/[sessionId]/merge/route.ts`
- `apps/web/app/api/sessions/[sessionId]/merge-readiness/route.ts`
- `apps/web/app/api/sessions/[sessionId]/pr-deployment/route.ts`
- `apps/web/app/api/sandbox/*.ts`
- `apps/web/app/api/check-pr/route.ts`
- `apps/web/app/api/git-status/route.ts`

Checklist:
- [ ] Extract shared "owned session" + optional sandbox guard helper(s)
- [ ] Migrate routes incrementally
- [ ] Verify with scripts

## Phase 3 — Large route decomposition (planned)
Candidates:
- `apps/web/app/api/generate-pr/route.ts`
- `apps/web/app/api/sessions/[sessionId]/diff/route.ts`
- `apps/web/app/api/github/create-repo/route.ts`

Checklist:
- [ ] Identify cohesive helper boundaries per route
- [ ] Split into `_lib` modules without behavior changes
- [ ] Verify with scripts

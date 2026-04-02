Summary: Build a new sandbox-agent platform alongside the current Open Harness stack. A session chooses one runtime (`opencode`, `claude`, or `codex`) up front, that runtime is launched inside the sandbox, and the web app only needs a thin control-plane contract (`start`, `stream`, `stop`, `input`) instead of a deep shared agent model.

Context: Key findings from exploration -- existing patterns, relevant files, constraints

- Today, agent execution lives outside the sandbox in `apps/web/app/api/chat/route.ts`, `apps/web/app/workflows/chat.ts`, `apps/web/app/workflows/chat-post-finish.ts`, and `packages/agent/open-harness-agent.ts`. The sandbox is only the tool execution target.
- The current chat UI is tightly coupled to the custom AI SDK agent:
  - `apps/web/app/config.ts`
  - `apps/web/app/types.ts`
  - `apps/web/app/sessions/[sessionId]/chats/[chatId]/hooks/use-session-chat-runtime.ts`
  - `apps/web/app/sessions/[sessionId]/chats/[chatId]/session-chat-content.tsx`
  Reusing this exact message/tool model would force deep provider unification too early.
- Existing sandbox/session ownership is still the right foundation and should stay:
  - `sessions` own the sandbox lifecycle (`apps/web/lib/db/schema.ts`, `apps/web/lib/sandbox/lifecycle.ts`)
  - `chats` own conversation threads (`apps/web/lib/db/schema.ts`, `apps/web/lib/db/sessions.ts`)
- There is already a proven pattern for keeping a long-running process alive inside the sandbox using detached commands in `apps/web/app/api/sessions/[sessionId]/dev-server/route.ts`. That is the right primitive for sandbox-local agent runtimes too.
- User feedback narrowed the goal: do not deeply unify OpenCode, Claude, and Codex from the start. The initial goal is simpler: let Open Harness spin up an out-of-the-box coding agent inside a sandbox the same way it currently spins up its own custom agent outside the sandbox.
- SDK research:
  - OpenCode is the best first target because it already has sessions, agents, config, permissions, and server/event APIs.
  - Claude Agent SDK is a good second target because it already supports resumable sessions, coding tools, and approval/question callbacks.
  - Codex SDK is workable but thinner, so it should come after the runtime-launch path is proven.
- Security constraint: these runtimes need model credentials inside the sandbox. We should not blindly inject long-lived platform API keys into a user-accessible sandbox. A credential strategy must be validated per runtime before rollout:
  - OpenCode likely works with config/provider overrides and can potentially point at a controlled proxy.
  - Codex explicitly supports `baseUrl`, which makes a proxy/relay path realistic.
  - Claude may require either a verified proxy-compatible path or user-supplied Anthropic credentials if the SDK cannot safely target a relay.

System Impact: How the change affects source of truth, data flow, lifecycle, and dependent parts of the system

- What part of the system is actually changing?
  - A new agent-execution platform is added next to the existing one.
  - Sandboxes stop being only tool targets and become the place where the coding-agent runtime itself runs.
- Source of truth before:
  - execution state: Vercel workflow runs in `chats.activeStreamId`
  - transcript shape: AI SDK agent-derived `WebAgentUIMessage`
  - tool semantics: custom Open Harness tools from `packages/agent`
- Source of truth after for the new platform:
  - runtime choice: `sessions.agentRuntime`
  - provider conversation identity: `chats.agentState` (thread/session IDs, pending input state)
  - active run pointer: keep reusing `chats.activeStreamId`
  - transcript persistence: `chat_messages.parts`, but with a new minimal sandbox-agent message shape instead of `WebAgentUIMessage`
- New invariants:
  - In v1, the runtime is chosen per session, not per chat.
  - All chats inside one session use the same sandbox agent runtime.
  - Switching runtimes in v1 means creating a new session for the same repo/branch, not hot-swapping a live session.
  - The web app is only the control plane for external runtimes: auth, persistence, lifecycle, streaming proxy, and stop/input endpoints.
- What this intentionally does not introduce yet:
  - no deep provider-wide tool unification
  - no attempt to preserve the current `ToolCall` / `TaskGroupView` / AI SDK tool-part semantics
  - no in-session runtime switching
  - no promise that model selection is shared across all runtimes on day one
- Adjacent simplifications:
  - the new platform can ship without touching `packages/agent/*`
  - `apps/web/app/api/chat/route.ts` and `apps/web/app/workflows/chat.ts` can remain as the legacy path until the new platform is proven
  - new runtime sessions can use a simpler chat UI focused on text streaming, stop/reconnect, and user-input requests

Approach: High-level design decision and why

- Build a new workspace package, `packages/sandbox-agents`, for sandbox-local runtime bridges.
- Do not force OpenCode, Claude, and Codex into a single rich Open Harness agent protocol. Instead, standardize only the minimum control-plane envelope the web app needs:
  - health
  - start run
  - reconnect stream
  - stop run
  - answer approval / clarifying-question input
  - completion / usage metadata
- Use separate runtime adapters/bridges behind that thin envelope:
  - `opencode` first
  - `claude` second
  - `codex` third
- Keep the current custom Open Harness agent stack as a legacy/parallel path during rollout. New sessions can opt into the new sandbox-agent platform without rewriting the entire existing chat stack first.
- Make runtime choice session-level in v1. This matches the current product shape most closely and avoids mixing multiple runtime processes and credential models inside one sandbox session.
- Simplify the new UI:
  - generic transcript rendering
  - generic “input required” cards for approvals/questions
  - basic streaming status / stop / reconnect
  - no attempt to reproduce every current rich tool visualization
- Simplify model handling in v1:
  - external-runtime sessions should use runtime-defined defaults/config first
  - keep the existing model/subagent preference UI for legacy `open-harness` sessions only until runtime-specific model settings are designed
- Delivery order:
  1. credential/auth spike per runtime
  2. OpenCode end-to-end in sandbox
  3. new sandbox-agent UI + API path
  4. Claude adapter
  5. Codex adapter
  6. only then consider deeper unification or chat-level runtime switching

Changes:
- `package.json` - add the new runtime packages and workspace wiring for the sandbox-agent platform.
- `packages/sandbox-agents/package.json` - new package for sandbox-local runtime bridge code.
- `packages/sandbox-agents/common/protocol.ts` - define the thin control-plane contract shared by web app and runtime bridges.
- `packages/sandbox-agents/common/server.ts` - common HTTP/SSE server scaffolding for runtime bridges.
- `packages/sandbox-agents/runtimes/opencode.ts` - OpenCode runtime bridge (first implementation target).
- `packages/sandbox-agents/runtimes/claude.ts` - Claude Agent SDK runtime bridge.
- `packages/sandbox-agents/runtimes/codex.ts` - Codex runtime bridge.
- `apps/web/lib/sandbox/config.ts` - reserve a dedicated sandbox port for the runtime bridge in addition to dev-server preview ports.
- `apps/web/lib/sandbox/agent-runtime.ts` - new server-only bootstrap helper that ensures the chosen runtime bridge is running in the sandbox, performs health checks, and relaunches it after hibernation/resume.
- `apps/web/lib/db/schema.ts` - add `sessions.agentRuntime`, `chats.agentState`, and `user_preferences.defaultAgentRuntime`. Keep `chats.activeStreamId` as the live run pointer.
- `apps/web/lib/db/user-preferences.ts` - persist the default runtime.
- `apps/web/app/api/settings/preferences/route.ts` - expose runtime preference reads/writes.
- `apps/web/hooks/use-user-preferences.ts` - surface default runtime to the client.
- `apps/web/app/settings/preferences-section.tsx` - add runtime preference UI and clearly scope legacy-only settings (`defaultModelId`, `defaultSubagentModelId`) to the old platform until external-runtime model settings exist.
- `apps/web/components/session-starter.tsx` - add runtime selection when creating a session.
- `apps/web/app/[username]/[repo]/page.tsx` - seed new repo-backed sessions with the selected runtime.
- `apps/web/app/api/sessions/[sessionId]/chats/route.ts` - create chats that inherit the session runtime and initialize provider thread state as needed.
- `apps/web/app/sandbox-agent-types.ts` - new message/event/input types for the new platform. Do not replace `apps/web/app/types.ts` in phase 1.
- `apps/web/app/api/sandbox-agent/chat/route.ts` - new start/send route for sandbox-agent sessions.
- `apps/web/app/api/sandbox-agent/[chatId]/stream/route.ts` - reconnect to an active sandbox-agent run.
- `apps/web/app/api/sandbox-agent/[chatId]/stop/route.ts` - abort the current sandbox-agent run.
- `apps/web/app/api/sandbox-agent/[chatId]/input/route.ts` - answer runtime approval/question requests and resume execution.
- `apps/web/app/sessions/[sessionId]/chats/[chatId]/hooks/use-sandbox-agent-chat.ts` - new client streaming hook for the sandbox-agent platform.
- `apps/web/app/sessions/[sessionId]/chats/[chatId]/sandbox-agent-chat-content.tsx` - new simplified chat UI for sandbox-agent sessions.
- `apps/web/app/sessions/[sessionId]/chats/[chatId]/page.tsx` - branch between legacy `SessionChatContent` and new `SandboxAgentChatContent` based on `session.agentRuntime`.
- `apps/web/app/sessions/[sessionId]/chats/[chatId]/session-chat-context.tsx` - add only the metadata needed to branch/render the new platform; do not force the old runtime context to understand external agent internals.
- Leave these files on the legacy path in phase 1:
  - `packages/agent/*`
  - `apps/web/app/config.ts`
  - `apps/web/app/api/chat/route.ts`
  - `apps/web/app/workflows/chat.ts`
  - `apps/web/app/workflows/chat-post-finish.ts`

Verification:
- Phase 0 credential/auth spike (required before full implementation claims):
  - prove OpenCode can run in a sandbox with safe credential/config injection
  - prove Codex can run against a relay or other safe credential path
  - prove Claude can either target a safe relay/base URL or clearly document that it requires user-supplied Anthropic credentials in v1
- OpenCode end-to-end tests first:
  - launch OpenCode in a sandbox
  - create/resume a provider session from a chat
  - stream text back through the web proxy
  - stop and reconnect correctly
  - survive sandbox hibernation by relaunching the bridge and resuming provider session state from disk
- API tests:
  - `apps/web/app/api/sandbox-agent/chat/route.test.ts`
  - `apps/web/app/api/sandbox-agent/[chatId]/stream/route.test.ts`
  - `apps/web/app/api/sandbox-agent/[chatId]/stop/route.test.ts`
  - `apps/web/app/api/sandbox-agent/[chatId]/input/route.test.ts`
  - `apps/web/app/api/settings/preferences/route.test.ts`
- Runtime adapter tests:
  - `packages/sandbox-agents/runtimes/opencode.test.ts`
  - `packages/sandbox-agents/runtimes/claude.test.ts`
  - `packages/sandbox-agents/runtimes/codex.test.ts`
  - `apps/web/lib/sandbox/agent-runtime.test.ts`
- Manual checks:
  - create a session with `opencode`, send a prompt, and confirm the runtime is launched inside the sandbox
  - reload during a run and reconnect to the active stream
  - answer an approval/question request and verify the run resumes
  - stop a run and confirm `activeStreamId` clears
  - archive/hibernate/resume the sandbox and verify the runtime bridge relaunches cleanly
  - create a second session against the same repo with a different runtime to validate the v1 “switch runtimes by starting a new session” story
- Repository checks after implementation:
  - `bun run check`
  - `bun run typecheck`
  - `bun run test:isolated`
  - `bun run --cwd apps/web db:check`
- Edge cases to verify:
  - runtime bridge missing after sandbox reconnect
  - pending input request survives page refresh
  - provider thread/session exists but active run does not
  - missing credentials for selected runtime
  - external-runtime session hits current legacy model-selection UI and is correctly gated/hidden
  - empty-sandbox session (no git repo) with Codex `skipGitRepoCheck` behavior validated explicitly

# HANDOFF

Working handoff for an agent picking up **Quorum**. Current as of **2026-07-08**, `main` at commit `ac788aa`. 中文版见 [`HANDOFF.zh.md`](./HANDOFF.zh.md)。

> 2026-07-07 architecture update: Quorum is being migrated to the shared-session architecture from the agent-framework meeting. New implementation handoff: [`AGENT_FRAMEWORK_HANDOFF.md`](./AGENT_FRAMEWORK_HANDOFF.md). Full copied docs live in [`docs/architecture/`](./docs/architecture/).

## Current State For The Next Agent

Latest migration commits:

- `7d303b8 feat: add shared session architecture kernel`
- The follow-up handoff/UI commit adds shared-session Web UI projection and `pnpm smoke:shared`.
- The sidecar spike commit adds `packages/daemon/src/sidecar.ts` and `pnpm smoke:sidecar`.
- The Node fallback spike adds `pnpm sidecar:node:build` and `pnpm sidecar:node:smoke`.
- The packaging env commit adds project-local Bun/Rust setup under `.tools/` and validates Bun single-file sidecar compile with `pnpm sidecar:bun:smoke`.
- The desktop shell spike adds `apps/desktop`, `pnpm desktop:check`, `pnpm desktop:dev`, `pnpm desktop:build`, and a Tauri command that starts the compiled Bun sidecar and returns its authenticated WebSocket URL to the React client.

## This Session Implementation Log

The following is the implementation trail from this session. It is written for the next agent to continue without reconstructing context from chat history.

1. `7d303b8 feat: add shared session architecture kernel`
   - Files: `packages/protocol/src/types.ts`, `packages/protocol/src/schema.ts`, `packages/core/src/session-manager.ts`, `packages/core/src/command-mailbox.ts`, `packages/core/src/arbiter.ts`, `packages/core/src/session-state.ts`, `packages/core/src/legacy-agent-adapter.ts`, `packages/daemon/src/shared-session-host.ts`, `packages/cli/src/index.ts`, tests and docs.
   - Work: introduced the shared-session contract and kernel: explicit phases, append-only event commands, bid collection, arbitration, turn ownership, queued bids during speaking, legacy adapter wrapping, and `QUORUM_SESSION_KERNEL=shared` boot path.

2. `2e15f2a docs: clarify shared session handoff status`
   - Files: `README.md`, `HANDOFF.md`, `HANDOFF.zh.md`.
   - Work: copied the meeting conclusions into handoff docs and clarified what had been implemented versus what remained open for the new shared-session architecture.

3. `eaf18b2 feat: surface shared session state in web UI`
   - Files: `packages/client-web/src/main.tsx`, `packages/client-web/src/styles.css`, daemon/gateway wiring as needed, docs.
   - Work: exposed shared-session phase, active speaker, pending bids, selected speaker, and debug events in the Web UI so the new kernel could be inspected from the browser.

4. `1d7f27c feat: add authenticated sidecar entry`
   - Files: `packages/daemon/src/sidecar.ts`, WebSocket gateway auth path, smoke scripts, package scripts, docs.
   - Work: added a local sidecar entrypoint that binds an ephemeral loopback port, prints `{ port, token, bootId }`, and requires the token for WebSocket connections.

5. `81aef87 feat: add node sidecar fallback smoke`
   - Files: `scripts/build-sidecar-node.ts`, `scripts/node-sidecar-smoke.ts`, package scripts, docs.
   - Work: added a Node-runtime sidecar fallback build/smoke path for platforms where Bun single-file packaging is unsuitable.

6. `de2ff9b feat: verify bun sidecar in local packaging env`
   - Files: `.tools/` setup scripts, `scripts/bun-sidecar-smoke.ts`, packaging scripts, SQLite sidecar compatibility code, docs.
   - Work: added project-local Bun/Rust tooling setup and verified Bun single-file sidecar execution with SQLite, authenticated WebSocket, and shared-session echo turn.

7. `ff6825f feat: add tauri desktop sidecar shell`
   - Files: `apps/desktop/**`, Tauri Rust layer, Web UI Tauri connection detection, package scripts, docs.
   - Work: scaffolded the desktop shell. The Rust layer starts the compiled Bun sidecar, parses the stdout handshake, and exposes the authenticated WebSocket URL to React.

8. `827efdb fix: validate desktop bundle build`
   - Files: `apps/desktop/src-tauri/**`, desktop build config/resources, scripts/docs.
   - Work: fixed and validated macOS arm64 desktop bundling so `pnpm desktop:build` produces an unsigned `.app`/`.dmg` containing the Bun sidecar under `Contents/Resources/sidecars/quorum-sidecar`.

9. `773bdee fix: improve shared session mobile web ui`
   - Files: `packages/client-web/src/main.tsx`, `packages/client-web/src/styles.css`.
   - Work: improved mobile usability for the shared-session Web UI: operations are easier to reach, debug surfaces are less intrusive, and the composer remains usable on small screens.

10. `64d0a42 feat: persist shared session projections`
    - Files: `packages/core/src/session-state.ts`, `packages/core/src/session-manager.ts`, `packages/daemon/src/persistence/sqlite-store.ts`, `packages/daemon/src/shared-session-host.test.ts`, tests/docs.
    - Work: added replay projection persistence and SQLite-derived tables for sessions, turns, bids, and snapshots while keeping the append-only event log as the source of truth. Also handled legacy event-table migration.

11. `9a56849 feat: show arbitration score components`
    - Files: `packages/client-web/src/main.tsx`, `packages/client-web/src/styles.css`.
    - Work: surfaced arbitration score components in the Web UI so speaker selection can be debugged rather than treated as a black box.

12. `5260a1f feat: wire shared session tool approvals`
    - Files: `packages/core/src/session-manager.ts`, `packages/core/src/session-manager.test.ts`, `packages/daemon/src/gateway/ws-server.ts`, `packages/daemon/src/shared-session-host.ts`, docs.
    - Work: wired `AgentRuntime.callTool()` to the human approval loop. The WebSocket `approve_tool` command now resolves requested/granted/denied approval state for shared-session turns.

13. `e09977b feat: execute approved shared room tools`
    - Files: `packages/core/src/session-manager.ts`, `packages/core/src/session-manager.test.ts`, docs.
    - Work: after approval, safe room tools (`read_room`, `post_note`, `request_review`, `hand_off`, `raise_hand`) execute through `runRoomTool()` and emit `tool_call` / `tool_result` plus any room events.

14. `6dd1fe8 feat: add shared session replay projection`
    - Files: `packages/daemon/src/gateway/ws-server.ts`, `packages/daemon/src/gateway/ws-server.test.ts`, `packages/client-web/src/main.tsx`, `packages/client-web/src/styles.css`, `packages/protocol/src/schema.ts`, docs.
    - Work: added WebSocket `replay_projection` and a Web UI Replay panel to rebuild phase/speaker/bid state from an arbitrary event sequence.

15. `0603b32 feat: add working memory compaction`
    - Files: `packages/core/src/memory.ts`, `packages/core/src/memory.test.ts`, `packages/core/src/event-log.ts`, `packages/core/src/in-memory-store.ts`, `packages/core/src/session-manager.ts`, `packages/daemon/src/persistence/sqlite-store.ts`, `packages/daemon/src/gateway/ws-server.ts`, `packages/client-web/src/main.tsx`, `packages/client-web/src/styles.css`, protocol schema, tests/docs.
    - Work: implemented deterministic working-memory summaries, persistence in memory/SQLite stores, `SessionManager.compactWorkingMemory()`, WebSocket `compact_memory`, and a Web UI Memory panel.

16. `7abb9f3 feat: auto compact working memory`
    - Files: `packages/core/src/session-manager.ts`, `packages/core/src/session-manager.test.ts`, `README.md`, `HANDOFF.md`, `HANDOFF.zh.md`.
    - Work: added automatic working-memory compaction after turns once configured thresholds are reached (`minSeqGap`, `minEvents`, `keepRecentEvents`, `autoCompact`). Auto summaries are persisted and marked with `auto: true`.

17. `ac788aa feat: execute approved external tools in sandbox`
    - Files: `packages/core/src/tool-executor.ts`, `packages/core/src/session-manager.ts`, `packages/core/src/session-manager.test.ts`, `packages/daemon/src/tools/local-sandbox-executor.ts`, `packages/daemon/src/tools/local-sandbox-executor.test.ts`, `packages/daemon/src/shared-session-host.ts`, `packages/daemon/src/index.ts`, `README.md`, `HANDOFF.md`, `HANDOFF.zh.md`.
    - Work: added a core `ToolExecutor` injection point and a daemon local sandbox executor for approved external command tools such as `Bash`. Current safeguards: workspace cwd containment, timeout, stdout/stderr truncation, tool allowlist, and common dangerous-command blocking. Remaining gap: adapter-native Claude/Codex tool events still need bridging so every native tool call goes through the same approval/sandbox path.

What is already implemented:

- The meeting handoff and guide were copied into this repo:
  - [`AGENT_FRAMEWORK_HANDOFF.md`](./AGENT_FRAMEWORK_HANDOFF.md)
  - [`AGENT_FRAMEWORK_GUIDE.html`](./AGENT_FRAMEWORK_GUIDE.html)
  - [`docs/architecture/`](./docs/architecture/)
- `@quorum/protocol` now has the shared-session contract: `SessionPhase`, `SessionEvent`, `SessionCommand`, `Bid`, `ISpeakerAgent`, `AgentRuntime`, `LLMAdapter.chatStream()`, and memory summary types.
- `@quorum/core` now has the first shared-session kernel:
  - `SessionManager`
  - `CommandMailbox`
  - `Arbiter`
  - `LegacyAgentAdapter`
  - explicit session phase transition validation
  - `projectSessionState()` replay projection
  - deterministic working-memory summary creation and `SessionManager.compactWorkingMemory()`
- `@quorum/daemon` now bootstraps shared-session SQLite tables for sessions, events,
  snapshots, turns, bids, memory, agent configs, provider configs, and migrations.
- `@quorum/daemon` now has `startSharedSessionRoom()`, which wraps existing adapters through `LegacyAgentAdapter` and routes human prompts through `SessionManager`.
- The CLI can choose the new kernel with `QUORUM_SESSION_KERNEL=shared`; without that env var it keeps the legacy `Conductor` path.
- `quorum.webui-smoke.config.json` provides a no-credential echo-agent config for manual Web UI testing. Use `QUORUM_SESSION_KERNEL=shared QUORUM_CONFIG=quorum.webui-smoke.config.json QUORUM_DB_PATH=.quorum/webui-smoke.sqlite pnpm dev`.
- `@quorum/client-web` can now detect shared-session events and display phase, active speaker, bid queue, selected speaker, and debug events.
- `pnpm smoke:shared` starts a shared-session host, posts over WebSocket, and verifies bid/phase/echo response events.
- `packages/daemon/src/sidecar.ts` starts a shared-session sidecar on `127.0.0.1:0`, prints `{ port, token, bootId }`, and requires the token for WebSocket connections.
- `pnpm smoke:sidecar` starts the sidecar entry, validates the handshake, performs a token-authenticated WebSocket round trip, and exercises a subprocess check.
- `pnpm sidecar:node:build` creates a Node-runtime fallback artifact in `dist-sidecar/node`.
- `pnpm sidecar:node:smoke` builds that artifact, starts it, validates the same sidecar handshake and WebSocket round trip.
- `pnpm packaging:env` installs Bun and Rust/Cargo into `.tools/` without modifying global shell startup files.
- `pnpm sidecar:bun:build` compiles `packages/daemon/src/sidecar.ts` into `dist-sidecar/bun/quorum-sidecar`.
- `pnpm sidecar:bun:smoke` validates the compiled Bun sidecar with SQLite, token-authenticated WebSocket, and a shared-session echo turn.
- `apps/desktop` is a Tauri 2 shell. Its Rust layer manages the sidecar process, parses the stdout handshake, and exposes `get_sidecar_connection()` to the Web UI.
- The Web UI detects Tauri at startup and replaces the default `ws://127.0.0.1:8787` connection with the sidecar URL returned by `get_sidecar_connection()`.
- Tests now cover SQLite projection tables, legacy event-table migration, replay projection, and a three-agent shared-session open discussion through queued bids.
- Shared-session `AgentRuntime.callTool()` now has a human approval loop wired through `approve_tool`; it emits requested/granted/denied approval signals, executes approved safe room tools (`read_room`, `post_note`, `request_review`, `hand_off`, `raise_hand`), and records `tool_call` / `tool_result` events. Approved external command tools such as `Bash` now route through a daemon-provided local sandbox executor with workspace cwd isolation, timeout, output truncation, allowlisted tool names, and dangerous-command blocking.
- WebSocket `replay_projection` returns a projected shared-session state from `afterSeq`, and the Web UI has a Replay panel for phase/speaker/bid-state checks.
- The Web UI composer is pinned near the top of the Operations panel for manual testing. In shared-session mode, the legacy policy segmented control is disabled because `set_policy` is not implemented for the new kernel yet.
- Working-memory summaries can be created, persisted through `SqliteStore`, triggered through WebSocket `compact_memory`, inspected in the Web UI Memory panel, and automatically compacted after turns once configured event thresholds are reached.
- Verification: `pnpm typecheck`, `pnpm test`, `pnpm --filter @quorum/client-web build`, `pnpm smoke:shared`, `pnpm smoke:sidecar`, `pnpm sidecar:node:smoke`, `pnpm sidecar:bun:smoke`, `pnpm desktop:check`, and `pnpm desktop:build` pass on macOS arm64.

What is not implemented yet:

- **Installer-grade release is not done.** There is no signing/notarization, no Windows installer validation, and no auto-update yet.
- **Desktop double-click launch shell is scaffolded and macOS arm64 bundles build.** `apps/desktop` can launch the Web UI inside Tauri and start the compiled Bun sidecar through the Rust layer. `pnpm desktop:build` produces an unsigned `.app` and `.dmg`; the `.app` contains `Contents/Resources/sidecars/quorum-sidecar`.
- **Developer one-command launch exists.** Use `pnpm dev` for the legacy kernel or `QUORUM_SESSION_KERNEL=shared pnpm dev` for the new shared-session kernel.
- **Local sidecar entry exists and Bun compile is verified.** The sidecar can be run through tsx with `pnpm smoke:sidecar`, compiled with Bun using `pnpm sidecar:bun:build`, and verified with `pnpm sidecar:bun:smoke`.
- **Node-runtime fallback exists.** It is not a single binary, but `pnpm sidecar:node:build` creates a smoke-tested fallback artifact. Keep it as the fallback route if Bun compile regresses on another platform.
- **Rust/Cargo exists only in the project-local toolchain.** Source `.tools/packaging-env.sh` before running direct Cargo/Tauri commands, or use `pnpm desktop:check`.
- The Web UI now exposes the new shared-session phase and bid queue, but it is still a minimal projection. It does not yet provide full replay controls, policy tuning, rich arbitration score inspection, or memory inspection.
- Richer memory policy tuning UI, adapter-level native tool bridging, full timeline replay UI, signed installer pipeline, updater, and cross-platform desktop validation remain follow-up work.

Recommended next task for the new agent:

1. Keep `legacy-conductor` as a fallback while migrating.
2. Expand the shared-session UI from a minimal projection into a real debugging workflow:
   - richer arbitration score inspection
   - settling-window state
   - event payload JSON expansion
   - replay controls
   - memory inspector
3. Decide when to flip the default kernel from `legacy-conductor` to `shared-session`.
4. Run and test the new kernel with:

```bash
pnpm install
QUORUM_SESSION_KERNEL=shared pnpm dev
pnpm smoke:shared
pnpm smoke:sidecar
pnpm sidecar:node:smoke
pnpm sidecar:bun:smoke
pnpm desktop:check
pnpm desktop:build
pnpm typecheck
pnpm test
```

5. Start the packaging P0 spike from [`AGENT_FRAMEWORK_HANDOFF.md`](./AGENT_FRAMEWORK_HANDOFF.md):
   - Bun compile compatibility with SQLite. This is now verified on macOS arm64 with Bun 1.3.14 by using Bun's `bun:sqlite` path inside `SqliteStore`.
   - Playwright/browser-agent compatibility. This is still open.
   - Windows and macOS x64 build compatibility. Still open.
   - fallback decision: Bun single binary vs Node runtime + JS bundle/resources. Current default should be Bun single binary; Node fallback remains smoke-tested.
6. Next implementation target: app launch smoke against the generated `.app`, Windows installer validation, signing/notarization, updater, and platform-specific sidecar path tests.

## TL;DR
Quorum is a TypeScript/pnpm monorepo: a human + multiple heterogeneous coding agents (Claude Code, Codex, plain API models) collaborate in **one shared group chat on one git branch**. A **Conductor** decides who holds the speaking floor; an append-only **EventLog** is the source of truth; everyone edits **one shared working dir** serialized by a write-floor lock with per-turn checkpoint commits. Milestones **M0–M4 are in place and M5 (web client) is wired**; **M6 (remote access) is not started**. See `SPEC.md` for the full design and `README.md` for the pitch.

## Run it
Requires Node ≥ 20, pnpm.
```bash
pnpm install
pnpm dev      # ONE command: daemon (ws://127.0.0.1:8787) + web client (http://127.0.0.1:5173)
              # Ctrl-C stops both. Override the daemon port with QUORUM_PORT=8799 pnpm dev
```
Then open **http://127.0.0.1:5173** in a browser (NOT 8787 — that's the WebSocket port; hitting it with a browser shows "Upgrade Required", which is normal).

Other scripts: `pnpm demo` (dependency-free 2-agent echo demo), `pnpm test` (vitest, 30 tests), `pnpm typecheck` (tsc -b), `pnpm smoke` (M0 EventLog check).

**Gotcha:** only one process can hold port 8787. If a standalone daemon is already running you'll get `EADDRINUSE` — stop it first (`lsof -nP -i :8787` to find it).

## Repo map
```
apps/
  desktop/    Tauri 2 desktop shell
packages/
  protocol/   zero-dep types + zod wire schema (the contract)
  core/       EventLog, Conductor, the 3 floor policies, projection, room-tools — DEPENDENCY-FREE, tested
  daemon/     adapters (claude-code/codex/api-model/echo), GitWorkspace, SqliteStore, WS gateway, moderator, room-host wiring
  cli/        minimal launcher: defines the room and calls startRoom()
  client-web/ React/Vite client (WS to the daemon)
scripts/      dev.ts (pnpm dev launcher) · demo.ts · smoke.ts
SPEC.md       full design (Chinese): data model, Conductor state machine, adapter contracts, WS protocol §10, milestones §12
```

## Mental model (read before editing)
- **EventLog** (`core/src/event-log.ts`) — append-only, monotonic `seq`, single source of truth. `append/on/replay/headSeq`.
- **Conductor** (`core/src/conductor.ts`) — state machine (`idle/active/collecting`) that grants the speaking floor and runs turns. It **stamps each event's author = current floor holder** (anti-spoofing). A human message/interrupt always preempts the active turn.
- **Floor policies** (`core/src/policies/`): `free-for-all` (agents raise hands), `directed` (only @-addressed agents), `moderated` (a model names the next speaker). Switch at runtime via the gateway's `set_policy`.
- **GitWorkspace** (`daemon/src/workspace/git-workspace.ts`) — single branch, write-floor mutex (returns a `WriteLease`), per-turn checkpoint commit, and an **out-of-band watcher that runs `git add -A` + commit when files change while no turn holds the floor**. ⚠️ Because of this, **don't leave uncommitted junk in the tree while the daemon is running** — it can get auto-committed as a "human checkpoint."
- **Adapters** (`daemon/src/adapters/`) — each agent keeps its **native tool-calling**; the framework only projects the transcript delta in and normalizes native events back onto the log. Heavy SDKs (`@anthropic-ai/claude-agent-sdk`, `zod`) are **imported lazily/dynamically** so the daemon loads even when they're absent.
- **Room MCP tools** (`core/src/room-tools.ts`, SPEC §9): `raise_hand`, `read_room`, `request_review`, `hand_off`, `post_note` — translated into room events. Wired into the Claude (in-process MCP server) and Codex adapters.
- **WS gateway** (`daemon/src/gateway/ws-server.ts`, SPEC §10): client→server `subscribe/post_message/interrupt/set_policy/approve_tool/take_write_floor/rollback`; server→client `snapshot/event/error`. Binds 127.0.0.1:8787.

## Where to change common things
- **The room (agents, policy, workspace)**: defined in `quorum.config.json` at the repo root (or `QUORUM_CONFIG=<path>`). `packages/cli/src/index.ts` loads it via `loadConfig()` and falls back to built-in defaults if the file is missing.
- **Add an agent**: add a `ParticipantDescriptor` to `participants[]` with an `adapter` + `adapterConfig`. `claude-code` needs the Agent SDK + Claude Code auth; `codex` needs the `codex` CLI on PATH; `api-model` is any OpenAI-compatible endpoint; `echo` is the built-in fake.
- **Moderator model**: `packages/daemon/src/moderator.ts`. Configured via `policy.moderatorModel` / `QUORUM_MODERATOR_MODEL` (default `gpt-4o-mini`) / `QUORUM_MODERATOR_BASE_URL`, key from `OPENAI_API_KEY`. Degrades to "yield to human" on any failure.

## Milestone status (SPEC §12)
- **M0** skeleton, protocol+zod, SQLite, EventLog — done.
- **M1** single agent + human + WS gateway + minimal client — done.
- **M2** Conductor free-for-all + 2nd agent + `raise_hand` + human interrupt — done.
- **M3** GitWorkspace write-floor + per-turn checkpoint + out-of-band detection + diff/rollback (gateway `rollback`/`approve_tool`/`take_write_floor`) — done.
- **M4** `directed` + `moderated` policies + runtime `set_policy`; model-backed moderator — done.
- **M5** React web client — **in place and connects**; recent commits (`2cc772e`/`28fccf9`/`384c311`) wired the tool-approval / rollback / take-write-floor / reconnect interactions (verify them end-to-end, plus inline diff view + multi-client consistency, against SPEC §12 before calling it complete).
- **M6** remote (relay/E2E/pairing QR, more providers) — **not started**.

## Suggested next steps
1. Audit/finish M5 web-client features (diff view, approve-tool + rollback UI, reconnect).
2. Start M6 (remote transport + pairing).
3. Refresh `README.md` — its "Status" section is stale (still calls the web client a placeholder and references a `pnpm --filter @quorum/cli start` script that doesn't exist; start the daemon with `npx tsx packages/cli/src/index.ts`).

## Conventions / gotchas
- `@quorum/core` stays **dependency-free**; anything needing network/env/SDKs lives in `@quorum/daemon`.
- Verify before claiming: `pnpm typecheck` is clean and `pnpm test` is 30/30 green at `384c311`.
- Debug artifacts (root `*.png`, `.playwright-mcp/`) are gitignored — keep them out of commits.
- **Git worktrees:** `main` is checked out at `/Users/matthew/Projects/quorum`; a second worktree (`test-framework-debug`) also exists. A branch can only be checked out in one worktree at a time, so don't try to `git checkout main` in the second one.

## Recent history
```
384c311 feat: auto-scroll transcript + run Claude with bypassPermissions
28fccf9 fix: clear stale "Connection failed" banner once the socket connects
2cc772e feat: wire M5 web interactions (approve/rollback/write-floor + reconnect)
d5ac91c docs: add HANDOFF.md for agents picking up the project
e8172c1 feat: add `pnpm dev` to launch daemon + web client together
56b75bd chore: ignore browser/playwright debug artifacts
824830e feat: wire model-backed moderator for the moderated policy (M4)
1ca2b6c feat: wire gateway rollback / take_write_floor / approve_tool (M3)
c92f387 feat: add React web client (M5)
3db9ed9 feat: add §9 room MCP tools and wire Claude/Codex adapters
```

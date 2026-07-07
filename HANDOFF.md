# HANDOFF

Working handoff for an agent picking up **Quorum**. Current as of **2026-06-23**, `main` at commit `384c311`. 中文版见 [`HANDOFF.zh.md`](./HANDOFF.zh.md)。

> 2026-07-07 architecture update: Quorum is being migrated to the shared-session architecture from the agent-framework meeting. New implementation handoff: [`AGENT_FRAMEWORK_HANDOFF.md`](./AGENT_FRAMEWORK_HANDOFF.md). Full copied docs live in [`docs/architecture/`](./docs/architecture/).

## Current State For The Next Agent

Latest migration commits:

- `7d303b8 feat: add shared session architecture kernel`
- The follow-up handoff/UI commit adds shared-session Web UI projection and `pnpm smoke:shared`.
- The sidecar spike commit adds `packages/daemon/src/sidecar.ts` and `pnpm smoke:sidecar`.

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
- `@quorum/daemon` now has `startSharedSessionRoom()`, which wraps existing adapters through `LegacyAgentAdapter` and routes human prompts through `SessionManager`.
- The CLI can choose the new kernel with `QUORUM_SESSION_KERNEL=shared`; without that env var it keeps the legacy `Conductor` path.
- `@quorum/client-web` can now detect shared-session events and display phase, active speaker, bid queue, selected speaker, and debug events.
- `pnpm smoke:shared` starts a shared-session host, posts over WebSocket, and verifies bid/phase/echo response events.
- `packages/daemon/src/sidecar.ts` starts a shared-session sidecar on `127.0.0.1:0`, prints `{ port, token, bootId }`, and requires the token for WebSocket connections.
- `pnpm smoke:sidecar` starts the sidecar entry, validates the handshake, performs a token-authenticated WebSocket round trip, and exercises a subprocess check.
- Verification: `pnpm typecheck`, `pnpm test`, `pnpm --filter @quorum/client-web build`, `pnpm smoke:shared`, and `pnpm smoke:sidecar` pass.

What is not implemented yet:

- **One-click install is not done.** There is no Tauri desktop shell yet, no macOS `.dmg`, no Windows installer, no signing/notarization, no auto-update, and no packaged sidecar.
- **End-user one-click launch is not done.** The app cannot yet be installed and launched by double-clicking a desktop application.
- **Developer one-command launch exists.** Use `pnpm dev` for the legacy kernel or `QUORUM_SESSION_KERNEL=shared pnpm dev` for the new shared-session kernel.
- **Local sidecar entry exists but is not packaged.** The sidecar can be run through tsx and validated with `pnpm smoke:sidecar`; Bun compile compatibility is not verified because this machine does not currently have `bun` installed.
- The Web UI now exposes the new shared-session phase and bid queue, but it is still a minimal projection. It does not yet provide full replay controls, policy tuning, rich arbitration score inspection, or memory inspection.
- The new tool runtime, memory compaction, replay UI, desktop sidecar lifecycle, and package build pipeline remain follow-up work.

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
pnpm typecheck
pnpm test
```

5. Start the packaging P0 spike from [`AGENT_FRAMEWORK_HANDOFF.md`](./AGENT_FRAMEWORK_HANDOFF.md):
   - Bun compile compatibility with SQLite. This is still open because `bun` is absent locally.
   - Playwright/browser-agent compatibility. This is still open.
   - fallback decision: Bun single binary vs Node runtime + JS bundle/resources.
6. After the compile/bundle decision, implement Tauri 2, sidecar lifecycle management around the existing handshake, macOS/Windows installers, signing/notarization, and updater.

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

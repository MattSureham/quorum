# Quorum

A framework where a human and multiple heterogeneous coding agents (Claude Code,
Codex, plain API models, …) collaborate in **one shared group chat on one project**.
The human is a first-class participant who can speak or interrupt at any time;
agents address and rebut each other; every agent keeps its **native tool-calling**.

The name: a *quorum* is the set of members who must be present to deliberate — here
the human is counted as a required participant, never locked out.

## How it works (one breath)

A room has one **append-only event log** (the source of truth). A **Conductor**
decides who holds the speaking floor (default: free-for-all "raise hand"; also
directed-@ and moderated). Each agent runs in its **own CLI/SDK session**; the
framework only projects the transcript delta into it and normalizes its native
events back onto the log. Everyone works in **one shared git working dir on one
branch**, serialized by a **write-floor** lock with a **per-turn checkpoint commit**.

```
clients ──ws──▶ daemon ─ gateway · event-log · Conductor · participants · git workspace
```

See **[SPEC.md](./SPEC.md)** for the full design (data model, Conductor state
machine, adapter contracts with verified Claude Code / Codex invocations, WS
protocol, milestones M0–M6, acceptance tests).

## 2026-07 Architecture Update

Quorum is being migrated to the newer shared-session architecture captured in
[`AGENT_FRAMEWORK_HANDOFF.md`](./AGENT_FRAMEWORK_HANDOFF.md). The first slice is
implemented in `@quorum/core` as a parallel kernel:

- `SessionManager` — event-sourced shared-session state machine.
- `CommandMailbox` — serial command execution per session.
- `Arbiter` — service-side bid scoring with capped rebuttal bonus.
- `LegacyAgentAdapter` — bridge from the old `Participant.takeTurn()` contract to
  the new `ISpeakerAgent.bid()/speak()` contract.
- `SqliteStore` now bootstraps the shared-session tables for sessions, turns,
  bids, snapshots, memory, agent configs, provider configs, and migrations while
  preserving the append-only event log as the source of truth.
- `projectSessionState()` rebuilds the live shared-session projection from replayed
  events.
- `createWorkingMemorySummary()` and `SessionManager.compactWorkingMemory()` provide
  deterministic working-memory compaction, persisted through `SqliteStore`.
- `@quorum/client-web` now projects shared-session events into a phase display,
  active speaker status, bid queue, selected speaker, and debug timeline.

Copied meeting materials and the implementation handoff are in
[`docs/architecture/`](./docs/architecture/).

To run the daemon against the new kernel during migration:

```bash
QUORUM_SESSION_KERNEL=shared pnpm dev
```

To test the Web UI without Claude/Codex credentials, run the shared kernel with
the deterministic echo config:

```bash
QUORUM_SESSION_KERNEL=shared QUORUM_CONFIG=quorum.webui-smoke.config.json QUORUM_DB_PATH=.quorum/webui-smoke.sqlite pnpm dev
```

Then open `http://127.0.0.1:5173`, type into "Message the room", and press Send.

To run a fast shared-session smoke test without opening the browser:

```bash
pnpm smoke:shared
```

The test suite includes a three-agent shared-session integration test that verifies
queued bids can drive an open discussion across three agents.

Shared-session tool calls now have the approval loop wired through WebSocket
`approve_tool`. Approved safe room tools execute and emit `tool_call` /
`tool_result`. Approved external command tools such as `Bash` now route through
a daemon-provided local sandbox executor with workspace cwd isolation, timeout,
output truncation, allowlisted tool names, and dangerous-command blocking.

The WebSocket gateway also exposes `replay_projection`, and the Web UI includes
a Replay panel that rebuilds shared-session phase/speaker/bid state from a chosen
event sequence.

The Web UI is organized around the primary workflow: session selection on the
left, the chat/session stream in the center, and participant/provider status on
the right. Provider credentials are edited from a modal opened by the Providers
panel; API key inputs are not shown on the main workspace. Diagnostics such as
replay, memory, tools, and checkpoints are collapsed so they do not dominate
normal use.

Working-memory summaries are now generated, persisted, triggerable through
WebSocket `compact_memory`, exposed in the Web UI Memory panel, and automatically
created after turns once the configured event thresholds are reached.

Packaging status: developer one-command launch exists, and a local sidecar entry
now exists at `packages/daemon/src/sidecar.ts`. It binds a random loopback port,
prints `{ port, token, bootId }` to stdout, and requires the token for WebSocket
connections. Validate it with:

```bash
pnpm smoke:sidecar
```

Desktop shell status: a Tauri 2 shell now exists in `apps/desktop`. It starts the
compiled Bun sidecar, reads the `{ port, token, bootId }` handshake, and gives the
React client a token-authenticated WebSocket URL automatically.

```bash
pnpm desktop:check
pnpm desktop:dev
```

Packaging toolchains are isolated under `.tools/`:

```bash
pnpm packaging:env
source .tools/packaging-env.sh
```

Bun single-file sidecar compile is validated:

```bash
pnpm sidecar:bun:build
pnpm sidecar:bun:smoke
```

The Node-runtime fallback artifact can also be built and smoke-tested:

```bash
pnpm sidecar:node:build
pnpm sidecar:node:smoke
```

Installer-grade release is not done yet. An unsigned macOS arm64 `.app` and `.dmg`
can now be produced with `pnpm desktop:build`, and the bundled app includes the
Bun sidecar under `Contents/Resources/sidecars/quorum-sidecar`. Remaining release
work is signing/notarization, updater wiring, Windows installer generation,
platform-specific validation, and hardening the desktop lifecycle.

## Status

Scaffold + runnable core (M0 done, M1/M2 core logic in place):

- `@quorum/protocol` — event/room types + zod wire schema
- `@quorum/core` — EventLog, Conductor, the three floor policies, projection — **dependency-free, tested**
- `@quorum/daemon` — adapters (echo + real Claude Code / Codex / API), git workspace, SQLite store, WS gateway
- `@quorum/cli` — minimal daemon launcher
- `@quorum/client-web` — placeholder (M5)

## Run it

Requires Node ≥ 20. Install deps with pnpm (recommended) or npm:

```bash
pnpm install        # or: npm install
```

**Local demo — no real CLI needed.** Two scripted "echo" agents debate, then you
see live floor control + a human interrupt, all dependency-free:

```bash
pnpm demo           # npx tsx scripts/demo.ts
```

**M0 core check** (EventLog ordering/replay) and the test suite:

```bash
pnpm smoke          # quick, dependency-free
pnpm test           # vitest
pnpm typecheck      # tsc -b (needs deps installed)
```

> Note: the dependency-free path (`demo`, `smoke`) runs straight from TypeScript
> source via `tsx`. The real adapters/gateway/store need their deps installed,
> and the Claude Code / Codex adapters need those CLIs/SDK installed locally.

## Wire real agents

Start the daemon + Web UI, then use the **Providers** panel's credential modal to
save provider API keys, base URLs, and default models. The modal is hidden during
normal chat/session work. Credentials are stored locally in the Quorum SQLite
database, applied to the daemon process immediately, and only returned to the
browser as masked previews.

The agent roster still comes from the room config for now: `quorum.config.json`
or `QUORUM_CONFIG=<path>`. Each agent is a `ParticipantDescriptor` with an
`adapter`:

- `claude-code` → needs `@anthropic-ai/claude-agent-sdk` + Claude Code auth
- `codex` → needs the `codex` CLI on PATH (runs `codex exec --json`)
- `api-model` → any OpenAI-compatible endpoint (no file edits; good for moderator)
- `echo` → the built-in fake agent

```bash
QUORUM_SESSION_KERNEL=shared pnpm dev
```

Then open `http://127.0.0.1:5173`, open the Providers configuration modal if
real LLM credentials are needed, and send a room message.

## Layout

```
apps/
  desktop/    Tauri desktop shell
packages/
  protocol/   types + zod schema (zero runtime deps)
  core/       room engine: event-log, conductor, policies, projection
  daemon/     adapters, git workspace, sqlite store, ws gateway, wiring
  cli/        daemon launcher
  client-web/ React client (M5 placeholder)
scripts/      demo.ts (end-to-end) · smoke.ts (M0)
SPEC.md       full design + handoff spec
```

Built from scratch; floor/transport model informed by Paseo's daemon + thin-client approach.

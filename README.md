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
- Shared-session room metadata is persisted, so the daemon can list and continue
  prior sessions after restart without copying events or changing session ids.
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
left, the chat/session stream in the center, and participant plus agent/model
configuration on the right. The right panel is agent/model-oriented: Codex,
Claude Code, OpenClaw-style adapters, and direct API model agents such as
DeepSeek/GLM/MiniMax are the user-facing units. Provider credentials are only hidden
credential sources for API-model agents; they are not webchat sessions and are
not shown as the primary selection surface. Diagnostics such as replay, memory,
tools, and checkpoints are collapsed so they do not dominate normal use.

The built-in Claude-family local agent is named **Claude Code** because it uses
the `claude-code` adapter and local Claude Code auth/session. Anthropic API
models should be added as explicit API-model participants, for example a
`Claude Sonnet` or `Claude Opus` preset, not as a generic `Claude` participant
that secretly maps to the Claude Code adapter.

Working-memory summaries are now generated, persisted, triggerable through
WebSocket `compact_memory`, exposed in the Web UI Memory panel, and automatically
created after turns once the configured event thresholds are reached.

Continue-session support is implemented for the shared kernel. The left session
list includes persisted sessions; selecting an old session sends `continue_session`,
rebuilds the in-memory `SessionManager` from SQLite, returns a replay snapshot
with memory summaries, and appends new events after the existing head seq. CLI
agents such as Claude Code and Codex store their native session/thread id in
agent-private memory and attempt a best-effort resume. If native resume fails,
Quorum records a diagnostic warning and retries with a deterministic context
bundle reconstructed from the authoritative event log and working memory.

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

Installer-grade signed release is not done yet. Unsigned test builds are now
available for macOS and Windows:

- macOS arm64: `pnpm desktop:build` produces an unsigned `.app` and `.dmg`.
- Windows x64: manually run the **Windows Installer** GitHub Actions workflow.
  It runs typecheck/tests, builds the sidecar/Web UI, builds an unsigned NSIS
  installer, and uploads these artifacts:
  - `quorum-windows-nsis-installer` — the one-click `.exe` installer
  - `quorum-windows-bundle-output` — the full Tauri bundle directory
  - `quorum-windows-sidecar` — the bundled `quorum-sidecar.exe` for debugging

The Windows test installer is unsigned. Windows may show an "unknown publisher"
or SmartScreen warning. Manual acceptance check: install the `.exe`, launch
Quorum, confirm the UI connects to the sidecar, send a message to the Echo
session, create a session with a workspace path, and confirm closing the app
stops the sidecar process. The desktop bundle includes Windows icon resources,
and local CLI agents such as Claude Code are launched through the Windows shell
so `.cmd` shims work. Remaining release work is signing/notarization, updater
wiring, and broader platform lifecycle hardening.

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
> and the Claude Code / Codex adapters need those CLIs installed locally.

## Wire real agents

Start the daemon + Web UI, then use the **Agents & Models** panel to inspect the
room's active agents and available agent/model types. Use **Configure API keys**
only for direct API model agents such as DeepSeek/GLM. The modal includes common
presets for OpenAI, DeepSeek, Zhipu, MiniMax, and Anthropic, plus an **Add
provider** action for arbitrary OpenAI-compatible providers such as Moonshot,
OpenRouter, or a private gateway. CLI agents such as Codex and Claude Code use
their own local auth/session. The key modal is hidden during normal chat/session
work. Credentials are stored locally in the Quorum SQLite database, applied to
the daemon process immediately, and only returned to the browser as masked
previews.

The agent roster still comes from the room config for now: `quorum.config.json`
or `QUORUM_CONFIG=<path>`. Each agent is a `ParticipantDescriptor` with an
`adapter`:

- `claude-code` → runs the local `claude -p --verbose --output-format
  stream-json` CLI subprocess by default and reuses Claude Code's local
  auth/session. It does not inherit `ANTHROPIC_API_KEY` by default, so API-model
  credentials cannot accidentally override local Claude Code login. Set
  `adapterConfig.transport: "sdk"` only if you explicitly want the optional
  Agent SDK path.
- `codex` → needs the `codex` CLI on PATH (runs `codex exec --json`)
- `api-model` → any OpenAI-compatible endpoint (no file edits; good for moderator)
- `echo` → the built-in fake/test agent; it returns a fixed response and is only
  for smoke tests or UI verification

Claude Code and Codex are subprocess agents, not generic API models. They run in
the session workspace as their current working directory and retain their native
tool/function-calling behavior. Claude Code is not launched with `--bare`, so its
configured Claude Code skills, MCP servers, hooks, and local auth remain
available. Codex runs through `codex exec --json` and keeps its own native tool
events/MCP output.

```bash
QUORUM_SESSION_KERNEL=shared pnpm dev
```

Then open `http://127.0.0.1:5173`, use **Configure API keys** only if direct API
model agents need credentials, and send a room message.

## Sessions and Modes

The Web UI exposes session setup from the left **Sessions** panel via **New
session**. The setup modal supports:

- participant selection by agent/model, including current room agents and
  available model-agent presets
- session creation fields (`Session id`, `Title`)
- per-session `Workspace path`; CLI/subprocess agents run from that path, and
  sandboxed tool execution is scoped there
- mode selection for `自由讨论`, `抢麦/举手`, and `按序陈述`

The setup form keeps its editable draft local to the modal. Field handlers copy
input values before updating state, so typing `Session id` / `Title`, switching
modes, and toggling participants do not close the modal or blank the app.

`Start session` now calls the daemon `create_session` route. The shared-session
host keeps an in-memory multi-session registry, creates a new `SessionManager`
for the selected roster, and the gateway routes `subscribe/post_message` by
session id. Dynamically-created sessions persist their room metadata and can be
continued after daemon restart. Current limitation: `按序陈述` currently creates
a session but still executes on the shared bid kernel until a strict round-robin
scheduler is added.

After a message is sent, the composer shows a run-status banner derived from the
event stream. It reports submitted/waiting, bid collection, speaker selection,
speaking, settling, completion, and stalled waits, so a silent session is visible
as a specific phase rather than looking like the Send button did nothing.

The central **Chat** transcript is intentionally message-only: it shows human
prompts and agent/model replies. Floor grants, bids, thinking updates, tool
events, checkpoints, and other operational records stay in the less prominent
diagnostics/checkpoint panels so the primary surface does not read like a log.

Chat messages can include image attachments. The Web UI sends image data as
message attachments, renders thumbnails in the transcript, and keeps those
attachments in the event log. Direct `api-model` agents receive attached images
through OpenAI-compatible `image_url` multimodal content, so vision-capable
models can inspect them. CLI agents receive attachment metadata in their
projected transcript; a dedicated local-file bridge for CLI vision input is a
future enhancement.

Direct API model agents also report configuration failures in the chat stream.
For example, selecting DeepSeek without `DEEPSEEK_API_KEY` produces a visible
agent message explaining the missing key instead of completing with no reply.

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

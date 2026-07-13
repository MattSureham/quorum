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

The Web UI supports English and Chinese from the left **Connection** panel. The
selected language is stored in `localStorage` as `quorum.client.language` and
applies immediately to the primary session, chat, participant, credential, and
diagnostics controls.

The composer's **Take write floor** action pauses agent file editing while the
human edits the workspace directly. When held, the button changes to **Release
write floor** and stays clickable; releasing it or sending a chat message lets
agents continue. In shared-session mode this is now wired to the same
`GitWorkspace` write-floor path used by editable agents, so file-capable agent
turns acquire a serialized workspace lease and produce per-turn checkpoint events
when they change files.

The Web UI shows compact capability badges on agent/model rows. Local CLI
agents are distinguished from direct API models, and badges surface file-edit,
command/tool, vision, placeholder, key-required, and health-unknown states so
the participant list is not just a name roster.

The run-status banner explains the current execution stage rather than only
showing a final phase. It distinguishes local queueing, daemon acknowledgement,
bid collection, speaker selection, agent contact, agent thinking/output, running
tools, waiting for tool approval, normal completion, failure, and the important
"completed without visible reply" case.

Shared-session mode semantics are visible in the diagnostics panel. Open
discussion is shown as free bidding, Raise hand as floor requests that wait for
the active speaker to finish, and Round robin as the selected participant order
with current, completed, and remaining speakers.

Agent health checks can be triggered from the **Agents & Models** panel and run
automatically when a session snapshot loads. The first pass checks local CLI
availability and required non-interactive flags for Codex/Claude Code, API key env availability for direct API
models, and placeholder/unknown adapter states. Full native-login verification
still happens on the first real CLI turn because those tools own their local
auth/session state.

The Agents & Models panel now presents selectable **agent profiles** instead of
provider rows. A profile binds a user-facing role, adapter type, provider, model,
and capability labels, for example Codex local builder, Claude Code local
reviewer, DeepSeek analysis model, or MiniMax vision reader. Provider credentials
remain hidden credential sources used by API-model profiles.
Users can also add/delete custom API-model profiles from the Web UI. Custom
profiles are persisted locally in `localStorage` and are available in new
session setup alongside built-in profiles.

The session sidebar separates reversible cleanup from destructive deletion:
Archive hides a session locally without deleting SQLite data, Export downloads a
JSON bundle of the currently loaded room/events/memory summaries, and Delete
still performs a confirmed hard delete of Quorum's local session rows.
The sidebar also shows session lifecycle (`active`, `completed`, or `archived`).
Archive/Unarchive now uses a persisted room lifecycle field through the
WebSocket gateway when connected, while retaining the older local archive state
as a fallback for offline UI state.

Context continuity is visible in shared-session diagnostics. The panel surfaces
native-resume failure warnings, shows when the room is continuing from the
Quorum context bundle, and displays the latest memory-summary sequence range.
Context checksums are still embedded in the agent prompt bundle rather than
exposed as a standalone UI field.

Diagnostics include a **Turn Trace** panel. Shared-session turns now emit
`turn_trace` events with speaker, duration, tool-call count, output count, and
outcome; the UI falls back to deriving the same view from older event logs when
trace events are absent. Backend token counts, native session ids, and detailed
failure categories are still future work.

Prompts received while an agent is speaking are persisted immediately and then
processed through a FIFO queue, with a fresh epoch and bid collection after the
active turn. Adapter failures use structured `turn_failed`/`turn_trace` payloads
instead of appearing as successful turns with no visible reply.
Queued prompt markers are replayed after daemon restart, so an accepted but not
yet activated prompt is not stranded when the process exits mid-turn.

The Codex CLI adapter accepts both current `item.type` JSONL events and older
`item.item_type` events. Spawn errors, stderr/non-zero exits, authentication or
argument failures, and successful runs with no assistant message are surfaced
as failed turns; native resume fallback is attempted at most once.

Shared-session modes are enforced by the scheduler. Addressed prompts only ask
the selected agents to bid; `noConsecutive` uses the actual last speaker id;
Raise hand records each structured bid as a floor request and never preempts the
active speaker. Open discussion recollects follow-up bids within
`maxTurnsPerTopic`, reserving the final turn for a forced concrete wrap-up.
The final round-robin speaker receives the same wrap-up requirement.

Continue Session now restores the last compaction boundary and versioned shared
memory from the event store; shared memory is included in the deterministic
Context Bundle. Image data URLs are excluded from text projections and context
summaries. Vision API requests receive only the images attached to the prompt
that opened the current epoch, with six-image, 5 MB per-image, and 12 MB total
gateway limits.

Session setup exposes a first-pass permission policy: read-only, workspace-write,
approval-required, or full-auto. The selected policy is written into participant
adapter config; Codex sandbox and Claude Code permission mode are mapped from it.
Because native CLI tool calls are not yet all bridged through Quorum approval,
`approval-required` maps local CLI agents to conservative modes (`read-only` for
Codex, default permissions for Claude Code) instead of pretending every native
tool call can already be intercepted.

When images are attached in chat, the composer now shows which session agents
can inspect image content and which agents will only receive metadata/projection
text. API-model vision support is currently identified for MiniMax-style vision
profiles; local CLI image file bridging is still future work.

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
bundle reconstructed from the authoritative event log and working memory. The
bundle includes a context checksum, seq/hash anchors, and explicit error-control
rules telling the model to prefer Quorum's authoritative context over native
hidden memory, avoid silently filling gaps, and surface uncertainty when restored
context is incomplete.

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

Runnable shared-session application with persisted sessions, Web UI, and desktop packaging:

- `@quorum/protocol` — event/room types + zod wire schema
- `@quorum/core` — EventLog, Conductor, the three floor policies, projection — **dependency-free, tested**
- `@quorum/daemon` — adapters (echo + real Claude Code / Codex / API), git workspace, SQLite store, WS gateway
- `@quorum/cli` — minimal daemon launcher
- `@quorum/client-web` — React session/chat/configuration and diagnostics client

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

Built-in API profiles show the exact model id sent to the provider. Role labels
such as analysis or fast do not claim a different underlying model; create a
custom profile when a provider exposes a newer model id.

After a provider API key is configured, Session setup exposes that provider's
language-model catalog as individual participants. The built-in catalog includes
an explicitly labelled flagship plus practical faster/cheaper models for
OpenAI, DeepSeek, Zhipu, MiniMax, and Anthropic. DeepSeek uses V4 Pro/Flash,
Zhipu includes GLM-5.2/5.1 and GLM-5V, MiniMax includes M3 and M2.7/HighSpeed, and Anthropic
API profiles use the native Messages protocol rather than the OpenAI-compatible
adapter path. Local Codex and Claude Code agents continue to use their own CLI
model defaults and authentication. Custom profiles remain available for model
ids not yet present in the built-in catalog.

In the desktop app, Session setup includes a native folder picker beside the
workspace path field. The chosen absolute path is written into the session
draft; manual entry remains available, including in browser-only development.

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

The `echo` adapter is a deterministic local fake agent, not a model. It returns
configured script text and is intended for smoke tests, UI checks, and no-key
demo sessions.

## Sessions and Modes

The Web UI exposes session setup from the left **Sessions** panel via **New
session**. The setup modal supports:

- participant selection by agent/model, including current room agents and
  available model-agent presets
- session creation fields (`Session id`, `Title`)
- per-session `Workspace path`; CLI/subprocess agents run from that path, and
  sandboxed tool execution is scoped there
- mode selection for `Open discussion`, `Raise hand`, and `Round robin`

The left session list also has a delete action. Deleting a session removes its
local transcript/events, projections, turns, bids, working-memory summaries,
shared memory, and agent-private native session ids from Quorum's SQLite store.
Use it for completed projects or throwaway test sessions to keep the sidebar and
local cache small. The sidebar records a local deleted-session marker as soon as
delete is requested, ignores stale snapshots for that id, and no longer falls
back to showing a deleted final session. The daemon broadcasts `session_deleted`
to every connected Web UI client.

The setup form keeps its editable draft local to the modal. Field handlers copy
input values before updating state, so typing `Session id` / `Title`, switching
modes, and toggling participants do not close the modal or blank the app.

`Start session` now calls the daemon `create_session` route. The shared-session
host keeps an in-memory multi-session registry, creates a new `SessionManager`
for the selected roster, and the gateway routes `subscribe/post_message` by
session id. Dynamically-created sessions persist their room metadata and can be
continued after daemon restart. `Round robin` now uses a strict round-robin
scheduler: each agent speaks once in the selected participant order, the next
speaker is granted only after the previous turn releases the floor, and routine
bid collection is skipped for that mode.

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
  client-web/ React session/chat and diagnostics client
scripts/      demo.ts (end-to-end) · smoke.ts (M0)
SPEC.md       full design + handoff spec
```

Built from scratch; floor/transport model informed by Paseo's daemon + thin-client approach.

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

`pnpm dev` keeps Vite running and automatically restarts the local daemon if it
exits unexpectedly. The Web client reconnects to the current runtime; the Tauri
client also asks the desktop host to restart a dead sidecar before reconnecting.
Development credentials use the stable `.quorum/credentials.sqlite` store even
when `QUORUM_DB_PATH` selects a different session/event database.
Provider credentials are daemon-level state rather than Session state. They
remain readable and editable when the Session list is empty, so deleting the
last completed Session does not make configured API models appear unconfigured.

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

The optional Node sidecar fallback is assembled with `pnpm sidecar:node:build`
and verified with `pnpm sidecar:node:smoke`. Its runtime layout explicitly links
the document stack (`@xmldom/xmldom`, `unpdf`, and `yauzl`) as well as SQLite,
WebSocket, and schema dependencies; update that list whenever the daemon gains a
new eagerly imported runtime package. Windows portable/installer builds continue
to use the single-file Bun sidecar by default.

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
"completed without visible reply" case. Status is projected from the newest turn
lifecycle: an older failure cannot cover a newer running agent, and a hard
interrupt remains `Cancelling` until that turn emits `turn_cancelled`, then shows
`Interrupted` rather than `Completed`.

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
authoritative shared-session context bundle, and displays the latest
memory-summary sequence range.
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
Prompts arriving during the post-turn settling window use the same queue: the
settler checks pending human input before follow-up bids or an idle transition,
so a sole-agent Session cannot strand the second message until a third arrives.
Queued prompt markers are replayed after daemon restart, so an accepted but not
yet activated prompt is not stranded when the process exits mid-turn. New
shared sessions use a minimum three-minute agent execution deadline. A deadline
is reported as a visible timeout failure, and when every candidate fails the
scheduler returns to `idle` instead of silently reopening bid collection.
If the host restarts during a transient phase or active turn, Quorum closes the
orphaned turn with a `daemon_restart` failure and normalizes the room to `idle`.
It deliberately does not replay an interrupted agent turn because its tools or
workspace edits may already have produced side effects.

The Codex CLI adapter accepts both current `item.type` JSONL events and older
`item.item_type` events. Spawn errors, stderr/non-zero exits, authentication or
argument failures, and successful runs with no assistant message are surfaced
as failed turns; native resume fallback is attempted at most once. A Codex
`turn.failed` event is classified from its reported detail, so request timeouts
appear as `timeout` rather than a generic adapter failure. The run banner names
the failed participant and follows the newest terminal turn, preventing an
earlier failure from hiding a later successful reply. Open-discussion follow-up
bids replace the same agent's derived bid row for that epoch while the
append-only event log retains every bid revision. Codex `error` stream records
such as `Reconnecting... n/5` are transport notices rather than terminal turn
failures: Quorum keeps waiting for Codex's HTTPS fallback and only fails on
`turn.failed`, non-zero process exit, deadline, or final empty output. A terminal
`turn.failed` is not yielded to the scheduler until the Codex CLI process tree
has been terminated and its close event observed. Unix runs use a dedicated
process group; Windows runs use `taskkill /T`. The workspace lease therefore
cannot pass to another agent while the failed Codex process may still edit.

Shared-session modes are enforced by the scheduler. Addressed prompts only ask
the selected agents to bid; `noConsecutive` uses the actual last speaker id;
Raise hand records each structured bid as a floor request and never preempts the
active speaker. Session setup stores the selected participant order and an
advisory `targetDiscussionRounds` value. Round robin repeats that order for each
target round; bidding modes use it as the equal-score tie-break. Reaching the
target never aborts an active turn. Instead, the scheduler starts one ordered
wrap-up pass in which every selected agent must state a concrete conclusion and
preserve unresolved disagreement for Continue Session. `maxTurnsPerTopic`
remains an internal hard safety ceiling rather than the user-facing round target.
In bid-based modes, a Session with only one eligible agent completes after that
agent's first response: there is no second participant to discuss or rebut, so
Quorum does not spend the six-turn safety budget asking the same model to repeat
itself. Explicit round-robin scheduling remains available for deliberate repeated
passes.

New Session creation is confirmation-driven: the setup dialog remains open and
keeps its draft until the daemon returns `session_created`. Validation, gateway
rejection, disconnect, and timeout errors are shown inside the dialog instead of
discarding the form or leaving a stale raw gateway error in the Connection panel.
Each create command and response carries a `requestId`; unrelated gateway errors
cannot fail the pending form, and late/stale success responses may refresh the
Session list but cannot switch the active room. All setup controls are frozen
while the matching request is pending. Historical Echo configs are reduced to
their strict `text`/`script` fields before a room is copied. Echo `type` and
`intent` values must already be primitive strings; coercible arrays/objects and
empty script steps are discarded. If no valid script remains, `script` is
omitted so the adapter uses top-level `text` or its deterministic default.
The dialog traps keyboard focus, closes with Escape when no request is pending,
marks the background inert, restores the opener focus, and exposes mode and
permission choices as pressed-state controls for assistive technology.
At desktop/tablet widths the three primary columns remain independent scrolling
regions, with narrower sidebars at 1280 px and below instead of moving
configuration on top of the chat. At 960 px and below the app becomes a
naturally scrolling single-column document; the Session list is height-bounded, Chat keeps a stable
transcript viewport, and the composer is reachable. New session stays pinned to
the bottom of the independently scrolling Session list rather than rendering
under the following Chat layer. Session setup keeps its
header and actions visible while only its content grid scrolls.

Continue Session now restores the last compaction boundary and versioned shared
memory from the event store; shared memory is included in the deterministic
Context Bundle. Attachment data URLs and extracted document bodies are stored in
a separate SQLite payload table rather than inside append-only event JSON. Replay,
subscribe, context compaction, and ordinary chat history therefore carry bounded
attachment metadata only; the Web UI retrieves one original payload on demand
when the user opens a historical attachment. Vision API requests
receive only the images attached to the prompt that opened the current epoch.
PDF and DOCX attachments are parsed locally by the sidecar and their bounded
plain-text extracts are shared with every agent only for the active topic. The
gateway accepts at most six attachments: raster images up to 5 MB, PDF/DOCX up
to 10 MB each, and 20 MB total. Extracts are capped at 120,000 characters per
document and 160,000 characters per prompt. DOCX ZIP metadata is preflighted for
entry-count and declared-size limits, then every entry is actually streamed and
counted under per-entry and total expanded-size ceilings. The main OOXML document
part has an additional 8 MB actual-size limit and is parsed locally only after
validation. DOCX timeout aborts close the active ZIP stream rather than leaving
decompression running in the background. Scanned PDFs without embedded text are
reported as requiring OCR; OCR is not implemented yet.

Session setup exposes a first-pass permission policy: read-only, workspace-write,
approval-required, or full-auto. The selected policy is written into participant
adapter config; Codex sandbox and Claude Code permission mode are mapped from it.
Because native CLI tool calls are not yet all bridged through Quorum approval,
`approval-required` maps local CLI agents to conservative modes (`read-only` for
Codex, default permissions for Claude Code) instead of pretending every native
tool call can already be intercepted.

When files are attached in chat, the composer shows which session agents can
inspect image content and which receive image metadata only. Extracted PDF/DOCX
text is available to every participant. API-model vision support is currently
identified for MiniMax-style vision profiles; local CLI image file bridging is
still future work.
Async file completion appends to the composer's current ref-backed attachment
list. Removing an already loaded file while another FileReader is pending is
therefore durable; the deleted file cannot reappear when the later read resolves.

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
rules telling the model to prefer the authoritative Session context over native
hidden memory, avoid silently filling gaps, and surface uncertainty when restored
context is incomplete. The bundle is deliberately topic-neutral: host branding,
Session ids, participant ids, and workspace paths are marked as operational
metadata and must not be treated as evidence that the user's subject is Quorum
or the workspace project. A newly-created Session inherits no workspace when the
field is omitted; only an explicitly selected path enables repository context,
file tools, and workspace editing. Prompt activation is durably keyed by the
human message sequence for every scheduler, including round robin, so a queued
prompt that completed before shutdown is not executed again after restart.

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
- Windows x64: manually run the **Windows Packages** GitHub Actions workflow.
  It runs typecheck/tests, builds the sidecar/Web UI, builds an unsigned NSIS
  installer and portable ZIP, then uploads these artifacts:
  - `quorum-windows-nsis-installer` — the one-click `.exe` installer
  - `quorum-windows-x64-portable` — an extract-and-run ZIP plus SHA-256 checksum
  - `quorum-windows-bundle-output` — the full Tauri bundle directory
  - `quorum-windows-sidecar` — the bundled `quorum-sidecar.exe` for debugging

For the portable build, extract the whole ZIP to a writable folder and launch
`Quorum.exe`. No installer or registry setup is required, but the adjacent
`sidecars` directory must stay in place. Windows 10/11 x64 and Microsoft Edge
WebView2 Runtime are required; current Windows installations normally include
WebView2. The portable archive can also be assembled after a Windows Tauri
release build:

```powershell
pnpm portable:windows:package
```

This writes `dist-portable/windows-x64.zip` and
`dist-portable/windows-x64.zip.sha256`, and fails if either required executable
is missing.

The Windows test installer and portable executable are unsigned. Windows may show an "unknown publisher"
or SmartScreen warning. Manual acceptance check: install the `.exe`, launch
Quorum, confirm the UI connects to the sidecar, send a message to the Echo
session, create a session with a workspace path, and confirm closing the app
stops the sidecar process. The desktop bundle includes Windows icon resources,
and local CLI agents such as Claude Code are launched through the Windows shell
so `.cmd` shims work; Codex uses the same Windows-compatible launch path. Remaining release work is signing/notarization, updater
wiring, and broader platform lifecycle hardening.

On Windows desktop builds, Quorum stores its SQLite database, default workspace,
and `sidecar.log` under `%LOCALAPPDATA%\\dev.quorum.desktop`. The desktop launcher
also adds the standard native Claude Code (`%USERPROFILE%\\.local\\bin`) and npm
CLI (`%APPDATA%\\npm`) locations to the sidecar `PATH`, so Explorer-launched
portable builds can detect `claude.cmd`/`claude.exe` and `codex.cmd` without
requiring Quorum to be launched from a configured terminal.

## Status

Runnable shared-session application with persisted sessions, Web UI, and desktop packaging:

Images, PDFs, and DOCX files can be added with the **File** button. Images can
also be pasted directly into the message composer with `Ctrl/Cmd+V`. Pasted
images use the same preview, removal, visibility, payload limits, and send path
as uploaded files; ordinary text paste continues to work normally. Document
cards show extraction status, page count when available, truncation/parser
warnings, and retain access to the locally persisted original. Historical cards
load that original on demand, so reconnecting to a long room does not resend every
past base64 image or document through WebSocket snapshots. While a newly selected
file is still being read, the composer shows `Reading files` and disables Send,
the attachment picker, and Cmd/Ctrl+Enter submission. Text cannot leave first and
strand the completed attachment in the following draft.

Security/reliability hardening in the current shared-session path:

- Claude Code and Codex prompts are written to subprocess stdin. User prompt and
  dynamic room context never enter the Windows shell command line; model/native
  session identifiers accepted as CLI arguments are restricted to safe characters.
  Built-in adapter configs are validated by strict per-adapter schemas at the
  WebSocket boundary, and health checks use the same shell-safe binary validation.
- Codex native continuation uses the CLI's required argument hierarchy:
  `codex exec --sandbox <mode> resume <thread-id> --json -`.
- Opening an existing Git workspace never uses `checkout -B`. Existing branches
  are switched normally, missing branches are created, and a dirty tree blocks
  initialization instead of silently moving a branch pointer. For a brand-new
  repository only, missing Git identity is filled with repo-local Quorum defaults;
  user global Git configuration is never changed.
- Sessions sharing one canonical workspace path share a single coordinator,
  write-floor mutex, checkpoint queue, and out-of-band watcher. Waiting for that
  lease is queue time and does not consume the agent execution deadline.
- Working-memory summaries bound subsequent agent transcripts to post-summary
  events; without a summary, only the latest 60 events are passed as transcript.
- The local command executor is a cwd/env/timeout/pattern guardrail, **not an OS
  security sandbox**. Treat approval-required mode as human-reviewed local
  execution until a platform sandbox/container backend is added.

The Agents & Models sidebar keeps local CLI agents visible and groups API model
profiles into collapsible provider sections. The `API keys` button is pinned in
the panel header and opens the credential modal; secrets are never displayed in
the persistent sidebar. Built-in provider catalogs remain visible even before a
key is configured. Their models appear disabled with `needs key` in New session,
then become selectable immediately after that provider is configured.

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

The 2026-07-16 UX reliability follow-up passes `166/166` tests across 28 files,
typecheck, the Web production build, EventLog/shared/source/Node/Bun sidecar
smokes, and the desktop Rust check. Isolated Playwright acceptance also covers
the exact 1121x768 and 901x768 responsive boundaries, a prompt submitted during
`settling`, attachment deletion during a delayed read, and correlated/frozen
Session creation.
[Windows Packages run 29484858873](https://github.com/MattSureham/quorum/actions/runs/29484858873)
passes the same 166 tests on Windows, builds and smokes the compiled sidecar,
and uploads validated unsigned NSIS and portable artifacts.

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

Provider keys are currently stored as plaintext JSON inside that local SQLite
database. Quorum does not yet use macOS Keychain, Windows Credential Manager,
or field-level database encryption, so confidentiality depends on the current
OS account and database file permissions. Use appropriately scoped test keys
until system credential-store integration is available. Codex and Claude Code
credentials remain managed by their own CLIs and are not stored by Quorum.

Credential saving is available in both the legacy conductor and shared-session
daemon entrypoints. Save failures are shown inside the credential modal instead
of being hidden behind it. `QUORUM_DB_PATH` selects session/event data in both
kernels. `pnpm dev` separately defaults `QUORUM_CREDENTIAL_DB_PATH` to
`.quorum/credentials.sqlite`, so changing a test Session database no longer
makes configured providers disappear. On first use, missing provider rows are
copied from the selected legacy Session database; an existing row in the stable
credential store is never overwritten by an older test database. Direct daemon
launches may set `QUORUM_CREDENTIAL_DB_PATH` explicitly. Desktop and portable
builds keep their single stable database in the OS app-data directory. Keys do
not migrate between machines, and packaged artifacts never contain developer
credentials.

Credential commands do not require an active Session. The Web client requests
the daemon-level credential catalog independently, then waits for the persisted
Session list before continuing a room. With zero rooms, API-key configuration
and New Session remain available without a synthetic or stale room id.

Each credential save now carries a request id and shows `Saving`, `Saved`, or a
specific failure directly inside that provider card. If no sidecar response is
received within eight seconds, the card reports a portable-file mismatch
instead of appearing inert. Desktop sidecar protocol version 2 prevents a
`Quorum.exe` from silently running with an incompatible sidecar. Always replace
the entire extracted portable directory; never copy only `Quorum.exe` over an
older folder. For Windows diagnostics, inspect
`%LOCALAPPDATA%\\dev.quorum.desktop\\sidecar.log`.

Built-in API profiles show the exact model id sent to the provider. Role labels
such as analysis or fast do not claim a different underlying model; create a
custom profile when a provider exposes a newer model id.
Custom API profiles require an explicit provider id and remain unavailable until
that provider has a configured key. Profiles created by older builds without a
provider id are migrated to the OpenAI credential boundary rather than treated
as locally authenticated agents.

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

The browser Web UI can also select a workspace without typing its path. Its
folder button opens a read-only directory browser backed by the connected local
daemon; only directory names and absolute paths are returned, never file
contents. On a remote connection this intentionally browses the daemon host,
because that is where CLI agents and workspace tools execute.
New Session starts with an empty workspace field even when opened from an active
project room. Selecting a path is an explicit context decision; Quorum does not
silently carry the previous room's repository into an unrelated discussion.

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
events/MCP output. If a Session has no workspace, both CLIs run in a neutral
per-Session directory under the OS temporary directory instead of inheriting the
daemon's source/installation directory. That directory combines a readable slug
with a hash of the full Session id, so path-like ids cannot escape the neutral
root and ids that normalize to the same slug cannot share a directory.

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
continued after daemon restart. The setup modal includes up/down controls for
the selected participant order plus a 1-12 target-round control. `Round robin`
uses a strict scheduler: each target round follows that order, the next speaker
is granted only after the previous turn releases the floor, and routine bid
collection is skipped. After the target rounds, the same order is used for the
final wrap-up pass rather than cutting the discussion off at the numeric boundary.

After a message is sent, the composer shows a run-status banner derived from the
event stream. It reports submitted/waiting, bid collection, speaker selection,
speaking, settling, completion, and stalled waits, so a silent session is visible
as a specific phase rather than looking like the Send button did nothing. The
projection associates terminal and interrupt events with the latest `turnId`, so
prior failed turns do not override later active work.

The central **Chat** transcript is intentionally message-only: it shows human
prompts and agent/model replies. Floor grants, bids, thinking updates, tool
events, checkpoints, and other operational records stay in the less prominent
diagnostics/checkpoint panels so the primary surface does not read like a log.

Agent replies are rendered as sanitized GitHub-flavored Markdown rather than a
plain text blob. Chat supports compact headings, lists and task lists, tables,
blockquotes, links, fenced code, and Markdown images. A fenced `mermaid` block
renders flowcharts, sequence diagrams, pie charts, and XY charts on demand. Raw
HTML is disabled; Mermaid per-diagram configuration and active-content hooks are
rejected, Mermaid runs in strict mode, and generated SVG is sanitized before it
is inserted into the page. Agent-authored Markdown images are restricted to
bounded embedded PNG/JPEG/GIF/WebP data URLs; remote, relative, protocol-relative,
`blob:`, `file:`, and SVG image sources render as blocked text instead of causing
an automatic network or localhost request. The desktop CSP independently limits
images to self/data/blob and network connections to the local sidecar/IPC surface.
Invalid diagrams retain a readable source fallback.
Every agent receives these presentation capabilities in its turn context and is
asked to keep a textual conclusion alongside any visual.

Chat messages can include safe raster images, PDF files, and DOCX files. The Web
UI renders image thumbnails and document status cards, while the local sidecar
extracts PDF text with `unpdf` and DOCX paragraph text from the validated OOXML
document part before starting the agent turn. Direct `api-model` agents receive current-topic images through
OpenAI-compatible `image_url` multimodal content; every API and CLI agent
receives the bounded PDF/DOCX text through the Context Bundle. The authoritative
event retains attachment metadata and extraction status; the original data URL
and extracted body live in a Session-scoped SQLite payload row that can be loaded
individually. Historical prompts and snapshots do not repeat data URLs or full
document text. A dedicated local-file bridge for CLI image input remains a
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

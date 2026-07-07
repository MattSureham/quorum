# Multi-Agent Shared Session Framework: Implementation Handoff

Source meeting: `d65264e9-17ee-4a2c-a3c7-7df24a12317f`

Purpose: this document is the implementation handoff for coding agents. It is not a meeting transcript. It contains the decisions, module boundaries, interfaces, invariants, P0 tasks, and validation gates required to start implementation without re-running architecture discovery.

## 1. Final Architecture Decision

Build on the existing TypeScript codebase. Do not rewrite the backend in Python.

The product should evolve into a local multi-agent shared-session runtime with:

- A custom event-sourced `SessionManager` as the authoritative state machine.
- Multiple heterogeneous agents participating in the same live session.
- Human prompts that trigger raise-hand / microphone bidding.
- Agent rebuttals that may be queued while another speaker is active, but are only arbitrated after the current speaker finishes.
- A Web UI for session inspection, live debugging, replay, configuration, and policy tuning.
- A desktop app for macOS and Windows using Tauri 2 plus a local sidecar server.
- A localhost server mode retained for debugging, automation, and external clients.

## 2. Non-Negotiable Decisions

### 2.1 Language and Runtime

- Primary language: TypeScript.
- Runtime target: Bun preferred, Node-compatible fallback.
- Frontend: React + Vite.
- Validation: zod schemas in a shared protocol package.
- Storage: SQLite in WAL mode.
- Desktop shell: Tauri 2.
- Testing: vitest, fast-check, deterministic scheduler.

Reason: the current repo already contains substantial TypeScript assets: existing meeting engine, agent abstraction, WebSocket/HTTP server, provider adapters, browser agents, subprocess agents, protocol agents, MCP support, image context, and local orchestration logic.

### 2.2 LangGraph Boundary

LangGraph must not be used for global session orchestration.

Allowed:

- Optional agent-internal execution engine.
- Optional ReAct/tool loop implementation inside a single agent.
- Optional agent-private checkpointing scoped by `(sessionId, agentId)`.

Forbidden:

- Global shared-session state.
- Turn-taking.
- Bid arbitration.
- Shared memory authority.
- Event log authority.

The session-level source of truth is the custom `SessionManager`, event log, and state projection.

### 2.3 Desktop Packaging

Use Tauri 2 with a sidecar server.

The sidecar should:

- Bind to `127.0.0.1:0` in desktop mode.
- Generate a random token and `bootId`.
- Print exactly one startup JSON line to stdout:

```json
{"port":54321,"token":"<random-hex>","bootId":"<uuid>"}
```

- Serve HTTP and WebSocket APIs on the selected loopback port.
- Require auth on all HTTP and WebSocket requests.
- Flush SQLite and terminate sessions cleanly on shutdown.

The localhost debug mode uses the same server factory, but a different entrypoint:

- `serve.ts`: fixed or configured port, default `4200`, debug-friendly auth.
- `sidecar.ts`: port `0`, mandatory token, stdout handshake.

## 3. Target Repository Layout

Create or migrate toward this layout:

```text
apps/
  server/
    src/
      api/
      agents/
      cli/
        serve.ts
        sidecar.ts
      config/
      core/
        SessionManager.ts
        EventStore.ts
        StateMachine.ts
        Arbiter.ts
        CommandMailbox.ts
      memory/
      security/
      storage/
      tools/
  desktop/
    src-tauri/
    ui/
packages/
  protocol/
    src/
      events.ts
      commands.ts
      agents.ts
      sessions.ts
      memory.ts
      tools.ts
tests/
  arbitration/
  integration/
  packaging/
  scheduler/
  state-machine/
```

Preserve existing code and history where possible. Add adapters instead of forcing a large rewrite.

## 4. Core State Model

Each session has one serial command mailbox. No async caller may mutate session state directly. UI events, agent callbacks, tool results, WebSocket messages, timers, and cancellation signals must all submit commands into the mailbox.

### 4.1 Session Phase

```ts
export type SessionPhase =
  | "idle"
  | "collecting_bids"
  | "arbitrating"
  | "speaker_granted"
  | "speaking"
  | "settling"
  | "paused"
  | "ended";
```

### 4.2 Required Invariants

- At most one active turn per session.
- `speaker.selected` is only valid when there is no active speaker.
- During `speaking`, bids may be collected but arbitration is forbidden.
- Arbitration may run only after `turn.completed`, `turn.cancelled`, `turn.failed`, or `turn.timed_out`.
- Every streamed chunk carries `turnId` and `generation`.
- Late chunks from old generations must be rejected.
- SQLite transactions must be short and must not wrap model calls or tool calls.
- Persistent event append and projection update happen in the same transaction.
- If a state mutation cannot be persisted, the session must pause or fail closed.

## 5. Event and Command Protocol

### 5.1 Event Envelope

```ts
export interface SessionEvent<TPayload = unknown> {
  schemaVersion: number;
  eventId: string;
  sessionId: string;
  seq: number;
  type: string;
  actorId: string;
  correlationId: string;
  causationId?: string;
  occurredAt: string;
  visibility: "participant" | "debug" | "system";
  payload: TPayload;
}
```

Rules:

- `seq` is the only authoritative session ordering key.
- Events are append-only.
- Event schemas must be versioned.
- Upcasters are required for old event versions.
- Replay rebuilds state from events and snapshots without model calls.

### 5.2 Command Envelope

```ts
export interface SessionCommand<TPayload = unknown> {
  commandId: string;
  idempotencyKey: string;
  sessionId: string;
  actorId: string;
  type: string;
  expectedVersion?: number;
  submittedAt: string;
  payload: TPayload;
}
```

Rules:

- Commands are inputs, events are facts.
- Duplicate commands with the same idempotency key must not create duplicate events.
- Admin commands may require `expectedVersion`.

## 6. Turn-Taking, Raise-Hand, and Rebuttal

### 6.1 Bid Type

```ts
export type BidKind = "answer" | "rebuttal" | "followup" | "clarification";

export interface Bid {
  bidId: string;
  agentId: string;
  epoch: number;
  kind: BidKind;
  replyToTurnId?: string;
  confidence: number;
  createdAtSeq: number;
  expiresAfterRound: number;
  revision: number;
}
```

### 6.2 Arbitration Policy

Agents do not provide trusted scores. They only provide structured intent and a small confidence signal.

Server-side score:

```text
score =
  policy_base_score(kind, capability_match, user_mention, waiting_rounds)
  + decay_penalty(recent_speaking_count)
  + limited_rebuttal_bonus
  + confidence * epsilon
```

Rules:

- User explicit mention has top priority.
- Rebuttal bonus is capped at 20% of base score.
- Rebuttal is only eligible against the immediately previous completed turn.
- Rebuttal chains should be limited by policy.
- Recent speakers receive a decay penalty.
- Agents skipped for too many rounds receive anti-starvation boost.
- Stable tie-breaks must be deterministic and persisted.
- Other agents cannot see live bid rationale or competing bid details.
- Debug UI may show all bid rationale and scoring components.

### 6.3 Settling Window

After a turn ends, open a short settling window, default 300-500ms.

Allowed during settling:

- Withdraw a provisional bid.
- Downgrade priority.

Forbidden during settling:

- Changing bid kind.
- Increasing priority.
- Changing `replyToTurnId`.
- Creating a stronger new rebuttal based on hidden scoring.

## 7. Agent Harness

### 7.1 New Agent Interface

```ts
export interface ISpeakerAgent {
  health(): Promise<AgentHealth>;
  shutdown(): Promise<void>;
  bid(ctx: BidContext): Promise<Bid>;
  speak(
    turn: TurnContext,
    runtime: AgentRuntime,
    signal: AbortSignal
  ): AsyncGenerator<AgentDelta>;
  observe?(event: SessionEvent): Promise<void>;
}
```

### 7.2 Runtime Injected Into Agents

```ts
export interface AgentRuntime {
  callTool(req: ToolCallRequest): Promise<ToolCallResult>;
  readContext(seq: number): Promise<ContextSnapshot>;
  writeSharedMemory(cmd: SharedMemoryCommand): Promise<WriteResult>;
}
```

Rules:

- Tool calls go through `AgentRuntime.callTool()`.
- Tool calls are not encoded as text deltas.
- `SessionManager` handles auth, budget, audit log, human approval, timeout, cancellation, and event recording.
- Subprocess and protocol agents receive the same capabilities through the external agent protocol.
- Legacy `respond()` agents are wrapped with `LegacyAgentAdapter`.

### 7.3 LLM Adapter Migration

```ts
export interface LLMAdapter {
  chat(req: ChatRequest, signal?: AbortSignal): Promise<ChatResponse>;
  chatStream(req: ChatRequest, signal?: AbortSignal): AsyncGenerator<ChatDelta>;
}
```

Migration rule:

- Add `chatStream()`.
- Keep `chat()` as a compatibility method that can collect `chatStream()`.
- Existing providers can migrate incrementally.

## 8. Streaming and Backpressure

Streaming pipeline:

1. `SessionManager` consumes `agent.speak()` with `for await`.
2. Deltas enter a bounded accumulator.
3. Every 50-100ms, or after a byte threshold, flush as one `turn.output.chunk`.
4. Persist chunk to SQLite.
5. Broadcast persisted event to clients.
6. Slow WebSocket clients use bounded send queues.
7. Clients that fall behind are disconnected and reconnect using `after_seq`.
8. If provider streams cannot be backpressured and buffers fill, cancel the turn.

Principle: persistence first, UI realtime second. Never drop authoritative chunks.

## 9. Memory Architecture

### 9.1 Layers

| Layer | Authority | Scope | Notes |
|---|---|---|---|
| Transcript / Event Log | Authoritative | Session | Never deleted by compaction |
| Working Memory | Derived | Session | Summaries with provenance |
| Shared Memory | Event-written | Session | Versioned and auditable |
| Agent-Private Memory | Agent-owned | `(sessionId, agentId)` | LangGraph checkpoint may live here |
| Long-Term Memory | User opt-in | User / namespace | Viewable, deletable, TTL-capable |

### 9.2 Summary Provenance

Every summary must include:

```ts
export interface MemorySummary {
  summaryId: string;
  sessionId: string;
  sourceFromSeq: number;
  sourceToSeq: number;
  sourceHash: string;
  model: string;
  promptVersion: string;
  createdAt: string;
  content: string;
}
```

Compaction must not delete the authoritative event log. It may archive old events later, but replay and audit requirements must be preserved.

## 10. Storage and Migration

Use SQLite WAL with these core tables:

- `sessions`
- `events`
- `session_snapshots`
- `turns`
- `bids`
- `working_memory_summaries`
- `shared_memory`
- `agent_private_memory`
- `long_term_memory`
- `agent_configs`
- `provider_configs`
- `schema_migrations`

Indexes required in P0:

- `events(session_id, seq)` unique.
- `events(session_id, type, seq)`.
- `turns(session_id, turn_id)`.
- `bids(session_id, epoch, agent_id)`.

Migration strategy:

- Use expand-migrate-contract.
- Backup before schema upgrade.
- Import existing JSON sessions once.
- Do not dual-write JSON and SQLite.

## 11. Security Boundary

Call this permission isolation, not a full OS sandbox unless OS-level isolation is implemented.

Required:

- Sidecar binds loopback only.
- Desktop sidecar uses random port and random token.
- Token must not be written to disk, logs, argv, SQLite, or crash reports.
- WebSocket validates auth, Origin, and Host.
- Defend against DNS rebinding.
- API keys do not enter WebView, event log, session DB, or crash reports.
- macOS keys stored in Keychain.
- Windows keys stored in Credential Manager.
- Subprocesses use argv arrays, not shell strings.
- Subprocess environment is scrubbed.
- Subprocess cwd is restricted.
- Process tree must be terminated on cancellation or shutdown.
- Plugin permissions declared in a manifest and tied to version or content hash.
- New plugin permissions require re-authorization.

## 12. Web UI Scope

### P0 Screens

- Session Dashboard.
- Live Session View.
- Event Timeline.

### P1 Screens

- Session Replay.
- Agent Configuration.
- Memory Inspector.

### P2 Screens

- Provider / Key Management.
- Policy Settings.
- Debug Console.

Debug UI must expose:

- Event timeline.
- Bid queue.
- Bid scoring components.
- Agent health.
- Current phase.
- Current speaker.
- Stream chunk queue.
- Sidecar status.
- Replay from `after_seq`.

## 13. Desktop Build and Release

### P0 Compatibility Spike

Before committing to Bun-compiled sidecar packaging, verify compiled output can run:

- SQLite driver.
- HTTP server.
- WebSocket server.
- subprocess agents.
- browser / Playwright import and launch path.
- dynamic resource paths.
- process cancellation.

If spike fails, keep the same architecture and switch packaging to Node runtime plus JS bundle/resources.

### Release Requirements

- macOS arm64 build.
- macOS x64 build.
- Windows x64 build.
- macOS codesign and notarization.
- Windows signing, e.g. Azure Trusted Signing or equivalent.
- Tauri updater manifest and signed update artifacts.

## 14. P0 Implementation Plan

P0 goal: prove the new shared-session kernel works with three agents, live bidding, queued rebuttals, deterministic persistence, and a minimal UI.

### P0 Tasks

1. Create `packages/protocol` with zod schemas for events, commands, sessions, bids, turns, agents, tools, memory.
2. Implement SQLite event store and migration bootstrap.
3. Implement `CommandMailbox`.
4. Implement `SessionState` projection.
5. Implement explicit `StateMachine`.
6. Implement `Arbiter` with server-side scoring.
7. Implement bid collection and settling window.
8. Implement `ISpeakerAgent`.
9. Implement `LegacyAgentAdapter`.
10. Add `LLMAdapter.chatStream()`.
11. Implement bounded streaming accumulator and persisted chunks.
12. Implement HTTP and WebSocket API.
13. Implement `createServer()`.
14. Add `serve.ts` and `sidecar.ts`.
15. Build React P0 UI: dashboard, live session, event timeline.
16. Add deterministic scheduler test harness.
17. Add property tests for arbitration and state machine.
18. Add integration test for a three-agent open discussion.
19. Add packaging compatibility spike.
20. Preserve regression tests for existing meeting modes.

### P0 Acceptance Criteria

- User prompt opens a bid epoch.
- At least three agents can bid.
- Service-side arbiter selects a speaker.
- Speaker streams output.
- Other agents may bid during speaking.
- No new speaker is selected while current speaker is active.
- After turn end, settling window runs.
- Rebuttal can be selected after turn end.
- Events persist in SQLite.
- Reconnecting UI can catch up via `after_seq`.
- Replay rebuilds the same projected state.
- All P0 tests pass.
- Bun compile spike either passes or produces a documented fallback decision.

## 15. P1-P3 Roadmap

### P1

- Working memory compaction.
- Replay API and Replay UI.
- Agent config UI.
- Memory inspector.
- Tauri desktop app.
- Sidecar lifecycle management.
- macOS notarization.
- Windows signing.
- Auto-update.

### P2

- Long-term memory.
- Agent-private namespaces.
- SecretResolver with OS keychain.
- Tool sandbox and process-tree isolation.
- Plugin permission manifest.
- Provider/key configuration UI.
- Policy settings UI.

### P3

- Large transcript performance optimization.
- Stress testing.
- Full Debug Console.
- Release documentation.
- Public distribution hardening.

## 16. Required Tests

### Scheduler

- Fake clock.
- Deterministic async execution.
- Timer control.

### Property Tests

- No starvation.
- Rebuttal bonus cap.
- No `speaker.selected` during `speaking`.
- Legal phase transitions only.
- Idempotent command handling.
- Replay determinism.

### Integration Tests

- Three-agent open discussion.
- Bid during speaking.
- Cancel mid-turn.
- Agent timeout.
- Sidecar restart recovery.
- UI reconnect with `after_seq`.

### Packaging Tests

- Start compiled sidecar.
- Call `/health`.
- Open WebSocket.
- Run SQLite operation.
- Spawn and cancel subprocess.
- Import or launch Playwright path.

## 17. Rejected Alternatives

- Python rewrite: rejected due to high cost and loss of existing TypeScript assets.
- LangGraph as global scheduler: rejected because dynamic bidding and runtime agent arbitration are better modeled as an event-driven state machine.
- Electron: rejected because the app already uses a local server model and Tauri has lower overhead with cleaner sidecar lifecycle.
- Fixed desktop port: rejected due to multi-instance conflicts and security.
- Agent self-scoring: rejected because agents can game scores.
- Token-by-token SQLite writes: rejected due to write amplification.
- Redis pub/sub: rejected because the desktop app should not require external services.
- Exposing bid rationale to agents: rejected due to strategic behavior risk.
- JSON/SQLite dual-write migration: rejected because consistency is hard to prove.

## 18. Open Validation Items

These do not block P0 architecture work, but must be validated early:

- Bun compile compatibility with SQLite, subprocess, Playwright, and dynamic resources.
- Windows Job Object behavior from compiled sidecar.
- Exact Tauri updater flow for private distribution.
- Azure Trusted Signing setup details.
- Whether future OS-level sandboxing is required beyond permission isolation.

## 19. First Prompt for Implementation Agents

Use this prompt to start P0:

```text
Implement P0 of the multi-agent shared-session framework described in data/meetings/d65264e9-17ee-4a2c-a3c7-7df24a12317f-implementation-handoff.md.

Start by creating packages/protocol with zod schemas and TypeScript types for SessionEvent, SessionCommand, SessionPhase, Bid, Turn, AgentDelta, ISpeakerAgent, AgentRuntime, and LLMAdapter.chatStream().

Then implement apps/server/src/core with CommandMailbox, EventStore, StateMachine, Arbiter, and SessionManager. Preserve existing MeetingEngine behavior by adding adapters instead of deleting current functionality.

Acceptance criteria for this first slice:
- Three stub agents can join one session.
- A user prompt opens bid collection.
- Arbiter selects one speaker.
- Speaker streams chunks persisted as events.
- Bids during speaking are queued and only arbitrated after turn end.
- Replay from events reconstructs the same state.
- Vitest and fast-check tests cover no-speaker-during-speaking and rebuttal-bonus-cap invariants.
```


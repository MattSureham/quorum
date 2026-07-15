// @quorum/protocol — shared, zero-runtime types for the room/event model.

export type ParticipantKind = "human" | "agent" | "system";

export type EventType =
  | "message"        // a chat utterance (final text)
  | "thinking"       // agent reasoning stream (optional to show)
  | "tool_call"      // one tool invocation (name + args)
  | "tool_result"    // tool result (stdout / exit code / file diff ref...)
  | "floor_request"  // "raise hand": I want to speak / rebut
  | "floor_grant"    // Conductor grants the speaking floor
  | "floor_release"  // turn ended, floor returned
  | "interrupt"      // preemption (usually from the human)
  | "checkpoint"     // a workspace snapshot (git diff stat)
  | "phase_changed"  // shared-session phase transition
  | "bid_submitted"  // structured bid persisted for replay/debug
  | "bid_settled"    // bid withdrawn/downgraded/confirmed during settling
  | "speaker_selected"
  | "turn_started"
  | "turn_output_chunk"
  | "turn_completed"
  | "turn_cancelled"
  | "turn_failed"
  | "turn_trace"
  | "system";        // system / error / status change

export interface EventAuthor {
  kind: ParticipantKind;
  id: string;
  display: string;
}

export interface RoomEvent {
  id: string;
  roomId: string;
  seq: number;              // monotonic within a room — the global order
  ts: number;               // epoch ms
  author: EventAuthor;
  type: EventType;
  body: unknown;            // shape depends on `type` (see *Body below)
  replyTo?: string;         // threading / "rebuts" (points at an event id)
  addressedTo?: string[];   // @'d participant ids (empty = everyone)
  turnId?: string;          // which turn this belongs to
  visibility: "room" | "private" | "participant" | "debug" | "system";
}

// ---- body shapes (discriminated by RoomEvent.type) ----
export interface ImageAttachment {
  id: string;
  name: string;
  mimeType: string;
  dataUrl: string;
  sizeBytes?: number;
}
export interface MessageBody { text: string; attachments?: ImageAttachment[] }
export interface ThinkingBody { text: string; partial?: boolean }
export interface ToolCallBody { tool: string; name?: string; args: unknown; callId: string }
export interface ToolResultBody { callId: string; ok: boolean; stdout?: string; exitCode?: number; diffRef?: string }
export type FloorIntent = "reply" | "rebut" | "act";
export interface FloorRequestBody { reason: string; intent: FloorIntent; targets?: string[] }
export interface FloorGrantBody { participantId: string; turnId: string; reason?: string; deadlineMs?: number }
export interface FloorReleaseBody { turnId: string; reason: "done" | "interrupted" | "timeout" | "error" }
export interface InterruptBody { by: string; hard: boolean; note?: string }
export interface DiffStat { files: number; insertions: number; deletions: number }
export interface CheckpointBody { preHead: string; postHead: string; stat: DiffStat; summary?: string }
export type ApprovalState = "requested" | "granted" | "denied" | "expired";
export interface ApprovalSignal { callId: string; tool: string; args?: unknown; state: ApprovalState }
export interface SystemBody { level: "info" | "warn" | "error"; text: string; approval?: ApprovalSignal }

// ---- participants / rooms ----
export interface Capabilities {
  canEditFiles: boolean;
  canRunCommands: boolean;
  supportsToolApproval: boolean;   // can the human approve tools per-call mid-turn?
  nativeTools: string[];           // display only
}

export type ParticipantStatus = "idle" | "thinking" | "active" | "offline";

export interface ParticipantDescriptor {
  id: string;                              // unique within room: "codex" / "claude" / "matt"
  kind: ParticipantKind;
  display: string;
  adapter?: string;                        // agents only: "claude-code" | "codex" | "api-model" | "echo"
  adapterConfig?: Record<string, unknown>; // model name, sandbox, etc.
  persona?: string;                        // role/responsibilities injected into the agent
  status: ParticipantStatus;
}

export type ConductorPolicyName = "free-for-all" | "directed" | "moderated";

export interface ConductorPolicyConfig {
  name: ConductorPolicyName;
  maxTurnsPerTopic: number;   // hard safety ceiling for agent turns after a human message
  noConsecutive: boolean;     // same agent cannot speak twice in a row
  turnDeadlineMs: number;     // per-turn timeout
  moderatorModel?: string;    // moderated only
}

export interface Room {
  id: string;
  title: string;
  workspacePath?: string;
  branch: string;
  policy: ConductorPolicyConfig;
  schedulerMode?: "bid" | "raise-hand" | "round-robin";
  targetDiscussionRounds?: number; // advisory rounds before a final wrap-up pass
  lifecycle?: "draft" | "active" | "paused" | "completed" | "archived" | "deleted";
  primary?: string;           // who answers an opening message with no @
  participants: ParticipantDescriptor[];
  createdAt: number;
}

export type SessionMode = "open-discussion" | "raise-hand" | "round-robin";

export interface CreateSessionInput {
  id: string;
  title: string;
  mode: SessionMode;
  targetDiscussionRounds?: number;
  workspacePath?: string;
  participants: ParticipantDescriptor[];
}

export interface ContinueSessionInput {
  id: string;
}

export interface Turn {
  id: string;
  roomId: string;
  participantId: string;
  startedAt: number;
  endedAt?: number;
  fromSeq: number;
  outcome?: "done" | "interrupted" | "timeout" | "error";
}

// ---- shared-session kernel (new architecture) ----
export type SessionPhase =
  | "idle"
  | "collecting_bids"
  | "arbitrating"
  | "speaker_granted"
  | "speaking"
  | "settling"
  | "paused"
  | "ended";

export type SessionEventVisibility = "participant" | "debug" | "system";

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
  visibility: SessionEventVisibility;
  payload: TPayload;
}

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
  rationale?: string;
}

export interface BidContext {
  sessionId: string;
  epoch: number;
  prompt: string;
  phase: SessionPhase;
  participants: ParticipantDescriptor[];
  transcript: RoomEvent[];
  lastTurnId?: string;
}

export interface TurnContext {
  sessionId: string;
  turnId: string;
  generation: number;
  epoch: number;
  speakerId: string;
  prompt: string;
  contextSeq: number;
  participants: ParticipantDescriptor[];
  transcript: RoomEvent[];
  contextBundle?: string;
  attachments?: ImageAttachment[];
}

export type AgentDelta =
  | { type: "text"; text: string }
  | { type: "thinking"; text: string }
  | { type: "tool_call"; tool: string; args: unknown; callId?: string }
  | { type: "tool_result"; callId: string; ok: boolean; stdout?: string; exitCode?: number }
  | { type: "error"; message: string; category?: string; detail?: string }
  | { type: "done" };

export interface AgentHealth {
  ok: boolean;
  status?: ParticipantStatus;
  detail?: string;
}

export interface ToolCallRequest {
  tool: string;
  args: unknown;
  callId?: string;
  riskLevel?: "low" | "medium" | "high";
}

export interface ToolCallResult {
  callId: string;
  ok: boolean;
  stdout?: string;
  stderr?: string;
  exitCode?: number;
}

export interface ContextSnapshot {
  seq: number;
  events: RoomEvent[];
}

export interface SharedMemoryCommand {
  namespace: string;
  key: string;
  value: unknown;
  expectedVersion?: number;
}

export interface WriteResult {
  ok: boolean;
  version?: number;
  error?: string;
}

export interface AgentRuntime {
  callTool(req: ToolCallRequest): Promise<ToolCallResult>;
  readContext(seq: number): Promise<ContextSnapshot>;
  writeSharedMemory(cmd: SharedMemoryCommand): Promise<WriteResult>;
}

export interface ISpeakerAgent {
  readonly id: string;
  readonly descriptor: ParticipantDescriptor;
  health(): Promise<AgentHealth>;
  capabilities?(): Capabilities;
  shutdown(): Promise<void>;
  bid(ctx: BidContext): Promise<Bid>;
  speak(turn: TurnContext, runtime: AgentRuntime, signal: AbortSignal): AsyncGenerator<AgentDelta>;
  observe?(event: RoomEvent): Promise<void>;
}

export interface ChatRequest {
  messages: Array<{ role: "system" | "user" | "assistant" | "tool"; content: string }>;
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface ChatDelta {
  type: "text" | "thinking" | "done";
  text?: string;
}

export interface ChatResponse {
  content: string;
  model?: string;
  usage?: Record<string, number>;
}

export interface LLMAdapter {
  chat(req: ChatRequest, signal?: AbortSignal): Promise<ChatResponse>;
  chatStream(req: ChatRequest, signal?: AbortSignal): AsyncGenerator<ChatDelta>;
}

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

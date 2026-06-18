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
  visibility: "room" | "private";
}

// ---- body shapes (discriminated by RoomEvent.type) ----
export interface MessageBody { text: string }
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
export interface SystemBody { level: "info" | "warn" | "error"; text: string }

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
  maxTurnsPerTopic: number;   // agent turns since last human msg before yielding to human
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
  primary?: string;           // who answers an opening message with no @
  participants: ParticipantDescriptor[];
  createdAt: number;
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

import type {
  RoomEvent, EventType, EventAuthor, ParticipantDescriptor,
  Capabilities, ConductorPolicyConfig, DiffStat,
} from "@quorum/protocol";

// Persistence seam. The engine assigns seq itself (single-writer); the store
// just persists already-sequenced events and answers reads.
export interface EventStore {
  persist(e: RoomEvent): void;
  read(roomId: string, sinceSeq?: number): RoomEvent[];
  maxSeq(roomId: string): number;
}

// What callers hand to EventLog.append (seq/id/ts filled in by the log).
export interface AppendInput {
  author: EventAuthor;
  type: EventType;
  body: unknown;
  id?: string;
  ts?: number;
  replyTo?: string;
  addressedTo?: string[];
  turnId?: string;
  visibility?: "room" | "private";
}

// What an agent yields during its turn. The Conductor stamps author/seq/id/ts/turnId
// (author is stamped to the current floor holder — anti-spoofing).
export interface PartialRoomEvent {
  type: EventType;
  body: unknown;
  replyTo?: string;
  addressedTo?: string[];
  visibility?: "room" | "private";
}

export interface TurnInput {
  turnId: string;
  roomTitle: string;
  self: ParticipantDescriptor;
  participants: ParticipantDescriptor[];
  projection: RoomEvent[];   // events since this participant last spoke
  protocol: string;          // room speaking-protocol text
  workspacePath?: string;
  signal: AbortSignal;       // aborts on interrupt / deadline
  readRoom?: (sinceSeq: number) => RoomEvent[]; // backs the `read_room` room tool
  /** Interactive permission gate: ask the human to approve a tool call. Resolves allow/deny. */
  requestToolApproval?: (req: { callId: string; tool: string; input: unknown }) => Promise<boolean>;
}

// Humans and agents implement the SAME contract — this is where "the human is a
// first-class participant" lands in code.
export interface Participant {
  readonly id: string;
  readonly descriptor: ParticipantDescriptor;
  capabilities(): Capabilities;
  takeTurn(input: TurnInput): AsyncIterable<PartialRoomEvent>;
  interrupt(reason: string): Promise<void>;
  dispose?(): Promise<void>;
}

export interface ConductorContext {
  recent: RoomEvent[];
  participants: ParticipantDescriptor[];
  pendingFloorRequests: RoomEvent[];
  lastSpeakerId?: string;
  turnsInCurrentTopic: number;
  primary?: string;
  config: ConductorPolicyConfig;
}

export type FloorDecision =
  | { kind: "grant"; participantId: string; reason: string }
  | { kind: "wait"; reason: string }
  | { kind: "ask-moderator"; reason: string };

export interface ConductorPolicy {
  readonly name: ConductorPolicyConfig["name"];
  decide(ctx: ConductorContext): Promise<FloorDecision>;
}

export interface WriteLease { release(): void }

export interface CheckpointResult {
  preHead: string;
  postHead: string;
  stat: DiffStat;
  summary?: string;
}

export interface WorkspaceManager {
  acquireWriteFloor(turnId: string, who: string): Promise<WriteLease>;
  snapshotPre(): Promise<string>;
  checkpoint(turnId: string, who: string, eventId: string): Promise<CheckpointResult | null>;
  rollbackTo(head: string): Promise<void>;
  watchOutOfBand?(onCheckpoint: (checkpoint: CheckpointResult) => void): () => void;
}

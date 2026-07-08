// Optional zod schemas for validating data at the network boundary (gateway).
// Imported only by the daemon's gateway — NOT by the core engine, so the engine
// stays dependency-free. Requires `zod` (install before use).
import { z } from "zod";

export const SessionPhaseSchema = z.enum([
  "idle",
  "collecting_bids",
  "arbitrating",
  "speaker_granted",
  "speaking",
  "settling",
  "paused",
  "ended",
]);

export const BidSchema = z.object({
  bidId: z.string(),
  agentId: z.string(),
  epoch: z.number().int(),
  kind: z.enum(["answer", "rebuttal", "followup", "clarification"]),
  replyToTurnId: z.string().optional(),
  confidence: z.number(),
  createdAtSeq: z.number().int(),
  expiresAfterRound: z.number().int(),
  revision: z.number().int(),
  rationale: z.string().optional(),
});

export const SessionCommandSchema = z.object({
  commandId: z.string(),
  idempotencyKey: z.string(),
  sessionId: z.string(),
  actorId: z.string(),
  type: z.string(),
  expectedVersion: z.number().int().optional(),
  submittedAt: z.string(),
  payload: z.unknown(),
});

export const SessionEventSchema = z.object({
  schemaVersion: z.number().int(),
  eventId: z.string(),
  sessionId: z.string(),
  seq: z.number().int(),
  type: z.string(),
  actorId: z.string(),
  correlationId: z.string(),
  causationId: z.string().optional(),
  occurredAt: z.string(),
  visibility: z.enum(["participant", "debug", "system"]),
  payload: z.unknown(),
});

export const ClientMessageSchema = z.discriminatedUnion("t", [
  z.object({ t: z.literal("subscribe"), roomId: z.string(), sinceSeq: z.number().optional() }),
  z.object({ t: z.literal("post_message"), roomId: z.string(), text: z.string(), addressedTo: z.array(z.string()).optional() }),
  z.object({ t: z.literal("interrupt"), roomId: z.string(), hard: z.boolean().optional() }),
  z.object({ t: z.literal("set_policy"), roomId: z.string(), policy: z.object({
    name: z.enum(["free-for-all", "directed", "moderated"]),
    maxTurnsPerTopic: z.number(),
    noConsecutive: z.boolean(),
    turnDeadlineMs: z.number(),
    moderatorModel: z.string().optional(),
  }) }),
  z.object({ t: z.literal("approve_tool"), roomId: z.string(), callId: z.string(), allow: z.boolean() }),
  z.object({ t: z.literal("replay_projection"), roomId: z.string(), afterSeq: z.number().int().min(0).optional() }),
  z.object({ t: z.literal("compact_memory"), roomId: z.string(), fromSeq: z.number().int().min(0).optional(), toSeq: z.number().int().min(0).optional() }),
  z.object({ t: z.literal("take_write_floor"), roomId: z.string() }),
  z.object({ t: z.literal("rollback"), roomId: z.string(), toHead: z.string() }),
]);

export type ClientMessage = z.infer<typeof ClientMessageSchema>;

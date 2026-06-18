// Optional zod schemas for validating data at the network boundary (gateway).
// Imported only by the daemon's gateway — NOT by the core engine, so the engine
// stays dependency-free. Requires `zod` (install before use).
import { z } from "zod";

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
  z.object({ t: z.literal("take_write_floor"), roomId: z.string() }),
  z.object({ t: z.literal("rollback"), roomId: z.string(), toHead: z.string() }),
]);

export type ClientMessage = z.infer<typeof ClientMessageSchema>;

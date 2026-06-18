import type { FloorRequestBody, FloorIntent, RoomEvent } from "@quorum/protocol";
import type { ConductorPolicy, ConductorContext, FloorDecision } from "../types.js";

function rank(e: RoomEvent): number {
  const i = (e.body as FloorRequestBody).intent as FloorIntent | undefined;
  return i === "rebut" || i === "act" ? 2 : i === "reply" ? 1 : 0;
}

/**
 * Default policy. Order is emergent, not round-robin:
 *  1) honor raised hands (rebut/act first), skipping whoever just spoke;
 *  2) honor an explicit @ to an agent who hasn't just spoken;
 *  3) opening/broadcast: let `primary` open, then circulate to each agent once
 *     (everyone weighs in), then yield to the human;
 * Bounded by maxTurnsPerTopic; a human message resets the topic.
 */
export const freeForAll: ConductorPolicy = {
  name: "free-for-all",
  async decide(ctx: ConductorContext): Promise<FloorDecision> {
    if (ctx.turnsInCurrentTopic >= ctx.config.maxTurnsPerTopic) {
      return { kind: "wait", reason: "topic budget reached; yielding to human" };
    }

    const agentList = ctx.participants.filter((p) => p.kind === "agent").map((p) => p.id);
    const agents = new Set(agentList);

    // 1) raised hands first (rebut/act > reply), skip the just-spoken agent
    const hands = ctx.pendingFloorRequests
      .filter((r) => agents.has(r.author.id))
      .filter((r) => !(ctx.config.noConsecutive && r.author.id === ctx.lastSpeakerId))
      .sort((a, b) => rank(b) - rank(a));
    if (hands.length) {
      return { kind: "grant", participantId: hands[0]!.author.id, reason: "raised hand" };
    }

    const last = [...ctx.recent].reverse().find((e) => e.type === "message");
    if (!last) return { kind: "wait", reason: "nothing to respond to" };

    // topic = everything since the last human message
    const lastHuman = [...ctx.recent].reverse().find((e) => e.type === "message" && e.author.kind === "human");
    const topicStart = lastHuman?.seq ?? 0;
    const spoke = new Set(
      ctx.recent
        .filter((e) => e.type === "message" && e.author.kind === "agent" && e.seq > topicStart)
        .map((e) => e.author.id),
    );
    const nextUnspoken = agentList.find((id) => !spoke.has(id) && id !== ctx.lastSpeakerId);

    // 2) explicit @ to an agent who hasn't just spoken
    const targets = (last.addressedTo ?? []).filter((id) => agents.has(id) && id !== ctx.lastSpeakerId);
    if (targets[0]) {
      return {
        kind: "grant",
        participantId: targets[0],
        reason: last.author.kind === "human" ? "addressed by human" : "addressed by agent",
      };
    }

    // 3) opening / broadcast circulation
    if (last.author.kind === "human") {
      const open =
        ctx.primary && agents.has(ctx.primary) && !spoke.has(ctx.primary) ? ctx.primary : nextUnspoken;
      if (open) return { kind: "grant", participantId: open, reason: "open floor" };
    } else if (nextUnspoken) {
      return { kind: "grant", participantId: nextUnspoken, reason: "weigh-in" };
    }
    return { kind: "wait", reason: "everyone has weighed in; yielding to human" };
  },
};

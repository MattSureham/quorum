import type { ConductorPolicy, ConductorContext, FloorDecision } from "../types.js";

/** Only agents explicitly @'d in the latest message respond, in order. */
export const directed: ConductorPolicy = {
  name: "directed",
  async decide(ctx: ConductorContext): Promise<FloorDecision> {
    if (ctx.turnsInCurrentTopic >= ctx.config.maxTurnsPerTopic) {
      return { kind: "wait", reason: "topic budget reached" };
    }
    const agents = new Set(ctx.participants.filter((p) => p.kind === "agent").map((p) => p.id));
    const last = [...ctx.recent].reverse().find((e) => e.type === "message");
    const targets = (last?.addressedTo ?? []).filter((id) => agents.has(id));
    // grant the first addressed agent that hasn't spoken since `last`
    const lastSeq = last?.seq ?? 0;
    const spokeSince = new Set(
      ctx.recent.filter((e) => e.type === "message" && e.seq > lastSeq).map((e) => e.author.id),
    );
    const next = targets.find((id) => !spokeSince.has(id));
    return next
      ? { kind: "grant", participantId: next, reason: "directed @" }
      : { kind: "wait", reason: "no addressed agent pending" };
  },
};

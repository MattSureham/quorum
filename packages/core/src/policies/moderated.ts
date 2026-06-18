import type { ConductorPolicy, ConductorContext, FloorDecision } from "../types.js";

export interface Moderator {
  // Return the id of who should speak next, or "human" to yield.
  (ctx: ConductorContext): Promise<{ next: string | "human"; reason: string }>;
}

/**
 * A moderator function (typically a cheap model wired in the daemon) decides the
 * next speaker. Kept dependency-free here by injecting the moderator.
 */
export function makeModerated(moderator: Moderator): ConductorPolicy {
  return {
    name: "moderated",
    async decide(ctx: ConductorContext): Promise<FloorDecision> {
      if (ctx.turnsInCurrentTopic >= ctx.config.maxTurnsPerTopic) {
        return { kind: "wait", reason: "topic budget reached" };
      }
      const agents = new Set(ctx.participants.filter((p) => p.kind === "agent").map((p) => p.id));
      const { next, reason } = await moderator(ctx);
      if (next === "human" || !agents.has(next)) return { kind: "wait", reason };
      return { kind: "grant", participantId: next, reason };
    },
  };
}

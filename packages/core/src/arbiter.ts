import type { Bid, BidKind, ParticipantDescriptor } from "@quorum/protocol";

export interface ArbitrationContext {
  participants: ParticipantDescriptor[];
  bids: Bid[];
  userMentioned?: string[];
  lastSpeakerId?: string;
  recentSpeakerCounts?: Map<string, number>;
  waitingRounds?: Map<string, number>;
  noConsecutive?: boolean;
}

export interface ScoredBid {
  bid: Bid;
  score: number;
  components: {
    base: number;
    capability: number;
    userMention: number;
    waiting: number;
    recentSpeakerPenalty: number;
    rebuttalBonus: number;
    confidenceTieBreaker: number;
  };
}

export interface ArbitrationDecision {
  winner?: ScoredBid;
  candidates: ScoredBid[];
  policyVersion: string;
}

const kindBase: Record<BidKind, number> = {
  answer: 1,
  clarification: 0.9,
  followup: 0.8,
  rebuttal: 0.85,
};

export class Arbiter {
  readonly policyVersion = "structured-v1";

  decide(ctx: ArbitrationContext): ArbitrationDecision {
    const participantIds = new Set(ctx.participants.map((p) => p.id));
    const eligibleBids = ctx.bids.filter((bid) => participantIds.has(bid.agentId));
    const hasAlternativeSpeaker = eligibleBids.some((bid) => bid.agentId !== ctx.lastSpeakerId);
    const candidates = ctx.bids
      .filter((bid) => participantIds.has(bid.agentId)
        && !(ctx.noConsecutive && hasAlternativeSpeaker && bid.agentId === ctx.lastSpeakerId))
      .map((bid) => this.scoreBid(bid, ctx))
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        const waitingA = ctx.waitingRounds?.get(a.bid.agentId) ?? 0;
        const waitingB = ctx.waitingRounds?.get(b.bid.agentId) ?? 0;
        if (waitingB !== waitingA) return waitingB - waitingA;
        return a.bid.agentId.localeCompare(b.bid.agentId);
      });

    return { winner: candidates[0], candidates, policyVersion: this.policyVersion };
  }

  private scoreBid(bid: Bid, ctx: ArbitrationContext): ScoredBid {
    const base = kindBase[bid.kind];
    const capability = 0;
    const userMention = ctx.userMentioned?.includes(bid.agentId) ? 100 : 0;
    const waiting = (ctx.waitingRounds?.get(bid.agentId) ?? 0) * 0.1;
    const recentSpeakerPenalty = -(ctx.recentSpeakerCounts?.get(bid.agentId) ?? 0) * 0.2;
    const rebuttalBonus = bid.kind === "rebuttal" ? Math.min(base * 0.2, 0.17) : 0;
    const confidenceTieBreaker = Math.max(0, Math.min(1, bid.confidence)) * 0.001;

    return {
      bid,
      score: base + capability + userMention + waiting + recentSpeakerPenalty + rebuttalBonus + confidenceTieBreaker,
      components: {
        base,
        capability,
        userMention,
        waiting,
        recentSpeakerPenalty,
        rebuttalBonus,
        confidenceTieBreaker,
      },
    };
  }
}

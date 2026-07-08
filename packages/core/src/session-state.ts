import type { Bid, RoomEvent, SessionPhase } from "@quorum/protocol";

const legalTransitions: Record<SessionPhase, SessionPhase[]> = {
  idle: ["collecting_bids", "paused", "ended"],
  collecting_bids: ["arbitrating", "idle", "paused", "ended"],
  arbitrating: ["speaker_granted", "idle", "paused", "ended"],
  speaker_granted: ["speaking", "idle", "paused", "ended"],
  speaking: ["settling", "paused", "ended"],
  settling: ["arbitrating", "idle", "collecting_bids", "paused", "ended"],
  paused: ["idle", "ended"],
  ended: [],
};

export function canTransition(from: SessionPhase, to: SessionPhase): boolean {
  return from === to || legalTransitions[from].includes(to);
}

export function assertTransition(from: SessionPhase, to: SessionPhase): void {
  if (!canTransition(from, to)) {
    throw new Error(`illegal session phase transition: ${from} -> ${to}`);
  }
}

export interface ProjectedSessionState {
  phase: SessionPhase;
  epoch: number;
  activeTurn?: { turnId: string; speakerId: string; generation: number };
  pendingBids: Bid[];
  selected?: { agentId?: string; score?: number; kind?: string };
  lastTurnId?: string;
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function projectSessionState(events: Iterable<RoomEvent>): ProjectedSessionState {
  const pending = new Map<string, Bid>();
  let phase: SessionPhase = "idle";
  let epoch = 0;
  let activeTurn: ProjectedSessionState["activeTurn"];
  let selected: ProjectedSessionState["selected"];
  let lastTurnId: string | undefined;

  for (const event of events) {
    const body = asObject(event.body);
    if (event.type === "phase_changed") {
      const to = asString(body.to) as SessionPhase | undefined;
      if (to) phase = to;
      epoch = asNumber(body.epoch) ?? epoch;
    } else if (event.type === "bid_submitted") {
      const bid = body.bid as Bid | undefined;
      if (bid) pending.set(bid.bidId, bid);
    } else if (event.type === "bid_settled") {
      if (body.action === "withdrawn") {
        const bidId = asString(body.bidId);
        if (bidId) pending.delete(bidId);
      }
    } else if (event.type === "speaker_selected") {
      const winner = asObject(body.winner);
      const bid = winner.bid as Bid | undefined;
      if (bid) {
        pending.delete(bid.bidId);
        selected = { agentId: bid.agentId, score: asNumber(winner.score), kind: bid.kind };
      } else {
        selected = undefined;
      }
    } else if (event.type === "turn_started") {
      const turnId = asString(body.turnId);
      const speakerId = asString(body.speakerId);
      const generation = asNumber(body.generation);
      if (turnId && speakerId && generation !== undefined) activeTurn = { turnId, speakerId, generation };
    } else if (event.type === "turn_completed" || event.type === "turn_cancelled" || event.type === "turn_failed") {
      const turnId = asString(body.turnId);
      if (turnId && activeTurn?.turnId === turnId) activeTurn = undefined;
      lastTurnId = turnId ?? lastTurnId;
    }
  }

  return { phase, epoch, activeTurn, pendingBids: [...pending.values()], selected, lastTurnId };
}

import type { SessionPhase } from "@quorum/protocol";

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

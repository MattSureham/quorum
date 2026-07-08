import { describe, expect, it } from "vitest";
import type {
  AgentDelta,
  AgentHealth,
  AgentRuntime,
  Bid,
  BidContext,
  ISpeakerAgent,
  ParticipantDescriptor,
  RoomEvent,
  TurnContext,
} from "@quorum/protocol";
import { EventLog } from "./event-log.js";
import { InMemoryStore } from "./in-memory-store.js";
import { SessionManager } from "./session-manager.js";
import { Arbiter } from "./arbiter.js";
import { ulid } from "./ids.js";
import { projectSessionState } from "./session-state.js";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(predicate: () => boolean, timeoutMs = 1_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await sleep(10);
  }
  throw new Error("timed out waiting for condition");
}

class StubSpeaker implements ISpeakerAgent {
  readonly descriptor: ParticipantDescriptor;
  private turn = 0;

  constructor(
    readonly id: string,
    private readonly opts: {
      confidence?: number;
      kind?: Bid["kind"];
      delayMs?: number;
      text?: string;
      replyToTurnId?: (ctx: BidContext) => string | undefined;
    } = {},
  ) {
    this.descriptor = { id, kind: "agent", display: id, adapter: "stub", status: "idle" };
  }

  async health(): Promise<AgentHealth> {
    return { ok: true };
  }

  async shutdown(): Promise<void> {}

  async bid(ctx: BidContext): Promise<Bid> {
    return {
      bidId: ulid(),
      agentId: this.id,
      epoch: ctx.epoch,
      kind: this.opts.kind ?? "answer",
      confidence: this.opts.confidence ?? 0.5,
      createdAtSeq: ctx.transcript.at(-1)?.seq ?? 0,
      expiresAfterRound: ctx.epoch + 1,
      revision: 0,
      replyToTurnId: this.opts.replyToTurnId?.(ctx),
    };
  }

  async *speak(_turn: TurnContext, _runtime: AgentRuntime, signal: AbortSignal): AsyncGenerator<AgentDelta> {
    const turn = this.turn++;
    if (this.opts.delayMs) await sleep(this.opts.delayMs);
    if (signal.aborted) return;
    yield { type: "text", text: `${this.opts.text ?? this.id}-${turn}` };
    yield { type: "done" };
  }
}

describe("SessionManager", () => {
  it("queues bids during speaking and selects the next speaker only after turn completion", async () => {
    const log = new EventLog("room", new InMemoryStore());
    const events: RoomEvent[] = [];
    log.on((event) => events.push(event));

    const slow = new StubSpeaker("slow", { confidence: 1, delayMs: 120 });
    const rebutter = new StubSpeaker("rebutter", { confidence: 0, kind: "followup" });
    const session = new SessionManager({
      sessionId: "room",
      title: "Test",
      log,
      agents: [slow, rebutter],
      settlingWindowMs: 20,
      turnTimeoutMs: 1_000,
    });

    session.start();
    try {
      await session.submitUserPrompt("first");
      await waitFor(() => events.some((event) => event.type === "turn_started" && (event.body as any).speakerId === "slow"));

      await session.submitBid({
        bidId: ulid(),
        agentId: "rebutter",
        epoch: session.snapshot().epoch,
        kind: "rebuttal",
        confidence: 1,
        createdAtSeq: log.headSeq,
        expiresAfterRound: session.snapshot().epoch + 1,
        revision: 0,
        replyToTurnId: session.snapshot().activeTurn?.turnId,
      });

      await sleep(40);
      const selectedBeforeCompletion = events.filter((event) => event.type === "speaker_selected");
      expect(selectedBeforeCompletion).toHaveLength(1);

      await waitFor(() => events.some((event) => event.type === "turn_started" && (event.body as any).speakerId === "rebutter"), 1_500);
      const completedSlow = events.find((event) => event.type === "turn_completed" && (event.body as any).speakerId === "slow");
      const rebutterStart = events.find((event) => event.type === "turn_started" && (event.body as any).speakerId === "rebutter");
      expect(completedSlow?.seq).toBeLessThan(rebutterStart?.seq ?? 0);
    } finally {
      await session.stop();
    }
  });

  it("caps rebuttal bonus at 20 percent of base score", () => {
    const arbiter = new Arbiter();
    const decision = arbiter.decide({
      participants: [
        { id: "a", kind: "agent", display: "A", status: "idle" },
        { id: "b", kind: "agent", display: "B", status: "idle" },
      ],
      bids: [
        {
          bidId: "a",
          agentId: "a",
          epoch: 1,
          kind: "rebuttal",
          confidence: 1,
          createdAtSeq: 1,
          expiresAfterRound: 2,
          revision: 0,
          replyToTurnId: "turn-1",
        },
        {
          bidId: "b",
          agentId: "b",
          epoch: 1,
          kind: "answer",
          confidence: 1,
          createdAtSeq: 1,
          expiresAfterRound: 2,
          revision: 0,
        },
      ],
    });

    const rebuttal = decision.candidates.find((candidate) => candidate.bid.agentId === "a");
    expect(rebuttal?.components.rebuttalBonus).toBeLessThanOrEqual(rebuttal!.components.base * 0.2);
  });

  it("rebuilds the current projected state from replayed events", async () => {
    const log = new EventLog("room", new InMemoryStore());
    const agent = new StubSpeaker("agent", { confidence: 1, text: "answer" });
    const session = new SessionManager({
      sessionId: "room",
      title: "Replay test",
      log,
      agents: [agent],
      settlingWindowMs: 20,
      turnTimeoutMs: 1_000,
    });

    session.start();
    try {
      await session.submitUserPrompt("hello");
      await waitFor(() => log.replay(0).some((event) => event.type === "turn_completed"));
      await waitFor(() => session.snapshot().phase === "idle");

      const projected = projectSessionState(log.replay(0));
      const snapshot = session.snapshot();
      expect(projected.phase).toBe(snapshot.phase);
      expect(projected.epoch).toBe(snapshot.epoch);
      expect(projected.activeTurn).toEqual(snapshot.activeTurn);
      expect(projected.lastTurnId).toBe(snapshot.lastTurnId);
      expect(projected.pendingBids).toEqual(snapshot.pendingBids);
    } finally {
      await session.stop();
    }
  });
});

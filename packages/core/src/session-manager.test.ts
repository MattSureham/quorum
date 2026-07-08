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

class ToolSpeaker implements ISpeakerAgent {
  readonly descriptor: ParticipantDescriptor = { id: "tool-agent", kind: "agent", display: "tool-agent", adapter: "stub", status: "idle" };
  readonly id = "tool-agent";

  async health(): Promise<AgentHealth> {
    return { ok: true };
  }

  async shutdown(): Promise<void> {}

  async bid(ctx: BidContext): Promise<Bid> {
    return {
      bidId: ulid(),
      agentId: this.id,
      epoch: ctx.epoch,
      kind: "answer",
      confidence: 1,
      createdAtSeq: ctx.transcript.at(-1)?.seq ?? 0,
      expiresAfterRound: ctx.epoch + 1,
      revision: 0,
    };
  }

  async *speak(_turn: TurnContext, runtime: AgentRuntime): AsyncGenerator<AgentDelta> {
    const result = await runtime.callTool({ callId: "tool-call-1", tool: "read_room", args: { sinceSeq: 0 } });
    yield { type: "text", text: result.ok && result.stdout?.includes("use a tool") ? "room tool executed" : "tool failed" };
    yield { type: "done" };
  }
}

class ExternalToolSpeaker implements ISpeakerAgent {
  readonly descriptor: ParticipantDescriptor = { id: "external-tool-agent", kind: "agent", display: "external-tool-agent", adapter: "stub", status: "idle" };
  readonly id = "external-tool-agent";

  async health(): Promise<AgentHealth> {
    return { ok: true };
  }

  async shutdown(): Promise<void> {}

  async bid(ctx: BidContext): Promise<Bid> {
    return {
      bidId: ulid(),
      agentId: this.id,
      epoch: ctx.epoch,
      kind: "answer",
      confidence: 1,
      createdAtSeq: ctx.transcript.at(-1)?.seq ?? 0,
      expiresAfterRound: ctx.epoch + 1,
      revision: 0,
    };
  }

  async *speak(_turn: TurnContext, runtime: AgentRuntime): AsyncGenerator<AgentDelta> {
    const result = await runtime.callTool({ callId: "external-call-1", tool: "Bash", args: { command: "printf ok" } });
    yield { type: "text", text: result.ok ? `external:${result.stdout}` : "external failed" };
    yield { type: "done" };
  }
}

class InterruptibleSpeaker extends StubSpeaker {
  async *speak(_turn: TurnContext, _runtime: AgentRuntime, signal: AbortSignal): AsyncGenerator<AgentDelta> {
    await new Promise<void>((resolve) => {
      if (signal.aborted) {
        resolve();
        return;
      }
      signal.addEventListener("abort", () => resolve(), { once: true });
    });
    if (signal.aborted) return;
    yield { type: "text", text: "should not emit" };
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

  it("gates AgentRuntime room tools on approval and executes them", async () => {
    const log = new EventLog("room", new InMemoryStore());
    const events: RoomEvent[] = [];
    log.on((event) => events.push(event));
    const session = new SessionManager({
      sessionId: "room",
      title: "Tool test",
      log,
      agents: [new ToolSpeaker()],
      settlingWindowMs: 20,
      turnTimeoutMs: 1_000,
    });

    session.start();
    try {
      await session.submitUserPrompt("use a tool");
      await waitFor(() => events.some((event) => (event.body as any).approval?.callId === "tool-call-1" && (event.body as any).approval?.state === "requested"));

      session.approveTool("tool-call-1", true);
      await waitFor(() => events.some((event) => event.type === "message" && (event.body as any).text === "room tool executed"));

      expect(events.some((event) => (event.body as any).approval?.callId === "tool-call-1" && (event.body as any).approval?.state === "granted")).toBe(true);
      expect(events.some((event) => event.type === "tool_call" && (event.body as any).tool === "read_room")).toBe(true);
      expect(events.some((event) => event.type === "tool_result" && (event.body as any).callId === "tool-call-1" && (event.body as any).ok)).toBe(true);
    } finally {
      await session.stop();
    }
  });

  it("routes approved external tools to the configured executor", async () => {
    const log = new EventLog("room", new InMemoryStore());
    const events: RoomEvent[] = [];
    log.on((event) => events.push(event));
    const session = new SessionManager({
      sessionId: "room",
      title: "External tool test",
      log,
      agents: [new ExternalToolSpeaker()],
      settlingWindowMs: 20,
      turnTimeoutMs: 1_000,
      workspacePath: "/tmp/quorum-test-workspace",
      toolExecutor: {
        async execute(req, ctx) {
          expect(req.tool).toBe("Bash");
          expect(req.callId).toBe("external-call-1");
          expect(ctx.workspacePath).toBe("/tmp/quorum-test-workspace");
          return { callId: req.callId, ok: true, stdout: "ok", exitCode: 0 };
        },
      },
    });

    session.start();
    try {
      await session.submitUserPrompt("use an external tool");
      await waitFor(() => events.some((event) => (event.body as any).approval?.callId === "external-call-1" && (event.body as any).approval?.state === "requested"));

      session.approveTool("external-call-1", true);
      await waitFor(() => events.some((event) => event.type === "message" && (event.body as any).text === "external:ok"));

      expect(events.some((event) => event.type === "tool_result" && (event.body as any).callId === "external-call-1" && (event.body as any).ok)).toBe(true);
    } finally {
      await session.stop();
    }
  });

  it("interrupts the active shared-session turn", async () => {
    const log = new EventLog("room", new InMemoryStore());
    const events: RoomEvent[] = [];
    log.on((event) => events.push(event));
    const slow = new InterruptibleSpeaker("slow", { confidence: 1 });
    const session = new SessionManager({
      sessionId: "room",
      title: "Interrupt test",
      log,
      agents: [slow],
      settlingWindowMs: 20,
      turnTimeoutMs: 5_000,
    });

    session.start();
    try {
      await session.submitUserPrompt("please answer");
      await waitFor(() => events.some((event) => event.type === "turn_started"));

      await session.interrupt("human", true);
      await waitFor(() => events.some((event) => event.type === "turn_cancelled"));

      expect(events.some((event) => event.type === "interrupt" && (event.body as any).hard === true)).toBe(true);
      expect(session.snapshot().activeTurn).toBeUndefined();
    } finally {
      await session.stop();
    }
  });

  it("compacts replayed events into a persisted working-memory summary", async () => {
    const log = new EventLog("room", new InMemoryStore());
    const session = new SessionManager({
      sessionId: "room",
      title: "Memory test",
      log,
      agents: [new StubSpeaker("agent", { confidence: 1, text: "answer" })],
      settlingWindowMs: 20,
      turnTimeoutMs: 1_000,
    });

    session.start();
    try {
      await session.submitUserPrompt("remember this");
      await waitFor(() => log.replay(0).some((event) => event.type === "turn_completed"));
      await session.compactWorkingMemory(0);

      const summaries = log.readWorkingMemorySummaries();
      expect(summaries).toHaveLength(1);
      expect(summaries[0]?.content).toContain("remember this");
      expect(log.replay(0).some((event) => event.type === "system" && (event.body as any).memorySummary?.summaryId === summaries[0]?.summaryId)).toBe(true);
    } finally {
      await session.stop();
    }
  });

  it("auto-compacts working memory after a turn crosses configured thresholds", async () => {
    const log = new EventLog("room", new InMemoryStore());
    const session = new SessionManager({
      sessionId: "room",
      title: "Auto memory test",
      log,
      agents: [new StubSpeaker("agent", { confidence: 1, text: "auto answer" })],
      settlingWindowMs: 20,
      turnTimeoutMs: 1_000,
      memory: { minSeqGap: 2, minEvents: 1, keepRecentEvents: 1 },
    });

    session.start();
    try {
      await session.submitUserPrompt("auto compact this");
      await waitFor(() => log.readWorkingMemorySummaries().length === 1);
      const summary = log.readWorkingMemorySummaries()[0]!;
      expect(summary.content).toContain("auto compact this");
      expect(log.replay(0).some((event) => event.type === "system" && (event.body as any).auto === true)).toBe(true);
    } finally {
      await session.stop();
    }
  });
});

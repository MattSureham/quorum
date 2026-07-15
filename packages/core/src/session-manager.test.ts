import { describe, expect, it } from "vitest";
import type {
  AgentDelta,
  AgentHealth,
  AgentRuntime,
  Capabilities,
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
import type { WorkspaceManager, WriteLease, CheckpointResult } from "./types.js";

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
      canEditFiles?: boolean;
    } = {},
  ) {
    this.descriptor = { id, kind: "agent", display: id, adapter: "stub", status: "idle" };
  }

  async health(): Promise<AgentHealth> {
    return { ok: true };
  }

  capabilities(): Capabilities {
    return {
      canEditFiles: !!this.opts.canEditFiles,
      canRunCommands: !!this.opts.canEditFiles,
      supportsToolApproval: false,
      nativeTools: this.opts.canEditFiles ? ["edit"] : [],
    };
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

class ContextCaptureSpeaker extends StubSpeaker {
  capturedContextBundle = "";

  async *speak(turn: TurnContext, _runtime: AgentRuntime, signal: AbortSignal): AsyncGenerator<AgentDelta> {
    this.capturedContextBundle = turn.contextBundle ?? "";
    if (signal.aborted) return;
    yield { type: "text", text: "captured" };
    yield { type: "done" };
  }
}

class PromptCaptureSpeaker extends StubSpeaker {
  prompts: string[] = [];

  async *speak(turn: TurnContext, _runtime: AgentRuntime, signal: AbortSignal): AsyncGenerator<AgentDelta> {
    this.prompts.push(turn.prompt);
    if (signal.aborted) return;
    yield { type: "text", text: `${this.id}-${this.prompts.length}` };
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

class FailingSpeaker extends StubSpeaker {
  async *speak(): AsyncGenerator<AgentDelta> {
    yield { type: "error", message: "CLI exited with code 7", category: "cli_exit", detail: "bad flags" };
  }
}

class FakeWorkspace implements WorkspaceManager {
  acquired: string[] = [];
  released: string[] = [];
  checkpoints: string[] = [];

  async acquireWriteFloor(turnId: string, who: string): Promise<WriteLease> {
    this.acquired.push(`${turnId}:${who}`);
    return { release: () => this.released.push(`${turnId}:${who}`) };
  }

  async snapshotPre(): Promise<string> {
    return "pre";
  }

  async checkpoint(turnId: string, who: string, eventId: string): Promise<CheckpointResult> {
    this.checkpoints.push(`${turnId}:${who}:${eventId}`);
    return {
      preHead: "pre",
      postHead: "post",
      stat: { files: 1, insertions: 1, deletions: 0 },
      summary: "fake checkpoint",
    };
  }

  async rollbackTo(): Promise<void> {}
}

describe("SessionManager", () => {
  it("queues prompts submitted during a turn and runs them in FIFO order", async () => {
    const log = new EventLog("room", new InMemoryStore());
    const events: RoomEvent[] = [];
    log.on((event) => events.push(event));
    const session = new SessionManager({
      sessionId: "room",
      title: "Prompt queue",
      log,
      agents: [new StubSpeaker("agent", { confidence: 1, delayMs: 80 })],
      settlingWindowMs: 10,
      turnTimeoutMs: 1_000,
    });

    session.start();
    try {
      void session.submitUserPrompt("first");
      await waitFor(() => events.some((event) => event.type === "turn_started"));
      await session.submitUserPrompt("second");
      await session.submitUserPrompt("third");
      await waitFor(() => events.filter((event) => event.type === "turn_completed").length === 3, 2_000);

      const humanPrompts = events
        .filter((event) => event.type === "message" && event.author.kind === "human")
        .map((event) => (event.body as any).text);
      expect(humanPrompts).toEqual(["first", "second", "third"]);
      expect(events.filter((event) => event.type === "phase_changed" && (event.body as any).to === "collecting_bids")).toHaveLength(3);
    } finally {
      await session.stop();
    }
  });

  it("restores an unprocessed queued prompt after restart", async () => {
    const store = new InMemoryStore();
    const firstLog = new EventLog("room", store);
    const first = new SessionManager({
      sessionId: "room",
      title: "Before restart",
      log: firstLog,
      agents: [new InterruptibleSpeaker("agent", { confidence: 1 })],
      settlingWindowMs: 10,
      turnTimeoutMs: 1_000,
    });
    first.start();
    void first.submitUserPrompt("active");
    await waitFor(() => firstLog.replay(0).some((event) => event.type === "turn_started"));
    await first.submitUserPrompt("survive restart");
    await waitFor(() => firstLog.replay(0).some((event) => event.type === "system" && (event.body as any).promptSeq));
    await first.stop();

    const secondLog = new EventLog("room", store);
    const second = new SessionManager({
      sessionId: "room",
      title: "After restart",
      log: secondLog,
      agents: [new StubSpeaker("agent", { confidence: 1, text: "restored" })],
      maxTurnsPerTopic: 1,
      settlingWindowMs: 10,
    });
    second.start();
    try {
      await waitFor(() => secondLog.replay(0).some((event) => event.type === "message" && event.author.id === "agent" && (event.body as any).text.startsWith("restored")), 1_500);
      const latestHuman = secondLog.replay(0).filter((event) => event.type === "message" && event.author.kind === "human").at(-1);
      expect((latestHuman?.body as any).text).toBe("survive restart");
    } finally {
      await second.stop();
    }
  });

  it("closes an orphaned agent turn and normalizes the phase after restart", async () => {
    const store = new InMemoryStore();
    const before = new EventLog("room", store);
    const author = { kind: "system" as const, id: "session", display: "SessionManager" };
    await before.append({ author, type: "phase_changed", body: { from: "idle", to: "collecting_bids", epoch: 1 } });
    await before.append({ author, type: "phase_changed", body: { from: "collecting_bids", to: "arbitrating", epoch: 1 } });
    await before.append({ author, type: "phase_changed", body: { from: "arbitrating", to: "speaker_granted", turnId: "turn-1", speakerId: "agent" } });
    await before.append({ author, type: "phase_changed", body: { from: "speaker_granted", to: "speaking", turnId: "turn-1", speakerId: "agent" } });
    await before.append({ author, type: "turn_started", body: { turnId: "turn-1", speakerId: "agent", generation: 7 }, turnId: "turn-1" });

    const after = new EventLog("room", store);
    const restarted = new SessionManager({
      sessionId: "room",
      title: "Restart recovery",
      log: after,
      agents: [new StubSpeaker("agent")],
    });
    restarted.start();
    try {
      await waitFor(() => after.replay(0).some((event) => event.type === "phase_changed" && (event.body as any).recovered));

      const events = after.replay(0);
      const failure = events.find((event) => event.type === "turn_failed");
      expect((failure?.body as any).failure).toMatchObject({ category: "daemon_restart" });
      expect(events.some((event) => event.type === "floor_release" && (event.body as any).reason === "daemon_restart")).toBe(true);
      expect(projectSessionState(events)).toMatchObject({ phase: "idle", activeTurn: undefined, lastTurnId: "turn-1" });
      expect(restarted.snapshot()).toMatchObject({ phase: "idle", activeTurn: undefined, lastTurnId: "turn-1" });
    } finally {
      await restarted.stop();
    }
  });

  it("records structured adapter failures as failed turns", async () => {
    const log = new EventLog("room", new InMemoryStore());
    const session = new SessionManager({
      sessionId: "room",
      title: "Failure",
      log,
      agents: [new FailingSpeaker("agent")],
      settlingWindowMs: 10,
      turnTimeoutMs: 1_000,
    });
    session.start();
    try {
      await session.submitUserPrompt("fail");
      await waitFor(() => log.replay(0).some((event) => event.type === "turn_failed"));
      const failed = log.replay(0).find((event) => event.type === "turn_failed");
      expect((failed?.body as any).failure).toMatchObject({ category: "cli_exit", message: "CLI exited with code 7" });
      expect(log.replay(0).some((event) => event.type === "turn_completed")).toBe(false);
    } finally {
      await session.stop();
    }
  });

  it("records execution deadlines as failed turns and stops after all candidates fail", async () => {
    const log = new EventLog("room", new InMemoryStore());
    const session = new SessionManager({
      sessionId: "room",
      title: "Timeout",
      log,
      agents: [new InterruptibleSpeaker("slow", { confidence: 1 })],
      settlingWindowMs: 10,
      turnTimeoutMs: 30,
    });
    session.start();
    try {
      await session.submitUserPrompt("answer eventually");
      await waitFor(() => session.snapshot().phase === "idle" && log.replay(0).some((event) => event.type === "turn_failed"));

      const failed = log.replay(0).find((event) => event.type === "turn_failed");
      expect((failed?.body as any).failure).toMatchObject({ category: "timeout" });
      expect((failed?.body as any).failure.message).toContain("timed out after 30ms");
      expect(log.replay(0).filter((event) => event.type === "phase_changed" && (event.body as any).to === "collecting_bids")).toHaveLength(1);
      expect(log.replay(0).some((event) => event.type === "turn_cancelled")).toBe(false);
    } finally {
      await session.stop();
    }
  });

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

  it("runs round-robin sessions in fixed agent order without collecting bids", async () => {
    const log = new EventLog("room", new InMemoryStore());
    const events: RoomEvent[] = [];
    log.on((event) => events.push(event));

    const alpha = new StubSpeaker("alpha", { confidence: 0.1, text: "alpha" });
    const bravo = new StubSpeaker("bravo", { confidence: 1, text: "bravo" });
    const charlie = new StubSpeaker("charlie", { confidence: 0.5, text: "charlie" });
    const session = new SessionManager({
      sessionId: "room",
      title: "Round robin test",
      log,
      agents: [alpha, bravo, charlie],
      schedulerMode: "round-robin",
      settlingWindowMs: 20,
      turnTimeoutMs: 1_000,
    });

    session.start();
    try {
      await session.submitUserPrompt("state your positions");
      await waitFor(() => events.filter((event) => event.type === "turn_completed").length === 3, 2_000);
      await waitFor(() => session.snapshot().phase === "idle");

      const started = events
        .filter((event) => event.type === "turn_started")
        .map((event) => (event.body as any).speakerId);
      expect(started).toEqual(["alpha", "bravo", "charlie"]);
      expect(events.some((event) => event.type === "bid_submitted")).toBe(false);
      expect(events.filter((event) => event.type === "speaker_selected").map((event) => (event.body as any).scheduler)).toEqual([
        "round-robin",
        "round-robin",
        "round-robin",
      ]);
    } finally {
      await session.stop();
    }
  });

  it("limits addressed prompts to the selected agents", async () => {
    const log = new EventLog("room", new InMemoryStore());
    const events: RoomEvent[] = [];
    log.on((event) => events.push(event));
    const session = new SessionManager({
      sessionId: "room",
      title: "Directed",
      log,
      agents: [new StubSpeaker("alpha", { confidence: 1 }), new StubSpeaker("bravo", { confidence: 0.5 })],
      maxTurnsPerTopic: 2,
      noConsecutive: false,
      settlingWindowMs: 10,
    });
    session.start();
    try {
      await session.submitUserPrompt("alpha only", ["alpha"]);
      await waitFor(() => session.snapshot().phase === "idle" && events.some((event) => event.type === "turn_completed"), 1_500);
      const speakers = events.filter((event) => event.type === "turn_started").map((event) => (event.body as any).speakerId);
      expect(speakers.length).toBeGreaterThan(0);
      expect(new Set(speakers)).toEqual(new Set(["alpha"]));
    } finally {
      await session.stop();
    }
  });

  it("records raise-hand bids as floor requests and waits for the active speaker", async () => {
    const log = new EventLog("room", new InMemoryStore());
    const events: RoomEvent[] = [];
    log.on((event) => events.push(event));
    const session = new SessionManager({
      sessionId: "room",
      title: "Raise hand",
      log,
      agents: [new StubSpeaker("alpha", { confidence: 1 }), new StubSpeaker("bravo", { confidence: 0.5 })],
      schedulerMode: "raise-hand",
      maxTurnsPerTopic: 2,
      noConsecutive: true,
      settlingWindowMs: 10,
    });
    session.start();
    try {
      await session.submitUserPrompt("discuss");
      await waitFor(() => events.filter((event) => event.type === "turn_completed").length === 2, 1_500);
      const requests = events.filter((event) => event.type === "floor_request");
      expect(requests.map((event) => event.author.id).sort()).toEqual(["alpha", "bravo"]);
      const firstCompleted = events.find((event) => event.type === "turn_completed");
      const secondStarted = events.filter((event) => event.type === "turn_started")[1];
      expect(firstCompleted?.seq).toBeLessThan(secondStarted?.seq ?? 0);
    } finally {
      await session.stop();
    }
  });

  it("reserves the final topic turn for a forced wrap-up", async () => {
    const log = new EventLog("room", new InMemoryStore());
    const alpha = new PromptCaptureSpeaker("alpha", { confidence: 1 });
    const bravo = new PromptCaptureSpeaker("bravo", { confidence: 0.5 });
    const session = new SessionManager({
      sessionId: "room",
      title: "Wrap up",
      log,
      agents: [alpha, bravo],
      maxTurnsPerTopic: 3,
      noConsecutive: true,
      settlingWindowMs: 10,
    });
    session.start();
    try {
      await session.submitUserPrompt("decide");
      await waitFor(() => session.snapshot().phase === "idle" && log.replay(0).filter((event) => event.type === "turn_completed").length === 3, 1_500);
      expect([...alpha.prompts, ...bravo.prompts].some((prompt) => prompt.includes("[QUORUM WRAP UP]"))).toBe(true);
      expect((log.replay(0).filter((event) => event.type === "phase_changed").at(-1)?.body as any).reason).toBe("topic wrapped up");
    } finally {
      await session.stop();
    }
  });

  it("restores shared memory into the context bundle", async () => {
    const store = new InMemoryStore();
    store.writeSharedMemory("room", { namespace: "decision", key: "runtime", value: "bun" });
    const log = new EventLog("room", store);
    const speaker = new ContextCaptureSpeaker("agent", { confidence: 1 });
    const session = new SessionManager({
      sessionId: "room",
      title: "Memory restore",
      log,
      agents: [speaker],
      maxTurnsPerTopic: 1,
      settlingWindowMs: 10,
    });
    session.start();
    try {
      await session.submitUserPrompt("continue");
      await waitFor(() => speaker.capturedContextBundle.length > 0);
      expect(speaker.capturedContextBundle).toContain("decision:runtime v1: \"bun\"");
    } finally {
      await session.stop();
    }
  });

  it("continues automatic compaction after the last persisted summary", async () => {
    const store = new InMemoryStore();
    const log = new EventLog("room", store);
    for (let index = 0; index < 60; index++) {
      await log.append({
        author: { kind: "human", id: "human", display: "Human" },
        type: "message",
        body: { text: `historical-${index}` },
      });
    }
    store.persistWorkingMemorySummary({
      summaryId: "existing",
      sessionId: "room",
      sourceFromSeq: 1,
      sourceToSeq: 50,
      sourceHash: "existing-hash",
      model: "extractive-v1",
      promptVersion: "working-memory-v1",
      createdAt: new Date().toISOString(),
      content: "existing summary",
    });
    const session = new SessionManager({
      sessionId: "room",
      title: "Compaction restore",
      log,
      agents: [new StubSpeaker("agent", { confidence: 1 })],
      maxTurnsPerTopic: 1,
      settlingWindowMs: 10,
      memory: { minSeqGap: 1, minEvents: 1, keepRecentEvents: 0 },
    });
    session.start();
    try {
      await session.submitUserPrompt("continue");
      await waitFor(() => log.readWorkingMemorySummaries().length > 1);
      const nextSummary = log.readWorkingMemorySummaries().at(-1)!;
      expect(nextSummary.sourceFromSeq).toBeGreaterThan(50);
    } finally {
      await session.stop();
    }
  });

  it("serializes editable shared-session turns through the workspace and checkpoints them", async () => {
    const log = new EventLog("room", new InMemoryStore());
    const events: RoomEvent[] = [];
    log.on((event) => events.push(event));
    const workspace = new FakeWorkspace();
    const session = new SessionManager({
      sessionId: "room",
      title: "Workspace test",
      log,
      agents: [new StubSpeaker("editor", { confidence: 1, text: "edited", canEditFiles: true })],
      workspace,
      settlingWindowMs: 20,
      turnTimeoutMs: 1_000,
    });

    session.start();
    try {
      await session.submitUserPrompt("edit");
      await waitFor(() => events.some((event) => event.type === "checkpoint"));

      expect(workspace.acquired.some((item) => item.endsWith(":editor"))).toBe(true);
      expect(workspace.released.some((item) => item.endsWith(":editor"))).toBe(true);
      expect(workspace.checkpoints.some((item) => item.includes(":editor:"))).toBe(true);
      expect(events.some((event) => event.type === "checkpoint" && (event.body as any).summary === "fake checkpoint")).toBe(true);
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

  it("injects continuity anchors and error-control rules into agent context", async () => {
    const log = new EventLog("room", new InMemoryStore());
    const speaker = new ContextCaptureSpeaker("agent", { confidence: 1 });
    const session = new SessionManager({
      sessionId: "room",
      title: "Context control test",
      log,
      agents: [speaker],
      settlingWindowMs: 20,
      turnTimeoutMs: 1_000,
    });

    session.start();
    try {
      await session.submitUserPrompt("continue carefully");
      await waitFor(() => log.replay(0).some((event) => event.type === "turn_completed"));

      expect(speaker.capturedContextBundle).toContain("Context checksum:");
      expect(speaker.capturedContextBundle).toContain("Continuity / error-control rules:");
      expect(speaker.capturedContextBundle).toContain("authoritative over native model memory");
      expect(speaker.capturedContextBundle).toContain("Head seq:");
      expect(speaker.capturedContextBundle).toContain("#1 message human");
    } finally {
      await session.stop();
    }
  });
});

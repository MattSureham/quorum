import { createHash } from "node:crypto";
import type {
  AgentDelta,
  AgentRuntime,
  Bid,
  BidContext,
  ContextSnapshot,
  ISpeakerAgent,
  MemorySummary,
  ParticipantDescriptor,
  RoomEvent,
  SessionPhase,
  SharedMemoryCommand,
  ToolCallRequest,
  ToolCallResult,
  TurnContext,
  WriteResult,
  ImageAttachment,
  Capabilities,
} from "@quorum/protocol";
import type { EventLog } from "./event-log.js";
import { ulid } from "./ids.js";
import { CommandMailbox } from "./command-mailbox.js";
import { Arbiter, type ArbitrationDecision } from "./arbiter.js";
import { assertTransition, projectSessionState } from "./session-state.js";
import { isRoomTool, normalizeToolName, runRoomTool } from "./room-tools.js";
import { createWorkingMemorySummary } from "./memory.js";
import type { ToolExecutor } from "./tool-executor.js";
import type { WorkspaceManager, WriteLease } from "./types.js";

export interface SessionManagerOptions {
  sessionId: string;
  title: string;
  log: EventLog;
  agents: ISpeakerAgent[];
  humans?: ParticipantDescriptor[];
  bidWindowMs?: number;
  settlingWindowMs?: number;
  turnTimeoutMs?: number;
  arbiter?: Arbiter;
  workspacePath?: string;
  workspace?: WorkspaceManager;
  toolExecutor?: ToolExecutor;
  memory?: {
    autoCompact?: boolean;
    minEvents?: number;
    minSeqGap?: number;
    keepRecentEvents?: number;
  };
  schedulerMode?: "bid" | "raise-hand" | "round-robin";
  targetDiscussionRounds?: number;
  maxTurnsPerTopic?: number;
  noConsecutive?: boolean;
}

export interface SessionSnapshot {
  phase: SessionPhase;
  epoch: number;
  activeTurn?: { turnId: string; speakerId: string; generation: number };
  pendingBids: Bid[];
  lastTurnId?: string;
}

interface PendingPrompt {
  text: string;
  addressedTo: string[];
  attachments: ImageAttachment[];
  eventSeq: number;
}

interface InterruptedRuntimeState {
  phase: SessionPhase;
  activeTurn?: { turnId: string; speakerId: string; generation: number };
}

const systemAuthor = { kind: "system" as const, id: "session", display: "SessionManager" };
const CONTEXT_EVENT_TYPES = new Set<RoomEvent["type"]>([
  "message",
  "tool_call",
  "tool_result",
  "checkpoint",
  "system",
  "turn_started",
  "turn_completed",
  "turn_cancelled",
  "turn_failed",
]);

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shortHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16);
}

export class SessionManager {
  private readonly mailbox = new CommandMailbox();
  private readonly byId = new Map<string, ISpeakerAgent>();
  private readonly arbiter: Arbiter;
  private readonly pendingBids = new Map<string, Bid>();
  private readonly recentSpeakerCounts = new Map<string, number>();
  private readonly waitingRounds = new Map<string, number>();
  private readonly sharedMemory = new Map<string, { version: number; value: unknown }>();
  private phase: SessionPhase = "idle";
  private epoch = 0;
  private active?: { turnId: string; speakerId: string; generation: number; ac: AbortController };
  private lastTurnId?: string;
  private lastSpeakerId?: string;
  private lastPrompt = "";
  private currentAddressedTo: string[] = [];
  private currentAttachments: ImageAttachment[] = [];
  private turnsThisTopic = 0;
  private lastTurnOutcome?: "done" | "cancelled" | "failed";
  private wrapUpActive = false;
  private wrapUpQueue: string[] = [];
  private pendingPrompts: PendingPrompt[] = [];
  private roundRobinQueue: string[] = [];
  private running = false;
  private humanHoldsWriteFloor = false;
  private humanWriteLease?: WriteLease;
  private readonly pendingToolApprovals = new Map<string, { tool: string; resolve: (allow: boolean) => void }>();
  private lastCompactedSeq = 0;
  private interruptedRuntime?: InterruptedRuntimeState;

  constructor(private readonly opts: SessionManagerOptions) {
    for (const agent of opts.agents) this.byId.set(agent.id, agent);
    this.arbiter = opts.arbiter ?? new Arbiter();
    if (opts.log.headSeq > 0) {
      const replay = opts.log.replay(0);
      const projected = projectSessionState(replay);
      this.epoch = projected.epoch;
      this.lastTurnId = projected.lastTurnId;
      this.lastSpeakerId = projected.lastSpeakerId;
      if (projected.phase === "paused" || projected.phase === "ended") {
        this.phase = projected.phase;
      } else if (projected.phase !== "idle") {
        this.interruptedRuntime = { phase: projected.phase, activeTurn: projected.activeTurn };
      }
      const activatedPromptSeqs = new Set(replay
        .filter((event) => event.type === "phase_changed" && typeof (event.body as any)?.promptSeq === "number")
        .map((event) => (event.body as any).promptSeq as number));
      const queuedPromptSeqs = replay
        .filter((event) => event.type === "system" && typeof (event.body as any)?.promptSeq === "number")
        .map((event) => (event.body as any).promptSeq as number)
        .filter((seq) => !activatedPromptSeqs.has(seq));
      for (const seq of queuedPromptSeqs) {
        const event = replay.find((item) => item.seq === seq && item.type === "message" && item.author.kind === "human");
        if (!event) continue;
        const body = event.body as { text?: string; attachments?: ImageAttachment[] };
        this.pendingPrompts.push({
          text: body.text ?? "",
          addressedTo: event.addressedTo ?? [],
          attachments: body.attachments ?? [],
          eventSeq: event.seq,
        });
      }
    }
    const summaries = opts.log.readWorkingMemorySummaries();
    this.lastCompactedSeq = summaries.reduce((max, summary) => Math.max(max, summary.sourceToSeq), 0);
    for (const item of opts.log.readSharedMemory()) {
      this.sharedMemory.set(`${item.namespace}:${item.key}`, { version: item.version, value: item.value });
    }
  }

  start(): void {
    this.running = true;
    if (this.interruptedRuntime || (this.pendingPrompts.length && this.phase === "idle")) {
      this.runInBackground("restore session runtime", this.mailbox.enqueue("restoreSessionRuntime", async () => {
        await this.recoverInterruptedRuntime();
        if (this.pendingPrompts.length && this.phase === "idle") await this.activateNextQueuedPrompt();
      }));
    }
  }

  private async recoverInterruptedRuntime(): Promise<void> {
    const interrupted = this.interruptedRuntime;
    if (!interrupted) return;
    this.interruptedRuntime = undefined;

    if (interrupted.activeTurn) {
      const { turnId, speakerId, generation } = interrupted.activeTurn;
      this.lastTurnId = turnId;
      this.lastSpeakerId = speakerId;
      this.lastTurnOutcome = "failed";
      await this.append("turn_failed", {
        turnId,
        speakerId,
        generation,
        failure: {
          category: "daemon_restart",
          message: "The host stopped before this agent turn completed. The turn was not replayed to avoid duplicating tool or workspace side effects.",
        },
      }, "system", { turnId });
      await this.append("floor_release", { turnId, reason: "daemon_restart" }, "system", { turnId });
    }

    await this.append("system", {
      level: "warn",
      text: `Recovered an interrupted ${interrupted.phase} runtime after host restart; the session is idle and ready to retry.`,
      recovery: { from: interrupted.phase, to: "idle", reason: "daemon_restart" },
    }, "system");
    await this.append("phase_changed", {
      from: interrupted.phase,
      to: "idle",
      reason: "host restarted; incomplete runtime state cleared",
      recovered: true,
    });
    this.phase = "idle";
  }

  async stop(): Promise<void> {
    this.running = false;
    this.mailbox.stop();
    for (const pending of this.pendingToolApprovals.values()) pending.resolve(false);
    this.pendingToolApprovals.clear();
    this.humanWriteLease?.release();
    this.humanWriteLease = undefined;
    this.humanHoldsWriteFloor = false;
    if (this.active) {
      const active = this.active;
      this.active = undefined;
      active.ac.abort();
      await this.append("turn_cancelled", { turnId: active.turnId, speakerId: active.speakerId, reason: "session stopped" }, "system");
    }
    await Promise.all([...this.byId.values()].map((agent) => agent.shutdown().catch(() => undefined)));
  }

  snapshot(): SessionSnapshot {
    return {
      phase: this.phase,
      epoch: this.epoch,
      activeTurn: this.active
        ? { turnId: this.active.turnId, speakerId: this.active.speakerId, generation: this.active.generation }
        : undefined,
      pendingBids: [...this.pendingBids.values()],
      lastTurnId: this.lastTurnId,
    };
  }

  async submitUserPrompt(text: string, addressedTo: string[] = [], attachments: ImageAttachment[] = []): Promise<void> {
    const shouldActivate = await this.mailbox.enqueue("submitUserPrompt", async () => {
      if (!this.running) this.running = true;
      this.releaseWriteFloor("human resumed the room");
      const event = await this.append("message", { text, ...(attachments.length ? { attachments } : {}) }, "participant", {
        author: this.humanAuthor(),
        addressedTo,
      });
      const prompt = { text, addressedTo, attachments, eventSeq: event.seq };
      if (this.active || this.phase === "speaking" || this.phase === "speaker_granted" || this.phase === "settling") {
        this.pendingPrompts.push(prompt);
        await this.append("system", {
          level: "info",
          text: `prompt queued behind active turn: #${event.seq}`,
          promptSeq: event.seq,
          queueDepth: this.pendingPrompts.length,
        }, "debug");
        return false;
      }
      await this.activatePrompt(prompt);
      return !this.isRoundRobin();
    });
    if (shouldActivate) await this.collectAndMaybeArbitrate(text);
  }

  private async activatePrompt(prompt: PendingPrompt): Promise<void> {
    this.lastPrompt = prompt.text;
    this.currentAddressedTo = prompt.addressedTo;
    this.currentAttachments = prompt.attachments;
    this.turnsThisTopic = 0;
    this.wrapUpActive = false;
    this.wrapUpQueue = [];
    if (!this.hasSoftRoundTarget() && !this.isRoundRobin() && Math.max(1, this.opts.maxTurnsPerTopic ?? 6) === 1) {
      this.wrapUpActive = true;
      this.lastPrompt = this.wrapUpPrompt(this.lastPrompt);
    }
    this.epoch++;
    this.pendingBids.clear();
    if (this.isRoundRobin()) {
      this.roundRobinQueue = this.roundRobinSchedule();
      await this.grantNextRoundRobinSpeaker();
      return;
    }
    await this.transition("collecting_bids", { epoch: this.epoch, promptSeq: prompt.eventSeq });
  }

  private async activateNextQueuedPrompt(): Promise<void> {
    const next = this.pendingPrompts.shift();
    if (!next) return;
    await this.activatePrompt(next);
    if (!this.isRoundRobin()) this.runInBackground("collect bids for queued prompt", this.collectAndMaybeArbitrate(next.text));
  }

  async submitBid(bid: Bid): Promise<void> {
    await this.mailbox.enqueue("submitBid", async () => {
      if (bid.epoch !== this.epoch) return;
      this.pendingBids.set(bid.bidId, bid);
      await this.append("bid_submitted", { bid }, "debug", {
        author: { kind: "agent", id: bid.agentId, display: bid.agentId },
      });
      if (this.phase !== "speaking" && this.phase !== "speaker_granted") {
        await this.arbitrateIfPossible();
      }
    });
  }

  async takeWriteFloor(): Promise<void> {
    if (this.humanHoldsWriteFloor) return;
    this.humanHoldsWriteFloor = true;
    if (this.opts.workspace) {
      const lease = await this.opts.workspace.acquireWriteFloor("human-write", "human");
      if (!this.humanHoldsWriteFloor) {
        lease.release();
        return;
      }
      this.humanWriteLease = lease;
    }
    await this.append("system", { level: "info", text: "human holds the write floor — agent turns paused" }, "system");
  }

  releaseWriteFloor(reason = "human released the write floor"): void {
    if (!this.humanHoldsWriteFloor) return;
    this.humanHoldsWriteFloor = false;
    this.humanWriteLease?.release();
    this.humanWriteLease = undefined;
    this.runInBackground("record write floor release", this.append("system", { level: "info", text: `write floor released — ${reason}` }, "system"));
    this.runInBackground("resume after write floor", this.mailbox.enqueue("writeFloorReleased", () => this.continueAfterWriteFloor()));
  }

  async drain(): Promise<void> {
    await this.mailbox.drain();
  }

  async compactWorkingMemory(fromSeq = 0, toSeq = this.opts.log.headSeq): Promise<MemorySummary> {
    return this.mailbox.enqueue("compactWorkingMemory", async () => {
      const summary = this.createAndPersistWorkingMemorySummary(fromSeq, toSeq);
      await this.append("system", {
        level: "info",
        text: `working memory compacted: #${summary.sourceFromSeq}-#${summary.sourceToSeq}`,
        memorySummary: summary,
      }, "debug");
      return summary;
    });
  }

  private async maybeAutoCompactWorkingMemory(): Promise<void> {
    if (this.opts.memory?.autoCompact === false) return;
    const headSeq = this.opts.log.headSeq;
    const minSeqGap = this.opts.memory?.minSeqGap ?? 80;
    const minEvents = this.opts.memory?.minEvents ?? 40;
    if (headSeq - this.lastCompactedSeq < minSeqGap) return;

    const keepRecent = this.opts.memory?.keepRecentEvents ?? 20;
    const toSeq = Math.max(0, headSeq - keepRecent);
    if (toSeq <= this.lastCompactedSeq) return;

    const events = this.opts.log.replay(this.lastCompactedSeq).filter((event) => event.seq <= toSeq);
    if (events.length < minEvents) return;

    const summary = this.createAndPersistWorkingMemorySummary(this.lastCompactedSeq, toSeq);
    await this.append("system", {
      level: "info",
      text: `working memory auto-compacted: #${summary.sourceFromSeq}-#${summary.sourceToSeq}`,
      memorySummary: summary,
      auto: true,
    }, "debug");
  }

  private createAndPersistWorkingMemorySummary(fromSeq: number, toSeq: number): MemorySummary {
    const events = this.opts.log.replay(fromSeq).filter((event) => event.seq <= toSeq);
    const summary = createWorkingMemorySummary({ sessionId: this.opts.sessionId, events });
    this.opts.log.persistWorkingMemorySummary(summary);
    this.lastCompactedSeq = Math.max(this.lastCompactedSeq, summary.sourceToSeq);
    return summary;
  }

  approveTool(callId: string, allow: boolean): void {
    const pending = this.pendingToolApprovals.get(callId);
    if (!pending) return;
    this.pendingToolApprovals.delete(callId);
    pending.resolve(allow);
    void this.mailbox.enqueue("approveTool", () =>
      this.append("system", {
        level: "info",
        text: `tool ${allow ? "approved" : "denied"}: ${pending.tool} [${callId}]`,
        approval: { callId, tool: pending.tool, state: allow ? "granted" : "denied" },
      }, "system"),
    ).catch(() => undefined);
  }

  async interrupt(by = "human", hard = true): Promise<void> {
    await this.mailbox.enqueue("interrupt", async () => {
      await this.append("interrupt", { by, hard }, "room", {
        author: { kind: by === "human" ? "human" : "system", id: by, display: by === "human" ? "Human" : by },
        turnId: this.active?.turnId,
      });
      if (!this.active) return;
      this.active.ac.abort();
      for (const pending of this.pendingToolApprovals.values()) pending.resolve(false);
      this.pendingToolApprovals.clear();
    });
  }

  private async collectAndMaybeArbitrate(prompt: string): Promise<void> {
    await this.collectAgentBids(prompt);
    await this.mailbox.enqueue("postBidArbitrate", () => this.arbitrateIfPossible());
  }

  private async collectAgentBids(prompt: string): Promise<void> {
    const ctx: BidContext = {
      sessionId: this.opts.sessionId,
      epoch: this.epoch,
      prompt,
      phase: this.phase,
      participants: this.participants(),
      transcript: this.boundedTranscript(),
      lastTurnId: this.lastTurnId,
    };

    const eligible = this.currentAddressedTo.length
      ? [...this.byId.values()].filter((agent) => this.currentAddressedTo.includes(agent.id))
      : [...this.byId.values()];
    const bids = await Promise.all(
      eligible.map((agent) =>
        this.collectBidWithTimeout(agent, ctx),
      ),
    );

    await this.mailbox.enqueue("collectAgentBids", async () => {
      for (const bid of bids) {
        if (!bid || bid.epoch !== this.epoch) continue;
        this.pendingBids.set(bid.bidId, bid);
        if (this.isRaiseHand()) {
          await this.append("floor_request", {
            reason: bid.rationale ?? `${bid.kind} bid`,
            intent: bid.kind === "rebuttal" ? "rebut" : "reply",
            bidId: bid.bidId,
          }, "participant", { author: { kind: "agent", id: bid.agentId, display: bid.agentId } });
        }
        await this.append("bid_submitted", { bid }, "debug", {
          author: { kind: "agent", id: bid.agentId, display: bid.agentId },
        });
      }
    });
  }

  private async collectBidWithTimeout(agent: ISpeakerAgent, ctx: BidContext): Promise<Bid | undefined> {
    const timeoutMs = this.opts.bidWindowMs ?? 2_000;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        agent.bid(ctx).catch(() => undefined),
        new Promise<undefined>((resolve) => {
          timer = setTimeout(() => resolve(undefined), timeoutMs);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private async arbitrateIfPossible(): Promise<void> {
    if (this.active || this.phase === "speaking" || this.phase === "speaker_granted") return;
    if (this.humanHoldsWriteFloor) return;
    if (this.pendingBids.size === 0) {
      await this.transition("idle", { reason: "no bids" });
      return;
    }

    await this.transition("arbitrating", { epoch: this.epoch });
    const decision = this.arbiter.decide({
      participants: this.participants(),
      bids: [...this.pendingBids.values()],
      recentSpeakerCounts: this.recentSpeakerCounts,
      waitingRounds: this.waitingRounds,
      lastSpeakerId: this.lastSpeakerId,
      noConsecutive: this.opts.noConsecutive,
    });
    await this.append("speaker_selected", {
      policyVersion: decision.policyVersion,
      winner: decision.winner,
      candidates: decision.candidates,
    }, "debug");

    if (!decision.winner) {
      await this.transition("idle", { reason: "no eligible bids" });
      return;
    }

    this.pendingBids.delete(decision.winner.bid.bidId);
    await this.grantSpeaker(decision);
  }

  private async grantSpeaker(decision: ArbitrationDecision): Promise<void> {
    const winner = decision.winner;
    if (!winner) return;
    const agent = this.byId.get(winner.bid.agentId);
    if (!agent) return;
    await this.grantAgent(agent, winner.bid.kind, winner.bid);
  }

  private async grantAgent(agent: ISpeakerAgent, reason: string, bid?: Bid): Promise<void> {
    const turnId = ulid();
    const generation = Date.now();
    const ac = new AbortController();
    this.active = { turnId, speakerId: agent.id, generation, ac };
    this.bumpWaiting(agent.id);
    await this.transition("speaker_granted", { turnId, speakerId: agent.id, ...(bid ? { bid } : {}) });
    await this.append("floor_grant", {
      participantId: agent.id,
      turnId,
      reason,
      deadlineMs: this.opts.turnTimeoutMs ?? 120_000,
    });
    this.runInBackground(`run turn ${turnId}`, this.runTurn(agent, turnId, generation, ac));
  }

  private async runTurn(agent: ISpeakerAgent, turnId: string, generation: number, ac: AbortController): Promise<void> {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const startedAt = Date.now();
    let offset = 0;
    let outcome: "done" | "cancelled" | "failed" = "done";
    const caps = this.agentCapabilities(agent);
    let lease: WriteLease | undefined;
    let toolCalls = 0;
    let outputs = 0;
    let failure: { message: string; category?: string; detail?: string } | undefined;
    let timedOut = false;

    await this.mailbox.enqueue("turnStarted", async () => {
      await this.transition("speaking", { turnId, speakerId: agent.id, generation });
      await this.append("turn_started", { turnId, speakerId: agent.id, generation });
    });

    try {
      if (caps.canEditFiles && this.opts.workspace) {
        lease = await this.opts.workspace.acquireWriteFloor(turnId, agent.id);
        await this.opts.workspace.snapshotPre();
      }
      // Workspace contention is queueing time. The agent execution deadline
      // starts only after this turn owns the shared write floor.
      const turnTimeoutMs = this.opts.turnTimeoutMs ?? 120_000;
      timeout = setTimeout(() => {
        timedOut = true;
        ac.abort();
      }, turnTimeoutMs);
      const ctx: TurnContext = {
        sessionId: this.opts.sessionId,
        turnId,
        generation,
        epoch: this.epoch,
        speakerId: agent.id,
        prompt: this.lastPrompt,
        contextSeq: this.opts.log.headSeq,
        participants: this.participants(),
        transcript: this.boundedTranscript(),
        contextBundle: this.contextBundle(),
        attachments: this.currentAttachments,
      };

      for await (const delta of agent.speak(ctx, this.runtime(), ac.signal)) {
        if (ac.signal.aborted) {
          outcome = timedOut ? "failed" : "cancelled";
          break;
        }
        if (delta.type === "done") break;
        if (delta.type === "error") {
          failure = delta;
          outcome = "failed";
          break;
        }
        await this.mailbox.enqueue("turnDelta", async () => {
          if (!this.active || this.active.turnId !== turnId || this.active.generation !== generation) return;
          if (delta.type === "tool_call") toolCalls++;
          if (delta.type === "text" || delta.type === "thinking" || delta.type === "tool_result") outputs++;
          offset = await this.persistDelta(agent, turnId, generation, offset, delta);
        });
      }
    } catch (err) {
      outcome = timedOut ? "failed" : ac.signal.aborted ? "cancelled" : "failed";
      if (!ac.signal.aborted || timedOut) failure = {
        message: err instanceof Error ? err.message : String(err),
        category: timedOut ? "timeout" : "adapter_exception",
      };
    } finally {
      if (timeout) clearTimeout(timeout);
      if (timedOut) {
        outcome = "failed";
        failure = {
          message: `${agent.descriptor.display} timed out after ${this.opts.turnTimeoutMs ?? 120_000}ms without completing a response`,
          category: "timeout",
        };
      } else if (ac.signal.aborted && outcome === "done") outcome = "cancelled";
      if (this.running) await this.mailbox.enqueue("finishTurn", async () => {
        if (!this.active || this.active.turnId !== turnId || this.active.generation !== generation) return;
        this.lastTurnId = turnId;
        this.lastSpeakerId = agent.id;
        this.turnsThisTopic++;
        this.lastTurnOutcome = outcome;
        this.active = undefined;
        this.recentSpeakerCounts.set(agent.id, (this.recentSpeakerCounts.get(agent.id) ?? 0) + 1);
        const eventType = outcome === "done" ? "turn_completed" : outcome === "cancelled" ? "turn_cancelled" : "turn_failed";
        const completed = await this.append(eventType, {
          turnId,
          speakerId: agent.id,
          generation,
          offset,
          ...(failure ? { failure } : {}),
        });
        await this.append("turn_trace", {
          turnId,
          speakerId: agent.id,
          generation,
          startedAt,
          endedAt: Date.now(),
          durationMs: Math.max(0, Date.now() - startedAt),
          outcome: outcome === "done" ? "completed" : outcome,
          toolCalls,
          outputs,
          offset,
          ...(failure ? { failure } : {}),
        }, "debug", {
          author: { kind: "system", id: "trace", display: "Trace" },
          turnId,
        });
        if (caps.canEditFiles && this.opts.workspace) {
          const checkpoint = await this.opts.workspace.checkpoint(turnId, agent.id, completed.id).catch(() => null);
          if (checkpoint) {
            await this.append("checkpoint", checkpoint, "system", {
              author: { kind: "system", id: "workspace", display: "Workspace" },
              turnId,
            });
          }
        }
        await this.append("floor_release", { turnId, reason: outcome === "done" ? "done" : outcome });
        await this.maybeAutoCompactWorkingMemory();
        await this.transition("settling", { turnId, settlingWindowMs: this.opts.settlingWindowMs ?? 400 });
        if (this.pendingPrompts.length) this.runInBackground("activate queued prompt", this.activateNextQueuedPrompt());
        else this.runInBackground(`settle turn ${turnId}`, this.settleAndArbitrate());
      }).catch(async (err) => {
        if (!this.running) return;
        await this.append("system", {
          level: "error",
          text: `failed to finalize turn ${turnId}: ${err instanceof Error ? err.message : String(err)}`,
        }, "system", { turnId });
      });
      lease?.release();
    }
  }

  private async settleAndArbitrate(): Promise<void> {
    await delay(this.opts.settlingWindowMs ?? 400);
    if (!this.running) return;
    const action = await this.mailbox.enqueue("settleAndArbitrate", async (): Promise<"collect" | "none"> => {
      if (this.phase !== "settling") return "none";
      for (const bid of this.pendingBids.values()) {
        await this.append("bid_settled", { bidId: bid.bidId, action: "confirmed" }, "debug", {
          author: { kind: "agent", id: bid.agentId, display: bid.agentId },
        });
      }
      if (this.wrapUpActive) {
        await this.grantNextWrapUpSpeaker();
        return "none";
      }
      if (this.isRoundRobin()) {
        await this.grantNextRoundRobinSpeaker();
        return "none";
      }
      const softTargetTurns = this.softTargetTurns();
      const maxTurns = softTargetTurns === undefined
        ? Math.max(1, this.opts.maxTurnsPerTopic ?? 6)
        : Math.max(
          this.opts.maxTurnsPerTopic ?? 6,
          softTargetTurns + Math.max(1, this.orderedAgentIds().length),
        );
      if (softTargetTurns !== undefined && this.turnsThisTopic >= softTargetTurns) {
        await this.beginWrapUp("target discussion rounds reached");
        return "none";
      }
      if (this.lastTurnOutcome && this.lastTurnOutcome !== "done" && this.pendingBids.size === 0) {
        await this.transition("idle", { reason: "all candidate turns failed", turns: this.turnsThisTopic });
        return "none";
      }
      if (this.turnsThisTopic >= maxTurns - 1) {
        this.wrapUpActive = true;
        this.lastPrompt = this.wrapUpPrompt(this.lastPrompt);
        if (this.pendingBids.size) {
          await this.arbitrateIfPossible();
          return "none";
        }
        await this.transition("collecting_bids", { epoch: this.epoch, wrapUp: true });
        return "collect";
      }
      if (this.pendingBids.size === 0) {
        await this.transition("collecting_bids", { epoch: this.epoch, followUp: true });
        return "collect";
      }
      await this.arbitrateIfPossible();
      return "none";
    }).catch(() => "none" as const);
    if (action === "collect") await this.collectAndMaybeArbitrate(this.lastPrompt);
  }

  private isRoundRobin(): boolean {
    return this.opts.schedulerMode === "round-robin";
  }

  private isRaiseHand(): boolean {
    return this.opts.schedulerMode === "raise-hand";
  }

  private wrapUpPrompt(prompt: string): string {
    return `${prompt}\n\n[QUORUM WRAP UP] The advisory discussion-round target has been reached. Finish the reasoning already in progress and use this final wrap-up pass to state your concrete answer, recommendation, or plan. Do not open a new subtopic. Preserve unresolved disagreements explicitly and leave unfinished work for Continue Session.`;
  }

  private runInBackground(label: string, task: Promise<unknown>): void {
    void task.catch(async (err) => {
      if (!this.running) return;
      try {
        await this.append("system", {
          level: "error",
          text: `${label} failed: ${err instanceof Error ? err.message : String(err)}`,
        }, "system");
      } catch {
        // Persistence itself failed; do not turn a background failure into an
        // unhandled rejection that terminates the daemon.
      }
    });
  }

  private orderedAgentIds(): string[] {
    const ordered = [...this.byId.keys()];
    if (!this.currentAddressedTo.length) return ordered;
    return ordered.filter((id) => this.currentAddressedTo.includes(id));
  }

  private targetDiscussionRounds(): number | undefined {
    const value = this.opts.targetDiscussionRounds;
    if (!Number.isInteger(value) || (value ?? 0) < 1) return undefined;
    return Math.min(12, value as number);
  }

  private hasSoftRoundTarget(): boolean {
    return this.targetDiscussionRounds() !== undefined;
  }

  private softTargetTurns(): number | undefined {
    const rounds = this.targetDiscussionRounds();
    if (!rounds) return undefined;
    return rounds * Math.max(1, this.orderedAgentIds().length);
  }

  private roundRobinSchedule(): string[] {
    const ordered = this.orderedAgentIds();
    const rounds = this.targetDiscussionRounds();
    if (!rounds) return ordered;
    return Array.from({ length: rounds }, () => ordered).flat();
  }

  private async beginWrapUp(reason: string): Promise<void> {
    if (this.wrapUpActive) {
      await this.grantNextWrapUpSpeaker();
      return;
    }
    this.wrapUpActive = true;
    this.pendingBids.clear();
    this.wrapUpQueue = this.orderedAgentIds();
    this.lastPrompt = this.wrapUpPrompt(this.lastPrompt);
    await this.append("system", {
      level: "info",
      text: `wrap-up requested: ${reason}`,
      wrapUp: {
        reason,
        targetDiscussionRounds: this.targetDiscussionRounds(),
        speakers: this.wrapUpQueue,
      },
    }, "system");
    if (!this.wrapUpQueue.length) {
      await this.transition("idle", { reason: "topic wrapped up", turns: this.turnsThisTopic });
      return;
    }
    await this.transition("collecting_bids", {
      epoch: this.epoch,
      wrapUp: true,
      targetDiscussionRounds: this.targetDiscussionRounds(),
    });
    await this.grantNextWrapUpSpeaker();
  }

  private async grantNextWrapUpSpeaker(): Promise<void> {
    if (this.active || this.phase === "speaking" || this.phase === "speaker_granted") return;
    if (this.humanHoldsWriteFloor) return;
    const nextAgentId = this.wrapUpQueue.shift();
    if (!nextAgentId) {
      this.pendingBids.clear();
      await this.transition("idle", { reason: "topic wrapped up", turns: this.turnsThisTopic });
      return;
    }
    const agent = this.byId.get(nextAgentId);
    if (!agent) {
      await this.grantNextWrapUpSpeaker();
      return;
    }
    const bid = this.roundRobinBid(agent, "followup", "final wrap-up pass");
    if (this.phase === "idle" || this.phase === "settling") {
      await this.transition("collecting_bids", { epoch: this.epoch, wrapUp: true });
    }
    await this.transition("arbitrating", { epoch: this.epoch, scheduler: "wrap-up" });
    await this.append("speaker_selected", {
      policyVersion: "wrap-up-v1",
      winner: {
        bid,
        score: 1,
        components: {
          base: 1,
          capability: 0,
          userMention: 0,
          waiting: 0,
          recentSpeakerPenalty: 0,
          rebuttalBonus: 0,
          confidenceTieBreaker: 0,
        },
      },
      candidates: [],
      scheduler: "wrap-up",
      remainingSpeakers: this.wrapUpQueue,
    }, "debug");
    await this.grantAgent(agent, "wrap-up", bid);
  }

  private async grantNextRoundRobinSpeaker(): Promise<void> {
    if (this.active || this.phase === "speaking" || this.phase === "speaker_granted") return;
    if (this.humanHoldsWriteFloor) return;
    const nextAgentId = this.roundRobinQueue.shift();
    if (!nextAgentId) {
      if (this.hasSoftRoundTarget() && !this.wrapUpActive) {
        await this.beginWrapUp("target discussion rounds reached");
        return;
      }
      await this.transition("idle", { reason: "round-robin complete" });
      return;
    }
    const agent = this.byId.get(nextAgentId);
    if (!agent) {
      await this.grantNextRoundRobinSpeaker();
      return;
    }
    const bid = this.roundRobinBid(agent);
    if (!this.hasSoftRoundTarget() && this.roundRobinQueue.length === 0) {
      this.lastPrompt = `${this.lastPrompt}\n\n[QUORUM WRAP UP] You are the final scheduled speaker. Give your concrete conclusion and explicitly record any unresolved disagreement for Continue Session.`;
    }
    if (this.phase === "idle") await this.transition("collecting_bids", { epoch: this.epoch, scheduler: "round-robin" });
    await this.transition("arbitrating", { epoch: this.epoch, scheduler: "round-robin" });
    await this.append("speaker_selected", {
      policyVersion: "round-robin-v1",
      winner: {
        bid,
        score: 1,
        components: {
          base: 1,
          capability: 0,
          userMention: 0,
          waiting: 0,
          recentSpeakerPenalty: 0,
          rebuttalBonus: 0,
          confidenceTieBreaker: 0,
        },
      },
      candidates: [],
      scheduler: "round-robin",
    }, "debug");
    await this.grantAgent(agent, "round-robin", bid);
  }

  private roundRobinBid(
    agent: ISpeakerAgent,
    kind: Bid["kind"] = "answer",
    rationale = "round-robin scheduler",
  ): Bid {
    return {
      bidId: ulid(),
      agentId: agent.id,
      epoch: this.epoch,
      kind,
      confidence: 1,
      createdAtSeq: this.opts.log.headSeq,
      expiresAfterRound: this.epoch + 1,
      revision: 0,
      rationale,
    };
  }

  private async continueAfterWriteFloor(): Promise<void> {
    if (this.active || this.humanHoldsWriteFloor) return;
    if (this.wrapUpActive && this.wrapUpQueue.length) {
      await this.grantNextWrapUpSpeaker();
      return;
    }
    if (this.isRoundRobin() && this.roundRobinQueue.length) {
      await this.grantNextRoundRobinSpeaker();
      return;
    }
    if (this.pendingBids.size) await this.arbitrateIfPossible();
  }

  private async persistDelta(
    agent: ISpeakerAgent,
    turnId: string,
    generation: number,
    offset: number,
    delta: Exclude<AgentDelta, { type: "done" }>,
  ): Promise<number> {
    if (delta.type === "text") {
      const nextOffset = offset + delta.text.length;
      await this.append("turn_output_chunk", { turnId, generation, offset, text: delta.text }, "participant", {
        author: { kind: "agent", id: agent.id, display: agent.descriptor.display },
        turnId,
      });
      await this.append("message", { text: delta.text }, "participant", {
        author: { kind: "agent", id: agent.id, display: agent.descriptor.display },
        turnId,
      });
      return nextOffset;
    }
    if (delta.type === "thinking") {
      await this.append("thinking", { text: delta.text, partial: true }, "participant", {
        author: { kind: "agent", id: agent.id, display: agent.descriptor.display },
        turnId,
      });
      return offset;
    }
    if (delta.type === "tool_call") {
      await this.append("tool_call", { tool: delta.tool, args: delta.args, callId: delta.callId ?? ulid() }, "participant", {
        author: { kind: "agent", id: agent.id, display: agent.descriptor.display },
        turnId,
      });
      return offset;
    }
    await this.append("tool_result", delta, "participant", {
      author: { kind: "agent", id: agent.id, display: agent.descriptor.display },
      turnId,
    });
    return offset;
  }

  private runtime(): AgentRuntime {
    return {
      callTool: (req: ToolCallRequest): Promise<ToolCallResult> => this.requestToolApproval(req),
      readContext: async (seq: number): Promise<ContextSnapshot> => ({
        seq: this.opts.log.headSeq,
        events: this.opts.log.replay(seq),
      }),
      writeSharedMemory: async (cmd: SharedMemoryCommand): Promise<WriteResult> => {
        const key = `${cmd.namespace}:${cmd.key}`;
        const current = this.sharedMemory.get(key);
        if (cmd.expectedVersion !== undefined && current?.version !== cmd.expectedVersion) {
          return { ok: false, error: "version mismatch" };
        }
        const persisted = this.opts.log.writeSharedMemory(cmd);
        if (!persisted.ok) return persisted;
        const version = persisted.version ?? (current?.version ?? 0) + 1;
        this.sharedMemory.set(key, { version, value: cmd.value });
        await this.mailbox.enqueue("sharedMemoryWrite", () =>
          this.append("system", {
            level: "info",
            text: `shared memory written: ${cmd.namespace}/${cmd.key}`,
            namespace: cmd.namespace,
            key: cmd.key,
            version,
          }, "debug"),
        );
        return { ok: true, version };
      },
    };
  }

  private contextBundle(): string {
    const headSeq = this.opts.log.headSeq;
    const summaries = this.opts.log.readWorkingMemorySummaries();
    const recent = this.opts.log
      .replay(0)
      .filter((event) => CONTEXT_EVENT_TYPES.has(event.type))
      .slice(-30);
    const active = this.active ? `${this.active.speakerId}/${this.active.turnId}` : "none";
    const pendingApprovals = [...this.pendingToolApprovals.entries()]
      .map(([callId, pending]) => `${pending.tool} [${callId}]`)
      .join(", ") || "none";
    const sharedMemoryLines = this.sharedMemory.size
      ? [...this.sharedMemory.entries()].map(([key, item]) => `- ${key} v${item.version}: ${JSON.stringify(item.value).slice(0, 500)}`).join("\n")
      : "- none";
    const summaryLines = summaries.length
      ? summaries.slice(-5).map((summary) =>
        `- #${summary.sourceFromSeq}-#${summary.sourceToSeq} ${summary.summaryId} hash=${summary.sourceHash.slice(0, 12)}: ${summary.content}`,
      ).join("\n")
      : "- none";
    const eventLines = recent.length
      ? recent.map((event) => {
        const body = event.body as Record<string, unknown>;
        const safeBody = Array.isArray(body.attachments)
          ? { ...body, attachments: body.attachments.map((item: any) => ({ id: item.id, name: item.name, mimeType: item.mimeType, sizeBytes: item.sizeBytes })) }
          : body;
        const text = typeof body.text === "string" ? body.text : JSON.stringify(safeBody);
        return `- #${event.seq} ${event.type} ${event.author.id}: ${text.slice(0, 500)}`;
      }).join("\n")
      : "- none";
    const continuityAnchors = {
      sessionId: this.opts.sessionId,
      headSeq,
      summaryHashes: summaries.slice(-5).map((summary) => ({
        range: [summary.sourceFromSeq, summary.sourceToSeq],
        hash: summary.sourceHash,
      })),
      recentEvents: recent.map((event) => ({ seq: event.seq, id: event.id, type: event.type, author: event.author.id })),
    };
    return [
      "## Shared Session Continuity Context",
      "This context is reconstructed from the session host's authoritative append-only event log. It is not native model hidden state.",
      "The host application, Session metadata, participant ids, and workspace path are operational metadata, not the user's subject.",
      `Context checksum: ${shortHash(continuityAnchors)}`,
      `Session: ${this.opts.title} (${this.opts.sessionId})`,
      `Head seq: ${headSeq}`,
      `Workspace: ${this.opts.workspacePath ?? "none"}`,
      `Phase: ${this.phase}; epoch: ${this.epoch}; active: ${active}; lastTurn: ${this.lastTurnId ?? "none"}`,
      `Participants: ${this.participants().map((participant) => `${participant.id}(${participant.kind})`).join(", ")}`,
      `Pending approvals: ${pendingApprovals}`,
      "",
      "Working memory summaries:",
      summaryLines,
      "",
      "Shared memory:",
      sharedMemoryLines,
      "",
      "Recent authoritative events:",
      eventLines,
      "",
      "Continuity / error-control rules:",
      "- Treat this continuity context as authoritative over native model memory when they conflict.",
      "- Preserve the session lineage by grounding claims in the listed seq ranges, hashes, and recent events.",
      "- Do not silently fill gaps from memory. If a required fact is absent or ambiguous, say what is uncertain.",
      "- If the user asks to continue prior work, continue from the latest head seq and avoid re-deciding settled points unless new evidence appears.",
      "- Do not assume the user's topic concerns the host application or workspace project unless the human prompt explicitly says so.",
      "",
      "Response presentation capabilities:",
      "- The chat renders GitHub-flavored Markdown, including headings, lists, task lists, tables, blockquotes, links, images, and fenced code blocks.",
      "- When a diagram or data chart materially improves the answer, use a fenced `mermaid` block. Mermaid supports flowcharts, sequence diagrams, pie charts, and XY charts.",
      "- Keep a concise textual conclusion alongside any visual. Do not use raw HTML or per-diagram Mermaid configuration directives.",
    ].join("\n");
  }

  private boundedTranscript(): RoomEvent[] {
    const headSeq = this.opts.log.headSeq;
    const afterSeq = this.lastCompactedSeq > 0
      ? this.lastCompactedSeq
      : Math.max(0, headSeq - 60);
    return this.opts.log.replay(afterSeq);
  }

  private async requestToolApproval(req: ToolCallRequest): Promise<ToolCallResult> {
    const callId = req.callId ?? ulid();
    const signal = this.active?.ac.signal;
    await this.mailbox.enqueue("toolCall", () =>
      this.append("tool_call", { tool: req.tool, args: req.args, callId }, "participant", this.activeAuthorOptions()),
    );
    const allow = await new Promise<boolean>((resolve) => {
      let settled = false;
      const finish = (value: boolean, terminalState?: "denied" | "expired") => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener("abort", denyOnAbort);
        this.pendingToolApprovals.delete(callId);
        if (terminalState) {
          void this.mailbox.enqueue("finishToolApproval", () =>
            this.append("system", {
              level: "warn",
              text: `tool approval ${terminalState}: ${req.tool} [${callId}]`,
              approval: { callId, tool: req.tool, args: req.args, state: terminalState },
            }, "system", { turnId: this.active?.turnId }),
          ).catch(() => undefined);
        }
        resolve(value);
      };
      const denyOnAbort = () => finish(false, "denied");
      const timer = setTimeout(() => finish(false, "expired"), Math.min(this.opts.turnTimeoutMs ?? 120_000, 60_000));
      signal?.addEventListener("abort", denyOnAbort, { once: true });
      this.pendingToolApprovals.set(callId, { tool: req.tool, resolve: finish });
      void this.mailbox.enqueue("requestToolApproval", () =>
        this.append("system", {
          level: "warn",
          text: `approval needed: ${req.tool} ${JSON.stringify(req.args ?? {}).slice(0, 2_000)} [${callId}] — approve or deny`,
          approval: { callId, tool: req.tool, args: req.args, state: "requested" },
        }, "system", { turnId: this.active?.turnId }),
      ).catch(() => {
        finish(false);
      });
    });
    const result = allow
      ? await this.executeApprovedTool(callId, req)
      : { callId, ok: false, stderr: "denied by human", exitCode: 1 };
    await this.mailbox.enqueue("toolResult", () =>
      this.append("tool_result", result, "participant", this.activeAuthorOptions()),
    ).catch(() => undefined);
    return result;
  }

  private async executeApprovedTool(callId: string, req: ToolCallRequest): Promise<ToolCallResult> {
    const name = normalizeToolName(req.tool);
    if (!isRoomTool(name)) {
      if (this.opts.toolExecutor) {
        return this.opts.toolExecutor.execute({ ...req, callId }, {
          sessionId: this.opts.sessionId,
          turnId: this.active?.turnId,
          speakerId: this.active?.speakerId,
          workspacePath: this.opts.workspacePath,
        });
      }
      return {
        callId,
        ok: false,
        stderr: `tool execution backend not wired for ${req.tool}`,
        exitCode: 1,
      };
    }

    const args = req.args && typeof req.args === "object" ? req.args as Record<string, unknown> : {};
    const out = runRoomTool(name, args, { readRoom: (sinceSeq) => this.opts.log.replay(sinceSeq) });
    for (const event of out.events) {
      await this.mailbox.enqueue("roomToolEvent", () =>
        this.append(event.type, event.body, event.visibility ?? "participant", {
          ...this.activeAuthorOptions(),
          addressedTo: event.addressedTo,
          replyTo: event.replyTo,
        }),
      );
    }
    return { callId, ok: true, stdout: out.reply, exitCode: 0 };
  }

  private activeAuthorOptions(): Partial<Pick<RoomEvent, "author" | "turnId">> {
    const active = this.active;
    if (!active) return {};
    const agent = this.byId.get(active.speakerId);
    return {
      author: {
        kind: "agent",
        id: active.speakerId,
        display: agent?.descriptor.display ?? active.speakerId,
      },
      turnId: active.turnId,
    };
  }

  private participants(): ParticipantDescriptor[] {
    return [...(this.opts.humans ?? []), ...this.opts.agents.map((agent) => agent.descriptor)];
  }

  private humanAuthor(): ParticipantDescriptor {
    return this.opts.humans?.[0] ?? { kind: "human", id: "human", display: "Human", status: "idle" };
  }

  private agentCapabilities(agent: ISpeakerAgent): Capabilities {
    return agent.capabilities?.() ?? { canEditFiles: false, canRunCommands: false, supportsToolApproval: false, nativeTools: [] };
  }

  private bumpWaiting(speakerId: string): void {
    for (const agent of this.opts.agents) {
      this.waitingRounds.set(agent.id, agent.id === speakerId ? 0 : (this.waitingRounds.get(agent.id) ?? 0) + 1);
    }
  }

  private async transition(to: SessionPhase, payload: Record<string, unknown> = {}): Promise<void> {
    const from = this.phase;
    assertTransition(from, to);
    this.phase = to;
    await this.append("phase_changed", { from, to, ...payload });
  }

  private append(
    type: RoomEvent["type"],
    body: unknown,
    visibility: RoomEvent["visibility"] = "participant",
    opts: Partial<Pick<RoomEvent, "author" | "turnId" | "replyTo" | "addressedTo">> = {},
  ): Promise<RoomEvent> {
    return this.opts.log.append({
      author: opts.author ?? systemAuthor,
      type,
      body,
      turnId: opts.turnId,
      replyTo: opts.replyTo,
      addressedTo: opts.addressedTo,
      visibility,
    });
  }
}

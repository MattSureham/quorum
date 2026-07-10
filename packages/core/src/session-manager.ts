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
} from "@quorum/protocol";
import type { EventLog } from "./event-log.js";
import { ulid } from "./ids.js";
import { CommandMailbox } from "./command-mailbox.js";
import { Arbiter, type ArbitrationDecision } from "./arbiter.js";
import { assertTransition, projectSessionState } from "./session-state.js";
import { isRoomTool, normalizeToolName, runRoomTool } from "./room-tools.js";
import { createWorkingMemorySummary } from "./memory.js";
import type { ToolExecutor } from "./tool-executor.js";

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
  toolExecutor?: ToolExecutor;
  memory?: {
    autoCompact?: boolean;
    minEvents?: number;
    minSeqGap?: number;
    keepRecentEvents?: number;
  };
}

export interface SessionSnapshot {
  phase: SessionPhase;
  epoch: number;
  activeTurn?: { turnId: string; speakerId: string; generation: number };
  pendingBids: Bid[];
  lastTurnId?: string;
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
  private lastPrompt = "";
  private running = false;
  private readonly pendingToolApprovals = new Map<string, { tool: string; resolve: (allow: boolean) => void }>();
  private lastCompactedSeq = 0;

  constructor(private readonly opts: SessionManagerOptions) {
    for (const agent of opts.agents) this.byId.set(agent.id, agent);
    this.arbiter = opts.arbiter ?? new Arbiter();
    if (opts.log.headSeq > 0) {
      const projected = projectSessionState(opts.log.replay(0));
      this.epoch = projected.epoch;
      this.lastTurnId = projected.lastTurnId;
    }
  }

  start(): void {
    this.running = true;
  }

  async stop(): Promise<void> {
    this.running = false;
    this.mailbox.stop();
    for (const pending of this.pendingToolApprovals.values()) pending.resolve(false);
    this.pendingToolApprovals.clear();
    if (this.active) {
      this.active.ac.abort();
      await this.append("turn_cancelled", { turnId: this.active.turnId, reason: "session stopped" }, "system");
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
    await this.mailbox.enqueue("submitUserPrompt", async () => {
      if (!this.running) this.running = true;
      this.lastPrompt = text;
      this.epoch++;
      await this.append("message", { text, ...(attachments.length ? { attachments } : {}) }, "participant", {
        author: { kind: "human", id: "human", display: "Human" },
        addressedTo,
      });

      if (this.phase === "speaking" || this.phase === "speaker_granted") {
        return;
      }

      await this.transition("collecting_bids", { epoch: this.epoch });
    });

    await this.collectAndMaybeArbitrate(text);
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
      transcript: this.opts.log.replay(0),
      lastTurnId: this.lastTurnId,
    };

    const bids = await Promise.all(
      [...this.byId.values()].map((agent) =>
        agent.bid(ctx).then((bid) => bid).catch(() => undefined),
      ),
    );

    await this.mailbox.enqueue("collectAgentBids", async () => {
      for (const bid of bids) {
        if (!bid || bid.epoch !== this.epoch) continue;
        this.pendingBids.set(bid.bidId, bid);
        await this.append("bid_submitted", { bid }, "debug", {
          author: { kind: "agent", id: bid.agentId, display: bid.agentId },
        });
      }
    });
  }

  private async arbitrateIfPossible(): Promise<void> {
    if (this.active || this.phase === "speaking" || this.phase === "speaker_granted") return;
    if (this.pendingBids.size === 0) {
      await this.transition("idle", { reason: "no bids" });
      return;
    }

    await this.transition("arbitrating", { epoch: this.epoch });
    const decision = this.arbiter.decide({
      participants: this.participants(),
      bids: [...this.pendingBids.values()],
      lastSpeakerId: this.lastTurnId,
      recentSpeakerCounts: this.recentSpeakerCounts,
      waitingRounds: this.waitingRounds,
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

    const turnId = ulid();
    const generation = Date.now();
    const ac = new AbortController();
    this.active = { turnId, speakerId: agent.id, generation, ac };
    this.bumpWaiting(agent.id);
    await this.transition("speaker_granted", { turnId, speakerId: agent.id, bid: winner.bid });
    await this.append("floor_grant", {
      participantId: agent.id,
      turnId,
      reason: winner.bid.kind,
      deadlineMs: this.opts.turnTimeoutMs ?? 120_000,
    });
    void this.runTurn(agent, turnId, generation, ac);
  }

  private async runTurn(agent: ISpeakerAgent, turnId: string, generation: number, ac: AbortController): Promise<void> {
    const timeout = setTimeout(() => ac.abort(), this.opts.turnTimeoutMs ?? 120_000);
    let offset = 0;
    let outcome: "done" | "cancelled" | "failed" = "done";

    await this.mailbox.enqueue("turnStarted", async () => {
      await this.transition("speaking", { turnId, speakerId: agent.id, generation });
      await this.append("turn_started", { turnId, speakerId: agent.id, generation });
    });

    try {
      const ctx: TurnContext = {
        sessionId: this.opts.sessionId,
        turnId,
        generation,
        epoch: this.epoch,
        speakerId: agent.id,
        prompt: this.lastPrompt,
        contextSeq: this.opts.log.headSeq,
        participants: this.participants(),
        transcript: this.opts.log.replay(0),
        contextBundle: this.contextBundle(),
      };

      for await (const delta of agent.speak(ctx, this.runtime(), ac.signal)) {
        if (ac.signal.aborted) {
          outcome = "cancelled";
          break;
        }
        if (delta.type === "done") break;
        await this.mailbox.enqueue("turnDelta", async () => {
          if (!this.active || this.active.turnId !== turnId || this.active.generation !== generation) return;
          offset = await this.persistDelta(agent, turnId, generation, offset, delta);
        });
      }
    } catch {
      outcome = ac.signal.aborted ? "cancelled" : "failed";
    } finally {
      clearTimeout(timeout);
      if (ac.signal.aborted && outcome === "done") outcome = "cancelled";
      await this.mailbox.enqueue("finishTurn", async () => {
        if (!this.active || this.active.turnId !== turnId || this.active.generation !== generation) return;
        this.lastTurnId = turnId;
        this.active = undefined;
        this.recentSpeakerCounts.set(agent.id, (this.recentSpeakerCounts.get(agent.id) ?? 0) + 1);
        const eventType = outcome === "done" ? "turn_completed" : outcome === "cancelled" ? "turn_cancelled" : "turn_failed";
        await this.append(eventType, { turnId, speakerId: agent.id, generation, offset });
        await this.append("floor_release", { turnId, reason: outcome === "done" ? "done" : outcome });
        await this.maybeAutoCompactWorkingMemory();
        await this.transition("settling", { turnId, settlingWindowMs: this.opts.settlingWindowMs ?? 400 });
        void this.settleAndArbitrate();
      });
    }
  }

  private async settleAndArbitrate(): Promise<void> {
    await delay(this.opts.settlingWindowMs ?? 400);
    if (!this.running) return;
    await this.mailbox.enqueue("settleAndArbitrate", async () => {
      if (this.phase !== "settling") return;
      for (const bid of this.pendingBids.values()) {
        await this.append("bid_settled", { bidId: bid.bidId, action: "confirmed" }, "debug", {
          author: { kind: "agent", id: bid.agentId, display: bid.agentId },
        });
      }
      await this.arbitrateIfPossible();
    }).catch(() => undefined);
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
        const version = (current?.version ?? 0) + 1;
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
    const summaryLines = summaries.length
      ? summaries.slice(-5).map((summary) =>
        `- #${summary.sourceFromSeq}-#${summary.sourceToSeq} ${summary.summaryId} hash=${summary.sourceHash.slice(0, 12)}: ${summary.content}`,
      ).join("\n")
      : "- none";
    const eventLines = recent.length
      ? recent.map((event) => {
        const body = event.body as Record<string, unknown>;
        const text = typeof body.text === "string" ? body.text : JSON.stringify(body);
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
      "## Quorum Context Bundle",
      "This context is reconstructed from Quorum's authoritative append-only event log. It is not native model hidden state.",
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
      "Recent authoritative events:",
      eventLines,
      "",
      "Continuity / error-control rules:",
      "- Treat this Quorum context bundle as authoritative over native model memory when they conflict.",
      "- Preserve the session lineage by grounding claims in the listed seq ranges, hashes, and recent events.",
      "- Do not silently fill gaps from memory. If a required fact is absent or ambiguous, say what is uncertain.",
      "- If the user asks to continue prior work, continue from the latest head seq and avoid re-deciding settled points unless new evidence appears.",
    ].join("\n");
  }

  private async requestToolApproval(req: ToolCallRequest): Promise<ToolCallResult> {
    const callId = req.callId ?? ulid();
    await this.mailbox.enqueue("toolCall", () =>
      this.append("tool_call", { tool: req.tool, args: req.args, callId }, "participant", this.activeAuthorOptions()),
    );
    const allow = await new Promise<boolean>((resolve) => {
      this.pendingToolApprovals.set(callId, { tool: req.tool, resolve });
      void this.mailbox.enqueue("requestToolApproval", () =>
        this.append("system", {
          level: "warn",
          text: `approval needed: ${req.tool} [${callId}] — approve or deny`,
          approval: { callId, tool: req.tool, state: "requested" },
        }, "system", { turnId: this.active?.turnId }),
      ).catch(() => {
        this.pendingToolApprovals.delete(callId);
        resolve(false);
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

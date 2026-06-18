import type { RoomEvent, ConductorPolicyConfig, ParticipantDescriptor } from "@quorum/protocol";
import type { EventLog } from "./event-log.js";
import {
  type Participant, type ConductorPolicy, type WorkspaceManager,
  type TurnInput, type WriteLease,
} from "./types.js";
import { buildProtocol } from "./projection.js";
import { ulid } from "./ids.js";

type State = "idle" | "active" | "collecting";

export interface ConductorOptions {
  roomId: string;
  roomTitle: string;
  log: EventLog;
  participants: Participant[];
  policy: ConductorPolicy;
  config: ConductorPolicyConfig;
  primary?: string;
  workspace?: WorkspaceManager;
  workspacePath?: string;
  recentWindow?: number;
}

function lastSeqByAuthor(events: RoomEvent[], id: string): number {
  let s = 0;
  for (const e of events) if (e.author.id === id && e.type === "message") s = e.seq;
  return s;
}

/**
 * Decides who holds the speaking floor and runs their turn.
 * Single-threaded event handling via an internal drain loop; turns run detached
 * so the loop can still observe (and act on) a human interrupt mid-turn.
 *
 * Hard rules:
 *  - A human message/interrupt always preempts the active turn and resets the topic.
 *  - No turn is ever granted except through a policy decision (no agent self-triggers).
 *  - maxTurnsPerTopic bounds any agent-to-agent exchange.
 */
export class Conductor {
  private state: State = "idle";
  private running = false;
  private readonly queue: RoomEvent[] = [];
  private draining = false;
  private pendingFloor: RoomEvent[] = [];
  private topicTurns = 0;
  private lastSpeakerId?: string;
  private yieldedAnnounced = false;
  private current?: {
    turnId: string;
    participantId: string;
    participant: Participant;
    ac: AbortController;
  };
  private off?: () => void;
  private readonly byId = new Map<string, Participant>();
  private policy: ConductorPolicy;
  private cfg: ConductorPolicyConfig;

  constructor(private readonly opts: ConductorOptions) {
    for (const p of opts.participants) this.byId.set(p.id, p);
    this.policy = opts.policy;
    this.cfg = opts.config;
  }

  setPolicy(policy: ConductorPolicy, config: ConductorPolicyConfig): void {
    this.policy = policy;
    this.cfg = config;
  }

  start(): void {
    this.running = true;
    this.off = this.opts.log.on((e) => this.enqueue(e));
  }

  async stop(): Promise<void> {
    this.running = false;
    this.off?.();
    if (this.current) {
      this.current.ac.abort();
      await this.byId.get(this.current.participantId)?.interrupt("conductor stop");
    }
  }

  private descriptors(): ParticipantDescriptor[] {
    return this.opts.participants.map((p) => p.descriptor);
  }

  private enqueue(e: RoomEvent): void {
    this.queue.push(e);
    if (!this.draining) void this.drain();
  }

  private async drain(): Promise<void> {
    this.draining = true;
    while (this.running && this.queue.length) {
      const e = this.queue.shift()!;
      try {
        await this.handle(e);
      } catch {
        /* swallow; a bad handler must not kill the loop */
      }
    }
    this.draining = false;
  }

  private async handle(e: RoomEvent): Promise<void> {
    // Human preemption — highest priority.
    if (e.author.kind === "human" && (e.type === "message" || e.type === "interrupt")) {
      this.topicTurns = 0;
      this.yieldedAnnounced = false;
      this.pendingFloor = []; // raised hands are per-topic; a new human turn clears stale ones
      if (this.state === "active" && this.current) {
        this.current.ac.abort();
        await this.byId.get(this.current.participantId)?.interrupt("human spoke");
        return; // floor_release(interrupted) from the running turn drives the next decision
      }
      this.state = "collecting";
      await this.maybeGrant();
      return;
    }

    if (e.type === "floor_request") {
      this.pendingFloor.push(e);
      if (this.state !== "active") await this.maybeGrant();
      return;
    }

    if (e.type === "floor_release") {
      this.state = "collecting";
      await this.maybeGrant();
      return;
    }

    if (e.type === "message" && e.author.kind === "agent") {
      this.lastSpeakerId = e.author.id;
      return; // decisions happen at floor_release, not on each agent message
    }
    // everything else: not a control signal
  }

  private async maybeGrant(): Promise<void> {
    if (!this.running || this.state === "active") return;
    const window = this.opts.recentWindow ?? 40;
    const recent = this.opts.log.replay(Math.max(0, this.opts.log.headSeq - window));
    const decision = await this.policy.decide({
      recent,
      participants: this.descriptors(),
      pendingFloorRequests: [...this.pendingFloor],
      lastSpeakerId: this.lastSpeakerId,
      turnsInCurrentTopic: this.topicTurns,
      primary: this.opts.primary,
      config: this.cfg,
    });

    if (decision.kind !== "grant") {
      this.state = "idle";
      if (this.topicTurns > 0 && !this.yieldedAnnounced) {
        this.yieldedAnnounced = true;
        await this.opts.log.append({
          author: { kind: "system", id: "conductor", display: "Conductor" },
          type: "system",
          body: { level: "info", text: `floor open \u2014 ${decision.reason}` },
        });
      }
      return;
    }
    void this.launchTurn(decision.participantId, decision.reason);
  }

  private async launchTurn(pid: string, reason: string): Promise<void> {
    const participant = this.byId.get(pid);
    if (!participant) {
      this.state = "idle";
      return;
    }
    // set ACTIVE synchronously so a queued event can't double-grant
    this.state = "active";
    this.topicTurns++;
    this.pendingFloor = this.pendingFloor.filter((r) => r.author.id !== pid);
    const turnId = ulid();
    const ac = new AbortController();
    this.current = { turnId, participantId: pid, participant, ac };

    await this.opts.log.append({
      author: { kind: "system", id: "conductor", display: "Conductor" },
      type: "floor_grant",
      body: { participantId: pid, turnId, reason, deadlineMs: this.cfg.turnDeadlineMs },
    });

    const lastSpoke = lastSeqByAuthor(this.opts.log.replay(0), pid);
    const projection = this.opts.log.replay(lastSpoke);

    const caps = participant.capabilities();
    let lease: WriteLease | undefined;
    if (caps.canEditFiles && this.opts.workspace) {
      lease = await this.opts.workspace.acquireWriteFloor(turnId, pid);
      await this.opts.workspace.snapshotPre();
    }

    let outcome: "done" | "interrupted" | "timeout" | "error" = "done";
    let lastEventId: string | undefined;
    const deadline = setTimeout(() => {
      outcome = "timeout";
      ac.abort();
      void participant.interrupt("turn deadline");
    }, this.cfg.turnDeadlineMs);

    try {
      const input: TurnInput = {
        turnId,
        roomTitle: this.opts.roomTitle,
        self: participant.descriptor,
        participants: this.descriptors(),
        projection,
        protocol: buildProtocol(participant.descriptor, this.descriptors()),
        workspacePath: this.opts.workspacePath,
        signal: ac.signal,
      };
      for await (const partial of participant.takeTurn(input)) {
        if (ac.signal.aborted) {
          if (outcome === "done") outcome = "interrupted";
          break;
        }
        const ev = await this.opts.log.append({
          author: {
            kind: participant.descriptor.kind,
            id: pid,
            display: participant.descriptor.display,
          },
          type: partial.type,
          body: partial.body,
          replyTo: partial.replyTo,
          addressedTo: partial.addressedTo,
          turnId,
          visibility: partial.visibility,
        });
        lastEventId = ev.id;
        if (ev.type === "message") this.lastSpeakerId = pid;
      }
      if (ac.signal.aborted && outcome === "done") outcome = "interrupted";
    } catch {
      outcome = ac.signal.aborted ? "interrupted" : "error";
    } finally {
      clearTimeout(deadline);
      if (caps.canEditFiles && this.opts.workspace && lastEventId) {
        const cp = await this.opts.workspace.checkpoint(turnId, pid, lastEventId).catch(() => null);
        if (cp) {
          await this.opts.log.append({
            author: { kind: "system", id: "workspace", display: "Workspace" },
            type: "checkpoint",
            body: cp,
            turnId,
          });
        }
      }
      lease?.release();
      this.current = undefined;
      await this.opts.log.append({
        author: { kind: "system", id: "conductor", display: "Conductor" },
        type: "floor_release",
        body: { turnId, reason: outcome },
      });
    }
  }
}

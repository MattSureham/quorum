import type {
  AgentDelta,
  AgentHealth,
  AgentRuntime,
  Bid,
  BidContext,
  ISpeakerAgent,
  ParticipantDescriptor,
  TurnContext,
} from "@quorum/protocol";
import type { Participant, TurnInput } from "./types.js";
import { ulid } from "./ids.js";

export class LegacyAgentAdapter implements ISpeakerAgent {
  readonly id: string;
  readonly descriptor: ParticipantDescriptor;

  constructor(
    private readonly legacy: Participant,
    private readonly opts: {
      workspacePath?: string;
      nativeSessionStore?: {
        read(sessionId: string, agentId: string): string | undefined;
        write(sessionId: string, agentId: string, nativeSessionId: string): void;
      };
      onNativeSessionResumeFailed?: (agentId: string, detail: string) => void;
    } = {},
  ) {
    this.id = legacy.id;
    this.descriptor = legacy.descriptor;
  }

  async health(): Promise<AgentHealth> {
    return { ok: true, status: "idle" };
  }

  capabilities() {
    return this.legacy.capabilities();
  }

  async shutdown(): Promise<void> {
    await this.legacy.dispose?.();
  }

  async bid(ctx: BidContext): Promise<Bid> {
    return {
      bidId: ulid(),
      agentId: this.id,
      epoch: ctx.epoch,
      kind: ctx.lastTurnId ? "followup" : "answer",
      confidence: 0.5,
      createdAtSeq: ctx.transcript.at(-1)?.seq ?? 0,
      expiresAfterRound: ctx.epoch + 1,
      revision: 0,
      rationale: "legacy adapter default bid",
    };
  }

  async *speak(turn: TurnContext, _runtime: AgentRuntime, signal: AbortSignal): AsyncGenerator<AgentDelta> {
    const input: TurnInput = {
      turnId: turn.turnId,
      roomTitle: "Quorum",
      self: this.legacy.descriptor,
      participants: turn.participants,
      projection: turn.transcript,
      protocol: "",
      contextBundle: turn.contextBundle,
      attachments: turn.attachments,
      workspacePath: this.opts.workspacePath,
      nativeSessionId: this.opts.nativeSessionStore?.read(turn.sessionId, this.id),
      onNativeSessionId: (sessionId) => this.opts.nativeSessionStore?.write(turn.sessionId, this.id, sessionId),
      onNativeSessionResumeFailed: (detail) => this.opts.onNativeSessionResumeFailed?.(this.id, detail),
      signal,
    };

    for await (const event of this.legacy.takeTurn(input)) {
      if (signal.aborted) return;
      if (event.type === "message") {
        const text = typeof (event.body as any)?.text === "string" ? (event.body as any).text : JSON.stringify(event.body);
        yield { type: "text", text };
      } else if (event.type === "thinking") {
        const text = typeof (event.body as any)?.text === "string" ? (event.body as any).text : JSON.stringify(event.body);
        yield { type: "thinking", text };
      } else if (event.type === "tool_call") {
        const body = event.body as any;
        yield { type: "tool_call", tool: body.tool ?? body.name ?? "tool", args: body.args, callId: body.callId };
      } else if (event.type === "tool_result") {
        const body = event.body as any;
        yield { type: "tool_result", callId: body.callId, ok: !!body.ok, stdout: body.stdout, exitCode: body.exitCode };
      } else if (event.type === "system" && (event.body as any)?.level === "error") {
        const body = event.body as any;
        yield {
          type: "error",
          message: typeof body.text === "string" ? body.text : "agent turn failed",
          category: typeof body.category === "string" ? body.category : "adapter_error",
          detail: typeof body.detail === "string" ? body.detail : undefined,
        };
      }
    }
    yield { type: "done" };
  }
}

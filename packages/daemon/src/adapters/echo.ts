import type { TurnInput, PartialRoomEvent, Participant } from "@quorum/core";
import type { ParticipantDescriptor, Capabilities, FloorIntent } from "@quorum/protocol";

export interface EchoLine {
  delayMs?: number;
  type?: "message" | "thinking" | "floor_request";
  text?: string;
  addressedTo?: string[];
  intent?: FloorIntent;
}
export type EchoScript = (args: { input: TurnInput; turnIndex: number }) => EchoLine[] | Promise<EchoLine[]>;

function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const t = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => { clearTimeout(t); resolve(); }, { once: true });
  });
}

/**
 * A deterministic, dependency-free fake agent. Drives local tests and the demo
 * without any real CLI installed. Real adapters (claude-code, codex) replace this.
 */
export class EchoAdapter implements Participant {
  private aborted = false;
  private turnIndex = 0;

  constructor(
    public readonly descriptor: ParticipantDescriptor,
    private readonly script: EchoScript,
  ) {}

  get id(): string { return this.descriptor.id; }

  capabilities(): Capabilities {
    return { canEditFiles: false, canRunCommands: false, supportsToolApproval: false, nativeTools: ["echo"] };
  }

  async *takeTurn(input: TurnInput): AsyncIterable<PartialRoomEvent> {
    this.aborted = false;
    const lines = await this.script({ input, turnIndex: this.turnIndex++ });
    for (const ln of lines) {
      if (input.signal.aborted || this.aborted) return;
      if (ln.delayMs) await abortableDelay(ln.delayMs, input.signal);
      if (input.signal.aborted || this.aborted) return;
      if (ln.type === "floor_request") {
        yield { type: "floor_request", body: { reason: ln.text ?? "continue", intent: ln.intent ?? "reply" } };
      } else if (ln.type === "thinking") {
        yield { type: "thinking", body: { text: ln.text ?? "" } };
      } else {
        yield { type: "message", body: { text: ln.text ?? "" }, addressedTo: ln.addressedTo };
      }
    }
  }

  async interrupt(): Promise<void> { this.aborted = true; }
}

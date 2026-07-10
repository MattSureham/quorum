import { renderProjection } from "@quorum/core";
import type { TurnInput, PartialRoomEvent, Participant } from "@quorum/core";
import type { ParticipantDescriptor, Capabilities } from "@quorum/protocol";

/** Shared helpers for real agent adapters (Claude Code, Codex, ...). */
export abstract class BaseAgentAdapter implements Participant {
  constructor(public readonly descriptor: ParticipantDescriptor) {}
  get id(): string { return this.descriptor.id; }

  abstract capabilities(): Capabilities;
  abstract takeTurn(input: TurnInput): AsyncIterable<PartialRoomEvent>;
  abstract interrupt(reason: string): Promise<void>;

  /** Render the room-transcript delta + protocol into the agent's turn prompt. */
  protected prompt(input: TurnInput): string {
    const rendered = renderProjection(input);
    return input.contextBundle ? `${input.contextBundle}\n\n${rendered}` : rendered;
  }
  protected msg(text: string, addressedTo?: string[]): PartialRoomEvent {
    return { type: "message", body: { text }, addressedTo };
  }
  protected think(text: string): PartialRoomEvent {
    return { type: "thinking", body: { text, partial: true } };
  }
}

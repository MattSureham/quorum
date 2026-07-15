import type { RoomEvent } from "@quorum/protocol";

const terminalTurnTypes = new Set<RoomEvent["type"]>([
  "turn_completed",
  "turn_failed",
  "turn_cancelled",
]);

export function latestTerminalTurnAfter(events: RoomEvent[], seq: number): RoomEvent | undefined {
  return [...events]
    .reverse()
    .find((event) => event.seq > seq && terminalTurnTypes.has(event.type));
}

import { describe, expect, it } from "vitest";
import type { RoomEvent } from "@quorum/protocol";
import { latestTerminalTurnAfter } from "./run-status.js";

function turnEvent(seq: number, type: "turn_completed" | "turn_failed" | "turn_cancelled"): RoomEvent {
  return {
    id: `event-${seq}`,
    roomId: "room",
    seq,
    ts: seq,
    author: { kind: "system", id: "session", display: "SessionManager" },
    type,
    body: { turnId: `turn-${seq}`, speakerId: "codex" },
    visibility: "system",
  };
}

describe("latestTerminalTurnAfter", () => {
  it("does not let an older failure override a later successful agent turn", () => {
    const latest = latestTerminalTurnAfter([
      turnEvent(2, "turn_failed"),
      turnEvent(3, "turn_completed"),
    ], 1);

    expect(latest?.type).toBe("turn_completed");
  });

  it("returns a newer failure after an earlier completion", () => {
    const latest = latestTerminalTurnAfter([
      turnEvent(2, "turn_completed"),
      turnEvent(3, "turn_failed"),
    ], 1);

    expect(latest?.type).toBe("turn_failed");
  });

  it("ignores terminal events from before the current prompt", () => {
    expect(latestTerminalTurnAfter([turnEvent(2, "turn_failed")], 2)).toBeUndefined();
  });
});

import { describe, expect, it } from "vitest";
import type { RoomEvent } from "@quorum/protocol";
import { latestTerminalTurnAfter, latestTurnLifecycleAfter } from "./run-status.js";

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

function startedEvent(seq: number, turnId: string): RoomEvent {
  return {
    id: `event-${seq}`,
    roomId: "room",
    seq,
    ts: seq,
    author: { kind: "system", id: "session", display: "SessionManager" },
    type: "turn_started",
    body: { turnId, speakerId: "codex" },
    turnId,
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

  it("does not let an older failed turn mask a newer running turn", () => {
    const failed = { ...turnEvent(3, "turn_failed"), turnId: "turn-old", body: { turnId: "turn-old", speakerId: "codex" } };
    const lifecycle = latestTurnLifecycleAfter([
      startedEvent(2, "turn-old"),
      failed,
      startedEvent(4, "turn-new"),
    ], 1);

    expect(lifecycle.active).toBe(true);
    expect(lifecycle.started?.turnId).toBe("turn-new");
    expect(lifecycle.terminal).toBeUndefined();
  });

  it("keeps an interrupt pending until the matching turn reaches a cancelled terminal", () => {
    const started = startedEvent(2, "turn-active");
    const interrupt: RoomEvent = {
      id: "event-3",
      roomId: "room",
      seq: 3,
      ts: 3,
      author: { kind: "human", id: "human", display: "Human" },
      type: "interrupt",
      body: { by: "human", hard: true },
      turnId: "turn-active",
      visibility: "room",
    };
    const stopping = latestTurnLifecycleAfter([started, interrupt], 1);
    expect(stopping).toMatchObject({ active: true, stopping: true, interrupt });

    const cancelled: RoomEvent = {
      ...turnEvent(4, "turn_cancelled"),
      turnId: "turn-active",
      body: { turnId: "turn-active", speakerId: "codex" },
    };
    const settled = latestTurnLifecycleAfter([started, interrupt, cancelled], 1);
    expect(settled.active).toBe(false);
    expect(settled.stopping).toBe(false);
    expect(settled.terminal?.type).toBe("turn_cancelled");
  });
});

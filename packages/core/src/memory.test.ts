import { describe, expect, it } from "vitest";
import type { RoomEvent } from "@quorum/protocol";
import { createWorkingMemorySummary } from "./memory.js";

const base = {
  roomId: "room",
  ts: 1,
  visibility: "room" as const,
};

describe("working memory summaries", () => {
  it("creates deterministic source metadata and extractive content", () => {
    const events: RoomEvent[] = [
      {
        ...base,
        id: "e2",
        seq: 2,
        author: { kind: "agent", id: "codex", display: "Codex" },
        type: "message",
        body: { text: "second" },
      },
      {
        ...base,
        id: "e1",
        seq: 1,
        author: { kind: "human", id: "human", display: "Human" },
        type: "message",
        body: { text: "first" },
      },
    ];

    const a = createWorkingMemorySummary({
      sessionId: "room",
      events,
      now: new Date("2026-01-01T00:00:00.000Z"),
    });
    const b = createWorkingMemorySummary({
      sessionId: "room",
      events: [...events].reverse(),
      now: new Date("2026-01-01T00:00:00.000Z"),
    });

    expect(a.sourceFromSeq).toBe(1);
    expect(a.sourceToSeq).toBe(2);
    expect(a.sourceHash).toBe(b.sourceHash);
    expect(a.content).toContain("#1 human: first");
    expect(a.content).toContain("#2 codex: second");
    expect(a.model).toBe("extractive-v1");
  });
});

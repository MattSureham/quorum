import { describe, it, expect } from "vitest";
import { runRoomTool, isRoomTool, normalizeToolName, ROOM_TOOLS } from "./room-tools.js";
import type { RoomEvent } from "@quorum/protocol";

describe("room tools (SPEC §9)", () => {
  it("raise_hand produces a floor_request with the given intent", () => {
    const out = runRoomTool("raise_hand", { reason: "want to rebut", intent: "rebut" });
    expect(out.events).toHaveLength(1);
    expect(out.events[0]!.type).toBe("floor_request");
    expect(out.events[0]!.body).toEqual({ reason: "want to rebut", intent: "rebut" });
    expect(out.reply).toContain("rebut");
  });

  it("raise_hand falls back to a safe intent", () => {
    const out = runRoomTool("raise_hand", { reason: "x", intent: "bogus" });
    expect((out.events[0]!.body as { intent: string }).intent).toBe("reply");
  });

  it("hand_off addresses the target so the policy grants them next", () => {
    const out = runRoomTool("hand_off", { to: "codex", note: "your turn" });
    expect(out.events[0]!.type).toBe("message");
    expect(out.events[0]!.addressedTo).toEqual(["codex"]);
  });

  it("hand_off without a target is a no-op with guidance", () => {
    const out = runRoomTool("hand_off", {});
    expect(out.events).toHaveLength(0);
    expect(out.reply).toMatch(/needs/);
  });

  it("request_review addresses a target when given", () => {
    const out = runRoomTool("request_review", { note: "check auth.ts", target: "claude" });
    expect(out.events[0]!.addressedTo).toEqual(["claude"]);
    expect((out.events[0]!.body as { text: string }).text).toContain("check auth.ts");
  });

  it("read_room emits no events and formats recent transcript", () => {
    const events: RoomEvent[] = [
      { id: "1", roomId: "r", seq: 5, ts: 0, author: { kind: "agent", id: "claude", display: "Claude" }, type: "message", body: { text: "hi" }, visibility: "room" },
    ];
    const out = runRoomTool("read_room", { sinceSeq: 4 }, { readRoom: (s) => events.filter((e) => e.seq > s) });
    expect(out.events).toHaveLength(0);
    expect(out.reply).toContain("#5 claude");
    expect(out.reply).toContain("hi");
  });

  it("post_note posts a plain message", () => {
    const out = runRoomTool("post_note", { text: "fyi" });
    expect(out.events[0]!.type).toBe("message");
    expect((out.events[0]!.body as { text: string }).text).toBe("fyi");
  });

  it("recognizes namespaced tool names", () => {
    expect(isRoomTool("room.raise_hand")).toBe(true);
    expect(isRoomTool("room__hand_off")).toBe(true);
    expect(normalizeToolName("room.raise_hand")).toBe("raise_hand");
    expect(isRoomTool("Bash")).toBe(false);
  });

  it("exposes all five tools", () => {
    expect(ROOM_TOOLS.map((t) => t.name).sort()).toEqual(
      ["hand_off", "post_note", "raise_hand", "read_room", "request_review"],
    );
  });
});

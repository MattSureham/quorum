import { describe, expect, it } from "vitest";
import { shouldHandleSocketMessage } from "./socket-message-filter.js";

describe("shouldHandleSocketMessage", () => {
  it("rejects every message emitted by a replaced WebSocket", () => {
    const oldSocket = {};
    const currentSocket = {};
    expect(shouldHandleSocketMessage(oldSocket, currentSocket, { t: "sessions" }, "room-b")).toBe(false);
    expect(shouldHandleSocketMessage(oldSocket, currentSocket, { t: "event", event: { roomId: "room-b" } }, "room-b")).toBe(false);
  });

  it("accepts only active-room events and continuation snapshots", () => {
    const socket = {};
    expect(shouldHandleSocketMessage(socket, socket, { t: "event", event: { roomId: "room-a" } }, "room-b")).toBe(false);
    expect(shouldHandleSocketMessage(socket, socket, { t: "event", event: { roomId: "room-b" } }, "room-b")).toBe(true);
    expect(shouldHandleSocketMessage(socket, socket, { t: "snapshot", room: { id: "room-a" } }, "room-b")).toBe(false);
    expect(shouldHandleSocketMessage(socket, socket, { t: "session_continued", room: { id: "room-b" } }, "room-b")).toBe(true);
  });

  it("allows the first snapshot when no active room has been selected", () => {
    const socket = {};
    expect(shouldHandleSocketMessage(socket, socket, { t: "snapshot", room: { id: "room-a" } }, "")).toBe(true);
  });
});

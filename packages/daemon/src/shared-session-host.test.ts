import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import WebSocket from "ws";
import type { Room, RoomEvent } from "@quorum/protocol";
import { startSharedSessionRoom } from "./shared-session-host.js";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(predicate: () => boolean, timeoutMs = 1_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await sleep(10);
  }
  throw new Error("timed out waiting for condition");
}

function connect(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.once("open", () => resolve(ws));
    ws.once("error", reject);
  });
}

function nextMessage(ws: WebSocket): Promise<any> {
  return new Promise((resolve) => {
    ws.once("message", (data) => resolve(JSON.parse(String(data))));
  });
}

describe("SharedSessionHost", () => {
  it("routes a human prompt through SessionManager and legacy echo adapter", async () => {
    const dir = await mkdtemp(join(tmpdir(), "quorum-shared-session-"));
    const room: Room = {
      id: "shared-room",
      title: "Shared session room",
      branch: "main",
      policy: { name: "free-for-all", maxTurnsPerTopic: 3, noConsecutive: true, turnDeadlineMs: 1_000 },
      participants: [
        { id: "human", kind: "human", display: "Human", status: "idle" },
        {
          id: "echo",
          kind: "agent",
          display: "Echo",
          adapter: "echo",
          adapterConfig: { text: "shared kernel response" },
          status: "idle",
        },
      ],
      createdAt: Date.now(),
    };
    const host = await startSharedSessionRoom(room, { dbPath: join(dir, "room.sqlite"), port: 0 });
    const events: RoomEvent[] = [];
    const off = host.log.on((event) => events.push(event));

    try {
      await host.session.submitUserPrompt("hello");
      await waitFor(() => events.some((event) => event.type === "turn_completed"));

      expect(events.some((event) => event.type === "phase_changed" && (event.body as any).to === "speaking")).toBe(true);
      expect(events.some((event) => event.type === "bid_submitted" && (event.body as any).bid.agentId === "echo")).toBe(true);
      expect(events.some((event) => event.type === "message" && event.author.id === "echo" && (event.body as any).text === "shared kernel response")).toBe(true);
    } finally {
      off();
      await host.stop();
    }
  });

  it("runs a three-agent open discussion through queued bids", async () => {
    const dir = await mkdtemp(join(tmpdir(), "quorum-shared-session-three-agent-"));
    const room: Room = {
      id: "three-agent-room",
      title: "Three agent room",
      branch: "main",
      policy: { name: "free-for-all", maxTurnsPerTopic: 6, noConsecutive: true, turnDeadlineMs: 1_000 },
      participants: [
        { id: "human", kind: "human", display: "Human", status: "idle" },
        { id: "alpha", kind: "agent", display: "Alpha", adapter: "echo", adapterConfig: { text: "alpha response" }, status: "idle" },
        { id: "bravo", kind: "agent", display: "Bravo", adapter: "echo", adapterConfig: { text: "bravo response" }, status: "idle" },
        { id: "charlie", kind: "agent", display: "Charlie", adapter: "echo", adapterConfig: { text: "charlie response" }, status: "idle" },
      ],
      createdAt: Date.now(),
    };
    const host = await startSharedSessionRoom(room, { dbPath: join(dir, "room.sqlite"), port: 0 });
    const events: RoomEvent[] = [];
    const off = host.log.on((event) => events.push(event));

    try {
      await host.session.submitUserPrompt("open discussion");
      await waitFor(() => {
        const speakers = new Set(
          events
            .filter((event) => event.type === "turn_completed")
            .map((event) => (event.body as any).speakerId),
        );
        return speakers.has("alpha") && speakers.has("bravo") && speakers.has("charlie");
      }, 2_000);

      const bidAgents = new Set(
        events
          .filter((event) => event.type === "bid_submitted")
          .map((event) => (event.body as any).bid.agentId),
      );
      expect(bidAgents).toEqual(new Set(["alpha", "bravo", "charlie"]));
      expect(events.filter((event) => event.type === "speaker_selected")).toHaveLength(3);
      expect(events.some((event) => event.type === "message" && event.author.id === "alpha" && (event.body as any).text === "alpha response")).toBe(true);
      expect(events.some((event) => event.type === "message" && event.author.id === "bravo" && (event.body as any).text === "bravo response")).toBe(true);
      expect(events.some((event) => event.type === "message" && event.author.id === "charlie" && (event.body as any).text === "charlie response")).toBe(true);
    } finally {
      off();
      await host.stop();
    }
  });

  it("creates and routes an additional session over the gateway", async () => {
    const dir = await mkdtemp(join(tmpdir(), "quorum-shared-session-registry-"));
    const room: Room = {
      id: "main-room",
      title: "Main room",
      branch: "main",
      policy: { name: "free-for-all", maxTurnsPerTopic: 3, noConsecutive: true, turnDeadlineMs: 1_000 },
      participants: [
        { id: "human", kind: "human", display: "Human", status: "idle" },
        { id: "echo", kind: "agent", display: "Echo", adapter: "echo", adapterConfig: { text: "main response" }, status: "idle" },
      ],
      createdAt: Date.now(),
    };
    const host = await startSharedSessionRoom(room, { dbPath: join(dir, "room.sqlite"), port: 0 });
    const ws = await connect(host.gateway.url());

    try {
      ws.send(JSON.stringify({ t: "list_sessions", roomId: "main-room" }));
      const sessions = await nextMessage(ws);
      expect(sessions.t).toBe("sessions");
      expect(sessions.rooms.map((item: Room) => item.id)).toContain("main-room");

      ws.send(JSON.stringify({
        t: "create_session",
        roomId: "main-room",
        session: {
          id: "second-room",
          title: "Second room",
          mode: "open-discussion",
          participants: [
            { id: "human", kind: "human", display: "Human", status: "idle" },
            { id: "echo2", kind: "agent", display: "Echo Two", adapter: "echo", adapterConfig: { text: "second response" }, status: "idle" },
          ],
        },
      }));
      const created = await nextMessage(ws);
      expect(created.t).toBe("session_created");
      expect(created.room.id).toBe("second-room");
      expect(created.rooms.map((item: Room) => item.id)).toEqual(["main-room", "second-room"]);

      ws.send(JSON.stringify({ t: "subscribe", roomId: "second-room", sinceSeq: 0 }));
      const snapshot = await nextMessage(ws);
      expect(snapshot.t).toBe("snapshot");
      expect(snapshot.room.id).toBe("second-room");

      const seen: RoomEvent[] = [];
      const collect = (data: WebSocket.RawData) => {
        const message = JSON.parse(String(data));
        if (message.t === "event") seen.push(message.event);
      };
      ws.on("message", collect);
      ws.send(JSON.stringify({ t: "post_message", roomId: "second-room", text: "hello second" }));
      await waitFor(() => seen.some((event) => event.roomId === "second-room" && event.type === "turn_completed"), 2_000);
      ws.off("message", collect);
      expect(seen.some((event) => event.roomId === "second-room" && event.type === "turn_completed")).toBe(true);
      expect(seen.every((event) => event.roomId === "second-room")).toBe(true);
      expect(seen.some((event) => event.type === "message" && event.author.id === "echo2" && (event.body as any).text === "second response")).toBe(true);
    } finally {
      ws.close();
      await host.stop();
    }
  });
});

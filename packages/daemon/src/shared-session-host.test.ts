import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import WebSocket from "ws";
import type { Room, RoomEvent } from "@quorum/protocol";
import { startSharedSessionRoom } from "./shared-session-host.js";
import { registerAdapter } from "./adapters/registry.js";

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
          workspacePath: join(dir, "second-workspace"),
          participants: [
            { id: "human", kind: "human", display: "Human", status: "idle" },
            { id: "echo2", kind: "agent", display: "Echo Two", adapter: "echo", adapterConfig: { text: "second response" }, status: "idle" },
          ],
        },
      }));
      const created = await nextMessage(ws);
      expect(created.t).toBe("session_created");
      expect(created.room.id).toBe("second-room");
      expect(created.room.workspacePath).toBe(join(dir, "second-workspace"));
      expect(created.rooms.map((item: Room) => item.id)).toEqual(["main-room", "second-room"]);

      ws.send(JSON.stringify({ t: "subscribe", roomId: "second-room", sinceSeq: 0 }));
      const snapshot = await nextMessage(ws);
      expect(snapshot.t).toBe("snapshot");
      expect(snapshot.room.id).toBe("second-room");
      expect(snapshot.room.workspacePath).toBe(join(dir, "second-workspace"));

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

  it("creates round-robin sessions with strict ordered speaking", async () => {
    const dir = await mkdtemp(join(tmpdir(), "quorum-shared-session-round-robin-"));
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
      ws.send(JSON.stringify({
        t: "create_session",
        roomId: "main-room",
        session: {
          id: "ordered-room",
          title: "Ordered room",
          mode: "round-robin",
          participants: [
            { id: "human", kind: "human", display: "Human", status: "idle" },
            { id: "alpha", kind: "agent", display: "Alpha", adapter: "echo", adapterConfig: { text: "alpha response" }, status: "idle" },
            { id: "bravo", kind: "agent", display: "Bravo", adapter: "echo", adapterConfig: { text: "bravo response" }, status: "idle" },
            { id: "charlie", kind: "agent", display: "Charlie", adapter: "echo", adapterConfig: { text: "charlie response" }, status: "idle" },
          ],
        },
      }));
      const created = await nextMessage(ws);
      expect(created.t).toBe("session_created");
      expect(created.room.schedulerMode).toBe("round-robin");

      ws.send(JSON.stringify({ t: "subscribe", roomId: "ordered-room", sinceSeq: 0 }));
      expect((await nextMessage(ws)).t).toBe("snapshot");

      const seen: RoomEvent[] = [];
      const collect = (data: WebSocket.RawData) => {
        const message = JSON.parse(String(data));
        if (message.t === "event") seen.push(message.event);
      };
      ws.on("message", collect);
      ws.send(JSON.stringify({ t: "post_message", roomId: "ordered-room", text: "ordered prompt" }));
      await waitFor(() => seen.filter((event) => event.type === "turn_completed").length === 3, 2_500);
      ws.off("message", collect);

      expect(seen.filter((event) => event.type === "turn_started").map((event) => (event.body as any).speakerId)).toEqual([
        "alpha",
        "bravo",
        "charlie",
      ]);
      expect(seen.some((event) => event.type === "bid_submitted")).toBe(false);
    } finally {
      ws.close();
      await host.stop();
    }
  });

  it("serializes editable turns across sessions sharing one canonical workspace", async () => {
    const dir = await mkdtemp(join(tmpdir(), "quorum-shared-workspace-lock-"));
    const workspacePath = join(dir, "workspace");
    let activeEditors = 0;
    let maxActiveEditors = 0;
    registerAdapter("shared-lock-test", (descriptor) => ({
      id: descriptor.id,
      descriptor,
      capabilities: () => ({ canEditFiles: true, canRunCommands: false, supportsToolApproval: false, nativeTools: ["edit"] }),
      async *takeTurn() {
        activeEditors++;
        maxActiveEditors = Math.max(maxActiveEditors, activeEditors);
        await sleep(250);
        activeEditors--;
        yield { type: "message" as const, body: { text: "edited" } };
      },
      async interrupt() {},
    }));
    const room: Room = {
      id: "lock-main",
      title: "Lock main",
      workspacePath,
      branch: "main",
      policy: { name: "free-for-all", maxTurnsPerTopic: 1, noConsecutive: true, turnDeadlineMs: 2_000 },
      participants: [
        { id: "human", kind: "human", display: "Human", status: "idle" },
        { id: "editor-main", kind: "agent", display: "Editor main", adapter: "shared-lock-test", status: "idle" },
      ],
      createdAt: Date.now(),
    };
    const host = await startSharedSessionRoom(room, { dbPath: join(dir, "room.sqlite"), port: 0 });
    const ws = await connect(host.gateway.url());
    try {
      ws.send(JSON.stringify({
        t: "create_session",
        roomId: "lock-main",
        session: {
          id: "lock-second",
          title: "Lock second",
          mode: "open-discussion",
          workspacePath,
          participants: [
            { id: "human", kind: "human", display: "Human", status: "idle" },
            { id: "editor-second", kind: "agent", display: "Editor second", adapter: "shared-lock-test", status: "idle" },
          ],
        },
      }));
      expect((await nextMessage(ws)).t).toBe("session_created");

      ws.send(JSON.stringify({ t: "subscribe", roomId: "lock-second", sinceSeq: 0 }));
      expect((await nextMessage(ws)).t).toBe("snapshot");
      const mainEvents: RoomEvent[] = [];
      const secondEvents: RoomEvent[] = [];
      const offMain = host.log.on((event) => mainEvents.push(event));
      const collectSecond = (data: WebSocket.RawData) => {
        const message = JSON.parse(String(data));
        if (message.t === "event" && message.event.roomId === "lock-second") secondEvents.push(message.event);
      };
      ws.on("message", collectSecond);

      await host.session.submitUserPrompt("edit from main");
      ws.send(JSON.stringify({ t: "post_message", roomId: "lock-second", text: "edit from second" }));
      await waitFor(() =>
        mainEvents.some((event) => event.type === "turn_completed")
        && secondEvents.some((event) => event.type === "turn_completed"),
      20_000);
      expect(maxActiveEditors).toBe(1);
      expect(activeEditors).toBe(0);
      offMain();
      ws.off("message", collectSecond);
    } finally {
      ws.close();
      await host.stop();
    }
  }, 30_000);

  it("lists and continues a persisted session after host restart", async () => {
    const dir = await mkdtemp(join(tmpdir(), "quorum-shared-session-continue-"));
    const dbPath = join(dir, "room.sqlite");
    const baseRoom: Room = {
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
    const first = await startSharedSessionRoom(baseRoom, { dbPath, port: 0 });
    const ws1 = await connect(first.gateway.url());
    try {
      ws1.send(JSON.stringify({
        t: "create_session",
        roomId: "main-room",
        session: {
          id: "continued-room",
          title: "Continued room",
          mode: "open-discussion",
          workspacePath: join(dir, "continued-workspace"),
          participants: [
            { id: "human", kind: "human", display: "Human", status: "idle" },
            { id: "echo2", kind: "agent", display: "Echo Two", adapter: "echo", adapterConfig: { text: "continued response" }, status: "idle" },
          ],
        },
      }));
      expect((await nextMessage(ws1)).t).toBe("session_created");
      ws1.send(JSON.stringify({ t: "subscribe", roomId: "continued-room", sinceSeq: 0 }));
      expect((await nextMessage(ws1)).t).toBe("snapshot");
      ws1.send(JSON.stringify({ t: "post_message", roomId: "continued-room", text: "before restart" }));
      const seen: RoomEvent[] = [];
      ws1.on("message", (data) => {
        const message = JSON.parse(String(data));
        if (message.t === "event") seen.push(message.event);
      });
      await waitFor(() => seen.some((event) => event.type === "turn_completed"), 2_000);
    } finally {
      ws1.close();
      await first.stop();
    }

    const second = await startSharedSessionRoom(baseRoom, { dbPath, port: 0 });
    const ws2 = await connect(second.gateway.url());
    try {
      ws2.send(JSON.stringify({ t: "list_sessions", roomId: "main-room" }));
      const listed = await nextMessage(ws2);
      expect(listed.t).toBe("sessions");
      expect(listed.rooms.map((item: Room) => item.id)).toContain("continued-room");

      ws2.send(JSON.stringify({ t: "continue_session", sessionId: "continued-room" }));
      const continued = await nextMessage(ws2);
      expect(continued.t).toBe("session_continued");
      expect(continued.room).toMatchObject({ id: "continued-room", workspacePath: join(dir, "continued-workspace") });

      ws2.send(JSON.stringify({ t: "subscribe", roomId: "continued-room", sinceSeq: 0 }));
      const snapshot = await nextMessage(ws2);
      expect(snapshot.t).toBe("snapshot");
      expect(snapshot.events.some((event: RoomEvent) => event.type === "message" && (event.body as any).text === "before restart")).toBe(true);
      const previousHead = Math.max(...snapshot.events.map((event: RoomEvent) => event.seq));

      const seen: RoomEvent[] = [];
      ws2.on("message", (data) => {
        const message = JSON.parse(String(data));
        if (message.t === "event") seen.push(message.event);
      });
      ws2.send(JSON.stringify({ t: "post_message", roomId: "continued-room", text: "after restart" }));
      await waitFor(() => seen.some((event) => event.type === "turn_completed"), 2_000);
      expect(seen.some((event) => event.seq > previousHead && event.type === "message" && event.author.id === "echo2")).toBe(true);
    } finally {
      ws2.close();
      await second.stop();
    }
  });

  it("deletes a session from the gateway and removes it from the session list", async () => {
    const dir = await mkdtemp(join(tmpdir(), "quorum-shared-session-delete-"));
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
      ws.send(JSON.stringify({
        t: "create_session",
        roomId: "main-room",
        session: {
          id: "delete-room",
          title: "Delete room",
          mode: "open-discussion",
          participants: [
            { id: "human", kind: "human", display: "Human", status: "idle" },
            { id: "echo2", kind: "agent", display: "Echo Two", adapter: "echo", adapterConfig: { text: "delete response" }, status: "idle" },
          ],
        },
      }));
      expect((await nextMessage(ws)).t).toBe("session_created");

      ws.send(JSON.stringify({ t: "delete_session", roomId: "main-room", sessionId: "delete-room" }));
      const deleted = await nextMessage(ws);
      expect(deleted.t).toBe("session_deleted");
      expect(deleted.sessionId).toBe("delete-room");
      expect(deleted.rooms.map((item: Room) => item.id)).not.toContain("delete-room");

      ws.send(JSON.stringify({ t: "continue_session", sessionId: "delete-room" }));
      const failed = await nextMessage(ws);
      expect(failed.t).toBe("error");
      expect(failed.text).toContain("unknown session");
    } finally {
      ws.close();
      await host.stop();
    }
  });
});

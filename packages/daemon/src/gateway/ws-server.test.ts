import WebSocket from "ws";
import { describe, it, expect } from "vitest";
import { EventLog, InMemoryStore } from "@quorum/core";
import type { ConductorPolicyConfig, Room } from "@quorum/protocol";
import type { MemorySummary } from "@quorum/protocol";
import { Gateway } from "./ws-server.js";

const room: Room = {
  id: "room",
  title: "Gateway test",
  branch: "main",
  policy: { name: "free-for-all", maxTurnsPerTopic: 2, noConsecutive: true, turnDeadlineMs: 1_000 },
  participants: [{ id: "human", kind: "human", display: "Human", status: "idle" }],
  createdAt: 1,
};

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

describe("Gateway", () => {
  it("serves snapshots, broadcasts posted messages, and applies policy updates", async () => {
    const log = new EventLog("room", new InMemoryStore());
    await log.append({
      author: { kind: "human", id: "human", display: "Human" },
      type: "message",
      body: { text: "before subscribe" },
    });

    let policy: ConductorPolicyConfig | undefined;
    const gateway = new Gateway({ log, room, humanId: "human", setPolicy: (cfg) => { policy = cfg; } }, 0);
    await gateway.ready;
    const ws = await connect(gateway.url());

    try {
      ws.send(JSON.stringify({ t: "subscribe", roomId: "room", sinceSeq: 0 }));
      const snapshot = await nextMessage(ws);
      expect(snapshot.t).toBe("snapshot");
      expect(snapshot.events).toHaveLength(1);
      expect(snapshot.events[0].seq).toBe(1);

      const eventPromise = nextMessage(ws);
      ws.send(JSON.stringify({ t: "post_message", roomId: "room", text: "hello", addressedTo: ["echo"] }));
      const event = await eventPromise;
      expect(event.t).toBe("event");
      expect(event.event.type).toBe("message");
      expect(event.event.addressedTo).toEqual(["echo"]);

      ws.send(JSON.stringify({
        t: "set_policy",
        roomId: "room",
        policy: { name: "directed", maxTurnsPerTopic: 1, noConsecutive: true, turnDeadlineMs: 500 },
      }));
      await waitFor(() => policy?.name === "directed");
      expect(policy?.maxTurnsPerTopic).toBe(1);
    } finally {
      await gateway.close();
    }
  });

  it("routes approve_tool to the host dependency", async () => {
    const log = new EventLog("room", new InMemoryStore());
    let approval: { callId: string; allow: boolean } | undefined;
    const gateway = new Gateway({
      log,
      room,
      humanId: "human",
      setPolicy: () => {},
      approveTool: (callId, allow) => { approval = { callId, allow }; },
    }, 0);
    await gateway.ready;
    const ws = await connect(gateway.url());

    try {
      ws.send(JSON.stringify({ t: "approve_tool", roomId: "room", callId: "call-1", allow: true }));
      await waitFor(() => approval?.callId === "call-1");
      expect(approval).toEqual({ callId: "call-1", allow: true });
    } finally {
      ws.close();
      await gateway.close();
    }
  });

  it("returns a replay projection from persisted events", async () => {
    const log = new EventLog("room", new InMemoryStore());
    await log.append({
      author: { kind: "system", id: "session", display: "SessionManager" },
      type: "phase_changed",
      body: { from: "idle", to: "collecting_bids", epoch: 1 },
      visibility: "system",
    });
    const gateway = new Gateway({ log, room, humanId: "human", setPolicy: () => {} }, 0);
    await gateway.ready;
    const ws = await connect(gateway.url());

    try {
      ws.send(JSON.stringify({ t: "replay_projection", roomId: "room", afterSeq: 0 }));
      const message = await nextMessage(ws);
      expect(message.t).toBe("replay_projection");
      expect(message.eventCount).toBe(1);
      expect(message.projection.phase).toBe("collecting_bids");
      expect(message.projection.epoch).toBe(1);
    } finally {
      ws.close();
      await gateway.close();
    }
  });

  it("routes compact_memory and returns working-memory summaries", async () => {
    const log = new EventLog("room", new InMemoryStore());
    const summary: MemorySummary = {
      summaryId: "summary-1",
      sessionId: "room",
      sourceFromSeq: 1,
      sourceToSeq: 2,
      sourceHash: "hash",
      model: "extractive-v1",
      promptVersion: "working-memory-v1",
      createdAt: "2026-01-01T00:00:00.000Z",
      content: "memory",
    };
    let requested: { fromSeq?: number; toSeq?: number } | undefined;
    const gateway = new Gateway({
      log,
      room,
      humanId: "human",
      setPolicy: () => {},
      compactMemory: (fromSeq, toSeq) => {
        requested = { fromSeq, toSeq };
        log.persistWorkingMemorySummary(summary);
        return summary;
      },
    }, 0);
    await gateway.ready;
    const ws = await connect(gateway.url());

    try {
      ws.send(JSON.stringify({ t: "compact_memory", roomId: "room", fromSeq: 1, toSeq: 2 }));
      const message = await nextMessage(ws);
      expect(requested).toEqual({ fromSeq: 1, toSeq: 2 });
      expect(message.t).toBe("memory_compacted");
      expect(message.summary.summaryId).toBe("summary-1");
      expect(message.summaries).toHaveLength(1);
    } finally {
      ws.close();
      await gateway.close();
    }
  });
});

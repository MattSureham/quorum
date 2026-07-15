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
  it("returns daemon-side workspace directory listings", async () => {
    const log = new EventLog("room", new InMemoryStore());
    const gateway = new Gateway({
      log,
      room,
      setPolicy: () => undefined,
      listWorkspaceDirectories: async (path) => ({
        path: path ?? "/home/test",
        parent: "/home",
        directories: [{ name: "project", path: "/home/test/project" }],
      }),
    }, 0);
    await gateway.ready;
    const ws = await connect(gateway.url());
    try {
      ws.send(JSON.stringify({ t: "list_workspace_directories", roomId: "room", requestId: "dirs-1", path: "/home/test" }));
      expect(await nextMessage(ws)).toMatchObject({
        t: "workspace_directories",
        requestId: "dirs-1",
        path: "/home/test",
        directories: [{ name: "project", path: "/home/test/project" }],
      });
    } finally {
      await gateway.close();
    }
  });

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
      ws.send(JSON.stringify({
        t: "post_message",
        roomId: "room",
        text: "hello",
        addressedTo: ["echo"],
        attachments: [{
          id: "img-1",
          name: "chart.png",
          mimeType: "image/png",
          dataUrl: "data:image/png;base64,AAAA",
          sizeBytes: 3,
        }],
      }));
      const event = await eventPromise;
      expect(event.t).toBe("event");
      expect(event.event.type).toBe("message");
      expect(event.event.addressedTo).toEqual(["echo"]);
      expect(event.event.body.attachments).toHaveLength(1);
      expect(event.event.body.attachments[0].name).toBe("chart.png");

      const documentBytes = Buffer.from("PK-not-a-docx");
      const documentPromise = nextMessage(ws);
      ws.send(JSON.stringify({
        t: "post_message",
        roomId: "room",
        text: "read document",
        attachments: [{
          id: "doc-1",
          name: "brief.docx",
          mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          dataUrl: `data:application/vnd.openxmlformats-officedocument.wordprocessingml.document;base64,${documentBytes.toString("base64")}`,
          sizeBytes: documentBytes.length,
        }],
      }));
      const documentEvent = await documentPromise;
      expect(documentEvent.event.body.attachments[0].extraction.status).toBe("failed");

      const oversizedPromise = nextMessage(ws);
      ws.send(JSON.stringify({
        t: "post_message",
        roomId: "room",
        text: "too large",
        attachments: ["a", "b", "c"].map((id) => ({
          id,
          name: `${id}.png`,
          mimeType: "image/png",
          dataUrl: "data:image/png;base64,AAAA",
          sizeBytes: 5_000_000,
        })),
      }));
      expect(await oversizedPromise).toMatchObject({ t: "error", text: expect.stringContaining("size does not match") });

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

  it("routes write-floor take and release commands to host dependencies", async () => {
    const log = new EventLog("room", new InMemoryStore());
    const calls: string[] = [];
    const gateway = new Gateway({
      log,
      room,
      humanId: "human",
      setPolicy: () => {},
      takeWriteFloor: () => { calls.push("take"); },
      releaseWriteFloor: () => { calls.push("release"); },
    }, 0);
    await gateway.ready;
    const ws = await connect(gateway.url());

    try {
      ws.send(JSON.stringify({ t: "take_write_floor", roomId: "room" }));
      await waitFor(() => calls.includes("take"));
      ws.send(JSON.stringify({ t: "release_write_floor", roomId: "room" }));
      await waitFor(() => calls.includes("release"));
      expect(calls).toEqual(["take", "release"]);
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

  it("saves credentials without echoing secret values", async () => {
    const log = new EventLog("room", new InMemoryStore());
    const providers: any[] = [];
    const gateway = new Gateway({
      log,
      room,
      humanId: "human",
      setPolicy: () => {},
      listCredentials: () => providers,
      setCredential: (input) => {
        const provider = {
          providerId: input.providerId,
          envVar: input.envVar,
          configured: !!input.apiKey,
          apiKeyPreview: input.apiKey ? `...${input.apiKey.slice(-4)}` : undefined,
          baseUrl: input.baseUrl,
          model: input.model,
          updatedAt: 1,
        };
        providers.splice(0, providers.length, provider);
        return provider;
      },
    }, 0);
    await gateway.ready;
    const ws = await connect(gateway.url());

    try {
      ws.send(JSON.stringify({
        t: "set_credential",
        requestId: "save-deepseek",
        roomId: "room",
        providerId: "deepseek",
        envVar: "DEEPSEEK_API_KEY",
        apiKey: "sk-secret-1234",
        baseUrl: "https://api.deepseek.com/v1",
        model: "deepseek-chat",
      }));
      const saved = await nextMessage(ws);
      expect(saved.t).toBe("credential_saved");
      expect(saved.requestId).toBe("save-deepseek");
      expect(JSON.stringify(saved)).not.toContain("sk-secret-1234");
      expect(saved.provider).toMatchObject({
        providerId: "deepseek",
        configured: true,
        apiKeyPreview: "...1234",
      });

      ws.send(JSON.stringify({ t: "get_credentials", roomId: "room" }));
      const listed = await nextMessage(ws);
      expect(listed.t).toBe("credentials");
      expect(listed.providers).toHaveLength(1);
    } finally {
      ws.close();
      await gateway.close();
    }
  });

  it("keeps credential reads and writes available after the final session is deleted", async () => {
    const log = new EventLog("room", new InMemoryStore());
    const providers: any[] = [{
      providerId: "deepseek",
      configured: true,
      apiKeyPreview: "...1234",
      updatedAt: 1,
    }];
    const gateway = new Gateway({
      log,
      room,
      humanId: "human",
      setPolicy: () => {},
      listSessions: () => [],
      deleteSession: () => [],
      listCredentials: () => providers,
      setCredential: (input) => {
        const provider = {
          providerId: input.providerId,
          configured: !!input.apiKey,
          apiKeyPreview: input.apiKey ? `...${input.apiKey.slice(-4)}` : undefined,
          updatedAt: 2,
        };
        providers.splice(0, providers.length, provider);
        return provider;
      },
    }, 0);
    await gateway.ready;
    const ws = await connect(gateway.url());

    try {
      ws.send(JSON.stringify({ t: "delete_session", sessionId: "room" }));
      expect(await nextMessage(ws)).toMatchObject({ t: "session_deleted", rooms: [] });

      ws.send(JSON.stringify({ t: "get_credentials" }));
      expect(await nextMessage(ws)).toMatchObject({
        t: "credentials",
        providers: [{ providerId: "deepseek", configured: true }],
      });

      ws.send(JSON.stringify({
        t: "set_credential",
        requestId: "replace-deepseek",
        providerId: "deepseek",
        apiKey: "replacement-5678",
      }));
      const saved = await nextMessage(ws);
      expect(saved).toMatchObject({
        t: "credential_saved",
        requestId: "replace-deepseek",
        provider: {
          providerId: "deepseek",
          configured: true,
          apiKeyPreview: "...5678",
        },
      });
      expect(JSON.stringify(saved)).not.toContain("replacement-5678");
    } finally {
      ws.close();
      await gateway.close();
    }
  });

  it("returns agent health checks", async () => {
    const log = new EventLog("room", new InMemoryStore());
    const gateway = new Gateway({
      log,
      room,
      humanId: "human",
      setPolicy: () => {},
      checkAgents: () => ({ echo: { ok: true, status: "idle", detail: "ready" } }),
    }, 0);
    await gateway.ready;
    const ws = await connect(gateway.url());

    try {
      ws.send(JSON.stringify({ t: "check_agents", roomId: "room" }));
      const message = await nextMessage(ws);
      expect(message.t).toBe("agent_health");
      expect(message.roomId).toBe("room");
      expect(message.health.echo).toMatchObject({ ok: true, status: "idle" });
    } finally {
      ws.close();
      await gateway.close();
    }
  });

  it("broadcasts session deletion to all connected clients", async () => {
    const log = new EventLog("room", new InMemoryStore());
    const gateway = new Gateway({
      log,
      room,
      humanId: "human",
      setPolicy: () => {},
      listSessions: () => [],
      deleteSession: () => [],
    }, 0);
    await gateway.ready;
    const ws1 = await connect(gateway.url());
    const ws2 = await connect(gateway.url());

    try {
      const deleted1 = nextMessage(ws1);
      const deleted2 = nextMessage(ws2);
      ws1.send(JSON.stringify({ t: "delete_session", roomId: "room", sessionId: "room" }));

      await expect(deleted1).resolves.toMatchObject({ t: "session_deleted", sessionId: "room", rooms: [] });
      await expect(deleted2).resolves.toMatchObject({ t: "session_deleted", sessionId: "room", rooms: [] });

      ws1.send(JSON.stringify({ t: "subscribe", roomId: "room", sinceSeq: 0 }));
      await expect(nextMessage(ws1)).resolves.toMatchObject({ t: "error", text: "unknown session: room" });
    } finally {
      ws1.close();
      ws2.close();
      await gateway.close();
    }
  });

  it("reports rollback as unavailable instead of silently succeeding", async () => {
    const log = new EventLog("room", new InMemoryStore());
    const gateway = new Gateway({ log, room, humanId: "human", setPolicy: () => {} }, 0);
    await gateway.ready;
    const ws = await connect(gateway.url());
    try {
      ws.send(JSON.stringify({ t: "rollback", roomId: "room", toHead: "abc123" }));
      await expect(nextMessage(ws)).resolves.toMatchObject({
        t: "error",
        text: "rollback is not available for this session",
      });
    } finally {
      ws.close();
      await gateway.close();
    }
  });

  it("broadcasts session lifecycle updates", async () => {
    const log = new EventLog("room", new InMemoryStore());
    const archivedRoom = { ...room, lifecycle: "archived" as const };
    const gateway = new Gateway({
      log,
      room,
      humanId: "human",
      setPolicy: () => {},
      listSessions: () => [archivedRoom],
      updateSessionLifecycle: (_sessionId, lifecycle) => [{ ...room, lifecycle }],
    }, 0);
    await gateway.ready;
    const ws = await connect(gateway.url());

    try {
      ws.send(JSON.stringify({ t: "update_session_lifecycle", roomId: "room", sessionId: "room", lifecycle: "archived" }));
      const message = await nextMessage(ws);
      expect(message.t).toBe("sessions");
      expect(message.rooms[0].lifecycle).toBe("archived");
    } finally {
      ws.close();
      await gateway.close();
    }
  });
});

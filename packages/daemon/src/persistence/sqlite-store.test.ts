import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { EventLog } from "@quorum/core";
import { SqliteStore } from "./sqlite-store.js";

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3") as new (path: string) => {
  exec(source: string): unknown;
  prepare(source: string): {
    run(...args: unknown[]): unknown;
    all(...args: unknown[]): unknown[];
    get(...args: unknown[]): unknown;
  };
  close(): void;
};

const human = {
  author: { kind: "human" as const, id: "human", display: "Human" },
  type: "message" as const,
};

describe("SqliteStore", () => {
  it("continues event seq after reopening the same database", async () => {
    const dir = await mkdtemp(join(tmpdir(), "quorum-sqlite-"));
    const dbPath = join(dir, "quorum.sqlite");

    const store1 = new SqliteStore(dbPath);
    const log1 = new EventLog("room", store1);
    await log1.append({ ...human, body: { text: "one" } });
    store1.close();

    const store2 = new SqliteStore(dbPath);
    const log2 = new EventLog("room", store2);
    const second = await log2.append({ ...human, body: { text: "two" } });

    expect(second.seq).toBe(2);
    expect(log2.replay(0).map((event) => event.seq)).toEqual([1, 2]);
    expect(log2.replay(1).map((event) => (event.body as any).text)).toEqual(["two"]);
    store2.close();
  });

  it("maintains shared-session projection tables in the same append path", async () => {
    const dir = await mkdtemp(join(tmpdir(), "quorum-sqlite-projection-"));
    const dbPath = join(dir, "quorum.sqlite");
    const store = new SqliteStore(dbPath);
    const log = new EventLog("session-a", store);

    await log.append({
      author: { kind: "system", id: "session", display: "SessionManager" },
      type: "phase_changed",
      body: { from: "idle", to: "collecting_bids", epoch: 1 },
      visibility: "system",
    });
    await log.append({
      author: { kind: "agent", id: "codex", display: "Codex" },
      type: "bid_submitted",
      body: {
        bid: {
          bidId: "bid-1",
          agentId: "codex",
          epoch: 1,
          kind: "answer",
          confidence: 0.8,
          createdAtSeq: 1,
          expiresAfterRound: 2,
          revision: 0,
        },
      },
      visibility: "debug",
    });
    await log.append({
      author: { kind: "system", id: "session", display: "SessionManager" },
      type: "turn_started",
      body: { turnId: "turn-1", speakerId: "codex", generation: 7 },
      visibility: "system",
    });
    await log.append({
      author: { kind: "agent", id: "codex", display: "Codex" },
      type: "turn_output_chunk",
      body: { turnId: "turn-1", generation: 7, offset: 3, text: "hello" },
      turnId: "turn-1",
      visibility: "participant",
    });
    await log.append({
      author: { kind: "system", id: "session", display: "SessionManager" },
      type: "turn_completed",
      body: { turnId: "turn-1", speakerId: "codex", generation: 7, offset: 8 },
      visibility: "system",
    });
    store.close();

    const db = new Database(dbPath);
    try {
      const session = db.prepare("SELECT phase, epoch, head_seq, active_turn_id FROM sessions WHERE session_id=?").get("session-a") as any;
      const turn = db.prepare("SELECT speaker_id, status, output_offset FROM turns WHERE session_id=? AND turn_id=?").get("session-a", "turn-1") as any;
      const bid = db.prepare("SELECT agent_id, kind, confidence, status FROM bids WHERE session_id=? AND bid_id=?").get("session-a", "bid-1") as any;
      const snapshotCount = db.prepare("SELECT COUNT(*) AS count FROM session_snapshots WHERE session_id=?").get("session-a") as any;
      const event = db.prepare("SELECT type, visibility, author_id FROM events WHERE room_id=? AND seq=?").get("session-a", 2) as any;

      expect(session).toMatchObject({ phase: "collecting_bids", epoch: 1, head_seq: 5, active_turn_id: null });
      expect(turn).toMatchObject({ speaker_id: "codex", status: "completed", output_offset: 8 });
      expect(bid).toMatchObject({ agent_id: "codex", kind: "answer", confidence: 0.8, status: "submitted" });
      expect(snapshotCount.count).toBe(1);
      expect(event).toMatchObject({ type: "bid_submitted", visibility: "debug", author_id: "codex" });
    } finally {
      db.close();
    }
  });

  it("replaces a settled agent bid when the same epoch reopens for follow-up", async () => {
    const dir = await mkdtemp(join(tmpdir(), "quorum-sqlite-rebid-"));
    const dbPath = join(dir, "quorum.sqlite");
    const store = new SqliteStore(dbPath);
    const log = new EventLog("session-rebid", store);
    const bid = (bidId: string, revision: number) => ({
      author: { kind: "agent" as const, id: "codex", display: "Codex" },
      type: "bid_submitted" as const,
      body: {
        bid: {
          bidId,
          agentId: "codex",
          epoch: 1,
          kind: "answer",
          confidence: 0.8,
          createdAtSeq: revision + 1,
          expiresAfterRound: 2,
          revision,
        },
      },
      visibility: "debug" as const,
    });

    await log.append(bid("bid-1", 0));
    await log.append({
      author: { kind: "system", id: "session", display: "SessionManager" },
      type: "bid_settled",
      body: { bidId: "bid-1", action: "confirmed" },
      visibility: "debug",
    });
    await log.append(bid("bid-2", 1));
    store.close();

    const db = new Database(dbPath);
    try {
      const rows = db.prepare("SELECT bid_id, status, created_seq, settled_seq, revision FROM bids WHERE session_id=?").all("session-rebid") as any[];
      const eventCount = db.prepare("SELECT COUNT(*) AS count FROM events WHERE room_id=? AND type='bid_submitted'").get("session-rebid") as any;
      expect(rows).toEqual([{ bid_id: "bid-2", status: "submitted", created_seq: 3, settled_seq: null, revision: 1 }]);
      expect(eventCount.count).toBe(2);
    } finally {
      db.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("migrates an existing legacy events table without losing replay", async () => {
    const dir = await mkdtemp(join(tmpdir(), "quorum-sqlite-legacy-"));
    const dbPath = join(dir, "legacy.sqlite");
    const db = new Database(dbPath);
    db.exec(`
      CREATE TABLE events (
        id TEXT PRIMARY KEY, room_id TEXT, seq INTEGER, ts INTEGER, data TEXT NOT NULL
      );
      INSERT INTO events (id, room_id, seq, ts, data)
      VALUES ('old-1', 'room', 1, 100, '{"id":"old-1","roomId":"room","seq":1,"ts":100,"author":{"kind":"human","id":"human","display":"Human"},"type":"message","body":{"text":"old"},"visibility":"room"}');
    `);
    db.close();

    const store = new SqliteStore(dbPath);
    const log = new EventLog("room", store);
    const next = await log.append({ ...human, body: { text: "new" } });
    store.close();

    const reopened = new Database(dbPath);
    try {
      const columns = reopened.prepare("PRAGMA table_info(events)").all().map((column: any) => column.name);
      const session = reopened.prepare("SELECT head_seq FROM sessions WHERE session_id=?").get("room") as any;
      expect(columns).toContain("type");
      expect(columns).toContain("visibility");
      expect(next.seq).toBe(2);
      expect(session.head_seq).toBe(2);
    } finally {
      reopened.close();
    }
  });

  it("persists and reads working-memory summaries", async () => {
    const dir = await mkdtemp(join(tmpdir(), "quorum-sqlite-memory-"));
    const dbPath = join(dir, "memory.sqlite");
    const store = new SqliteStore(dbPath);
    store.persistWorkingMemorySummary({
      summaryId: "summary-1",
      sessionId: "room",
      sourceFromSeq: 1,
      sourceToSeq: 3,
      sourceHash: "abc",
      model: "extractive-v1",
      promptVersion: "working-memory-v1",
      createdAt: "2026-01-01T00:00:00.000Z",
      content: "summary",
    });
    store.close();

    const reopened = new SqliteStore(dbPath);
    try {
      const summaries = reopened.readWorkingMemorySummaries("room");
      expect(summaries).toHaveLength(1);
      expect(summaries[0]).toMatchObject({ summaryId: "summary-1", content: "summary" });
    } finally {
      reopened.close();
    }
  });

  it("persists session room metadata and agent-private memory", async () => {
    const dir = await mkdtemp(join(tmpdir(), "quorum-sqlite-session-room-"));
    const dbPath = join(dir, "session-room.sqlite");
    const store = new SqliteStore(dbPath);
    const room = {
      id: "persisted-room",
      title: "Persisted Room",
      workspacePath: join(dir, "workspace"),
      branch: "main",
      policy: { name: "free-for-all" as const, maxTurnsPerTopic: 3, noConsecutive: true, turnDeadlineMs: 1_000 },
      participants: [
        { id: "human", kind: "human" as const, display: "Human", status: "idle" as const },
        { id: "claude-code", kind: "agent" as const, display: "Claude Code", adapter: "claude-code", status: "idle" as const },
      ],
      createdAt: 123,
    };
    store.upsertSessionRoom(room);
    store.writeAgentPrivateMemory("persisted-room", "claude-code", "native_session", "id", "native-123");
    store.close();

    const reopened = new SqliteStore(dbPath);
    try {
      expect(reopened.listSessionRows().map((row) => row.sessionId)).toContain("persisted-room");
      expect(reopened.readSessionRoom("persisted-room")).toMatchObject({
        id: "persisted-room",
        title: "Persisted Room",
        workspacePath: join(dir, "workspace"),
      });
      expect(reopened.readAgentPrivateMemory("persisted-room", "claude-code", "native_session", "id")).toBe("native-123");
    } finally {
      reopened.close();
    }
  });

  it("deletes a session and its cached session-scoped records", async () => {
    const dir = await mkdtemp(join(tmpdir(), "quorum-sqlite-delete-session-"));
    const dbPath = join(dir, "delete-session.sqlite");
    const store = new SqliteStore(dbPath);
    const log = new EventLog("delete-me", store);
    store.upsertSessionRoom({
      id: "delete-me",
      title: "Delete Me",
      branch: "main",
      policy: { name: "free-for-all", maxTurnsPerTopic: 3, noConsecutive: true, turnDeadlineMs: 1_000 },
      participants: [{ id: "human", kind: "human", display: "Human", status: "idle" }],
      createdAt: Date.now(),
    });
    await log.append({ ...human, body: { text: "remove this" } });
    store.persistWorkingMemorySummary({
      summaryId: "summary-delete",
      sessionId: "delete-me",
      sourceFromSeq: 1,
      sourceToSeq: 1,
      sourceHash: "hash",
      model: "extractive-v1",
      promptVersion: "working-memory-v1",
      createdAt: new Date().toISOString(),
      content: "delete summary",
    });
    store.writeAgentPrivateMemory("delete-me", "agent", "native_session", "id", "native-delete");

    store.deleteSession("delete-me");

    expect(store.readSessionRoom("delete-me")).toBeUndefined();
    expect(store.read("delete-me", 0)).toEqual([]);
    expect(store.readWorkingMemorySummaries("delete-me")).toEqual([]);
    expect(store.readAgentPrivateMemory("delete-me", "agent", "native_session", "id")).toBeUndefined();
    store.close();
  });

  it("persists versioned shared memory across reopen", async () => {
    const dir = await mkdtemp(join(tmpdir(), "quorum-sqlite-shared-memory-"));
    const dbPath = join(dir, "shared.sqlite");
    const store = new SqliteStore(dbPath);
    expect(store.writeSharedMemory("room", { namespace: "decisions", key: "stack", value: { runtime: "node" } })).toEqual({ ok: true, version: 1 });
    expect(store.writeSharedMemory("room", { namespace: "decisions", key: "stack", value: "stale", expectedVersion: 0 })).toEqual({ ok: false, error: "version mismatch" });
    store.close();

    const reopened = new SqliteStore(dbPath);
    try {
      expect(reopened.readSharedMemory("room")).toEqual([{ namespace: "decisions", key: "stack", version: 1, value: { runtime: "node" } }]);
    } finally {
      reopened.close();
    }
  });

  it("persists provider credentials as masked views and applies env vars", async () => {
    const dir = await mkdtemp(join(tmpdir(), "quorum-sqlite-credentials-"));
    const dbPath = join(dir, "credentials.sqlite");
    const previous = process.env.TEST_QUORUM_API_KEY;
    const previousBaseUrl = process.env.TEST_QUORUM_BASE_URL;
    const previousModel = process.env.TEST_QUORUM_MODEL;
    try {
      delete process.env.TEST_QUORUM_API_KEY;
      delete process.env.TEST_QUORUM_BASE_URL;
      delete process.env.TEST_QUORUM_MODEL;
      const store = new SqliteStore(dbPath);
      const view = store.upsertProviderConfig({
        providerId: "test-provider",
        envVar: "TEST_QUORUM_API_KEY",
        apiKey: "secret-value-9999",
        baseUrl: "https://example.test/v1",
        model: "test-model",
      });

      expect(view).toMatchObject({
        providerId: "test-provider",
        configured: true,
        apiKeyPreview: "...9999",
        baseUrl: "https://example.test/v1",
        model: "test-model",
      });
      expect(JSON.stringify(view)).not.toContain("secret-value-9999");
      expect(process.env.TEST_QUORUM_API_KEY).toBe("secret-value-9999");
      expect(process.env.TEST_QUORUM_BASE_URL).toBe("https://example.test/v1");
      expect(process.env.TEST_QUORUM_MODEL).toBe("test-model");
      expect(store.readProviderConfigViews()).toHaveLength(1);
      store.close();

      delete process.env.TEST_QUORUM_API_KEY;
      delete process.env.TEST_QUORUM_BASE_URL;
      delete process.env.TEST_QUORUM_MODEL;
      const reopened = new SqliteStore(dbPath);
      reopened.applyProviderConfigsToEnv();
      expect(process.env.TEST_QUORUM_API_KEY).toBe("secret-value-9999");
      expect(process.env.TEST_QUORUM_BASE_URL).toBe("https://example.test/v1");
      expect(process.env.TEST_QUORUM_MODEL).toBe("test-model");
      reopened.close();
    } finally {
      if (previous === undefined) delete process.env.TEST_QUORUM_API_KEY;
      else process.env.TEST_QUORUM_API_KEY = previous;
      if (previousBaseUrl === undefined) delete process.env.TEST_QUORUM_BASE_URL;
      else process.env.TEST_QUORUM_BASE_URL = previousBaseUrl;
      if (previousModel === undefined) delete process.env.TEST_QUORUM_MODEL;
      else process.env.TEST_QUORUM_MODEL = previousModel;
      await rm(dir, { recursive: true, force: true });
    }
  });
});

import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Room, RoomEvent, SharedMemoryCommand, WriteResult } from "@quorum/protocol";
import type { MemorySummary } from "@quorum/protocol";
import type { EventStore } from "@quorum/core";

export interface ProviderConfig {
  providerId: string;
  envVar?: string;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  updatedAt: number;
}

export interface ProviderConfigView {
  providerId: string;
  envVar?: string;
  configured: boolean;
  apiKeyPreview?: string;
  baseUrl?: string;
  model?: string;
  updatedAt: number;
}

export interface SessionRow {
  sessionId: string;
  title: string;
  phase: string;
  epoch: number;
  headSeq: number;
  createdAt: number;
  updatedAt: number;
  room?: Room;
}

const require = createRequire(import.meta.url);

interface SqliteDb {
  pragma?(source: string): unknown;
  exec(source: string): unknown;
  prepare(source: string): {
    run(...args: unknown[]): unknown;
    all(...args: unknown[]): unknown[];
    get(...args: unknown[]): unknown;
  };
  close(): void;
}

function openDatabase(path: string): SqliteDb {
  if ((process.versions as any).bun) {
    const { Database } = require("bun:sqlite") as { Database: new (path: string) => SqliteDb };
    return new Database(path);
  }
  const Database = require("better-sqlite3") as new (path: string) => SqliteDb;
  return new Database(path);
}

function maybeNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function maybeString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function json(value: unknown): string {
  return JSON.stringify(value);
}

/** Append-only event store backed by SQLite. */
export class SqliteStore implements EventStore {
  private readonly db: SqliteDb;

  constructor(path = ".quorum/quorum.sqlite") {
    mkdirSync(dirname(path), { recursive: true });
    this.db = openDatabase(path);
    this.db.pragma?.("journal_mode = WAL");
    this.db.pragma?.("foreign_keys = ON");
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        room_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        ts INTEGER NOT NULL,
        type TEXT,
        turn_id TEXT,
        visibility TEXT,
        author_id TEXT,
        data TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_events_room_seq ON events(room_id, seq);

      CREATE TABLE IF NOT EXISTS sessions (
        session_id TEXT PRIMARY KEY,
        title TEXT,
        room_data TEXT,
        phase TEXT NOT NULL DEFAULT 'idle',
        epoch INTEGER NOT NULL DEFAULT 0,
        head_seq INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        active_turn_id TEXT,
        active_speaker_id TEXT,
        selected_agent_id TEXT,
        selected_score REAL
      );

      CREATE TABLE IF NOT EXISTS session_snapshots (
        session_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        phase TEXT NOT NULL,
        epoch INTEGER NOT NULL,
        active_turn_id TEXT,
        active_speaker_id TEXT,
        data TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (session_id, seq)
      );

      CREATE TABLE IF NOT EXISTS turns (
        session_id TEXT NOT NULL,
        turn_id TEXT NOT NULL,
        speaker_id TEXT NOT NULL,
        generation INTEGER,
        status TEXT NOT NULL,
        started_seq INTEGER,
        completed_seq INTEGER,
        started_at INTEGER,
        ended_at INTEGER,
        output_offset INTEGER NOT NULL DEFAULT 0,
        data TEXT,
        PRIMARY KEY (session_id, turn_id)
      );
      CREATE INDEX IF NOT EXISTS idx_turns_session_turn ON turns(session_id, turn_id);

      CREATE TABLE IF NOT EXISTS bids (
        session_id TEXT NOT NULL,
        epoch INTEGER NOT NULL,
        agent_id TEXT NOT NULL,
        bid_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        confidence REAL NOT NULL,
        reply_to_turn_id TEXT,
        revision INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'submitted',
        created_seq INTEGER NOT NULL,
        settled_seq INTEGER,
        data TEXT NOT NULL,
        PRIMARY KEY (session_id, bid_id)
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_bids_session_epoch_agent ON bids(session_id, epoch, agent_id);

      CREATE TABLE IF NOT EXISTS working_memory_summaries (
        session_id TEXT NOT NULL,
        summary_id TEXT NOT NULL,
        from_seq INTEGER NOT NULL,
        to_seq INTEGER NOT NULL,
        hash TEXT NOT NULL,
        model TEXT NOT NULL,
        summary TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (session_id, summary_id)
      );

      CREATE TABLE IF NOT EXISTS shared_memory (
        session_id TEXT NOT NULL,
        namespace TEXT NOT NULL,
        key TEXT NOT NULL,
        version INTEGER NOT NULL,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (session_id, namespace, key)
      );

      CREATE TABLE IF NOT EXISTS agent_private_memory (
        session_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        namespace TEXT NOT NULL,
        key TEXT NOT NULL,
        version INTEGER NOT NULL,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (session_id, agent_id, namespace, key)
      );

      CREATE TABLE IF NOT EXISTS long_term_memory (
        memory_id TEXT PRIMARY KEY,
        namespace TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS agent_configs (
        agent_id TEXT PRIMARY KEY,
        config TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS provider_configs (
        provider_id TEXT PRIMARY KEY,
        config TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );

      INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (1, strftime('%s','now') * 1000);
    `);
    this.ensureColumn("events", "type", "TEXT");
    this.ensureColumn("events", "turn_id", "TEXT");
    this.ensureColumn("events", "visibility", "TEXT");
    this.ensureColumn("events", "author_id", "TEXT");
    this.ensureColumn("sessions", "room_data", "TEXT");
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_events_room_type_seq ON events(room_id, type, seq);
      CREATE INDEX IF NOT EXISTS idx_events_room_turn_id ON events(room_id, turn_id);
    `);
  }

  private ensureColumn(table: string, column: string, definition: string): void {
    const columns = this.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    if (columns.some((item) => item.name === column)) return;
    this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }

  persist(e: RoomEvent): void {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db
        .prepare("INSERT INTO events (id, room_id, seq, ts, type, turn_id, visibility, author_id, data) VALUES (?,?,?,?,?,?,?,?,?)")
        .run(e.id, e.roomId, e.seq, e.ts, e.type, e.turnId ?? null, e.visibility, e.author.id, json(e));
      this.applyProjection(e);
      this.db.exec("COMMIT");
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }

  read(roomId: string, sinceSeq = 0): RoomEvent[] {
    return this.db
      .prepare("SELECT data FROM events WHERE room_id=? AND seq>? ORDER BY seq")
      .all(roomId, sinceSeq)
      .map((r: any) => JSON.parse(r.data) as RoomEvent);
  }

  maxSeq(roomId: string): number {
    const r = this.db.prepare("SELECT MAX(seq) AS m FROM events WHERE room_id=?").get(roomId) as any;
    return r?.m ?? 0;
  }

  close(): void {
    this.db.close();
  }

  persistWorkingMemorySummary(summary: MemorySummary): void {
    this.db
      .prepare(`
        INSERT OR REPLACE INTO working_memory_summaries
          (session_id, summary_id, from_seq, to_seq, hash, model, summary, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        summary.sessionId,
        summary.summaryId,
        summary.sourceFromSeq,
        summary.sourceToSeq,
        summary.sourceHash,
        summary.model,
        JSON.stringify(summary),
        Date.parse(summary.createdAt) || Date.now(),
      );
  }

  readWorkingMemorySummaries(sessionId: string): MemorySummary[] {
    return this.db
      .prepare("SELECT summary FROM working_memory_summaries WHERE session_id=? ORDER BY to_seq, summary_id")
      .all(sessionId)
      .map((row: any) => JSON.parse(row.summary) as MemorySummary);
  }

  upsertSessionRoom(room: Room): void {
    const now = Date.now();
    this.db
      .prepare(`
        INSERT INTO sessions (session_id, title, room_data, phase, epoch, head_seq, created_at, updated_at)
        VALUES (?, ?, ?, 'idle', 0, COALESCE((SELECT MAX(seq) FROM events WHERE room_id=?), 0), ?, ?)
        ON CONFLICT(session_id) DO UPDATE SET
          title=excluded.title,
          room_data=excluded.room_data,
          updated_at=excluded.updated_at
      `)
      .run(room.id, room.title, JSON.stringify(room), room.id, room.createdAt || now, now);
  }

  listSessionRows(): SessionRow[] {
    return this.db
      .prepare("SELECT session_id, title, room_data, phase, epoch, head_seq, created_at, updated_at FROM sessions ORDER BY created_at, session_id")
      .all()
      .map((row: any) => this.sessionRowView(row));
  }

  readSessionRoom(sessionId: string): Room | undefined {
    const row = this.db.prepare("SELECT room_data, title, created_at FROM sessions WHERE session_id=?").get(sessionId) as any;
    if (!row) return undefined;
    if (row.room_data) return JSON.parse(row.room_data) as Room;
    return {
      id: sessionId,
      title: row.title ?? sessionId,
      branch: "main",
      policy: { name: "free-for-all", maxTurnsPerTopic: 3, noConsecutive: true, turnDeadlineMs: 120_000 },
      participants: [{ id: "human", kind: "human", display: "Human", status: "idle" }],
      createdAt: row.created_at ?? Date.now(),
    };
  }

  deleteSession(sessionId: string): void {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare("DELETE FROM events WHERE room_id=?").run(sessionId);
      this.db.prepare("DELETE FROM session_snapshots WHERE session_id=?").run(sessionId);
      this.db.prepare("DELETE FROM turns WHERE session_id=?").run(sessionId);
      this.db.prepare("DELETE FROM bids WHERE session_id=?").run(sessionId);
      this.db.prepare("DELETE FROM working_memory_summaries WHERE session_id=?").run(sessionId);
      this.db.prepare("DELETE FROM shared_memory WHERE session_id=?").run(sessionId);
      this.db.prepare("DELETE FROM agent_private_memory WHERE session_id=?").run(sessionId);
      this.db.prepare("DELETE FROM sessions WHERE session_id=?").run(sessionId);
      this.db.exec("COMMIT");
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }

  readAgentPrivateMemory(sessionId: string, agentId: string, namespace: string, key: string): unknown | undefined {
    const row = this.db
      .prepare("SELECT value FROM agent_private_memory WHERE session_id=? AND agent_id=? AND namespace=? AND key=?")
      .get(sessionId, agentId, namespace, key) as any;
    if (!row?.value) return undefined;
    return JSON.parse(row.value);
  }

  writeAgentPrivateMemory(sessionId: string, agentId: string, namespace: string, key: string, value: unknown): void {
    const current = this.db
      .prepare("SELECT version FROM agent_private_memory WHERE session_id=? AND agent_id=? AND namespace=? AND key=?")
      .get(sessionId, agentId, namespace, key) as any;
    const version = (current?.version ?? 0) + 1;
    this.db
      .prepare(`
        INSERT OR REPLACE INTO agent_private_memory
          (session_id, agent_id, namespace, key, version, value, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
      .run(sessionId, agentId, namespace, key, version, JSON.stringify(value), Date.now());
  }

  readSharedMemory(sessionId: string): Array<{ namespace: string; key: string; version: number; value: unknown }> {
    return this.db
      .prepare("SELECT namespace, key, version, value FROM shared_memory WHERE session_id=? ORDER BY namespace, key")
      .all(sessionId)
      .map((row: any) => ({ namespace: row.namespace, key: row.key, version: row.version, value: JSON.parse(row.value) }));
  }

  writeSharedMemory(sessionId: string, command: SharedMemoryCommand): WriteResult {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const current = this.db
        .prepare("SELECT version FROM shared_memory WHERE session_id=? AND namespace=? AND key=?")
        .get(sessionId, command.namespace, command.key) as any;
      if (command.expectedVersion !== undefined && current?.version !== command.expectedVersion) {
        this.db.exec("ROLLBACK");
        return { ok: false, error: "version mismatch" };
      }
      const version = (current?.version ?? 0) + 1;
      this.db.prepare(`
        INSERT OR REPLACE INTO shared_memory (session_id, namespace, key, version, value, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(sessionId, command.namespace, command.key, version, JSON.stringify(command.value), Date.now());
      this.db.exec("COMMIT");
      return { ok: true, version };
    } catch (err) {
      this.db.exec("ROLLBACK");
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  upsertProviderConfig(input: Omit<ProviderConfig, "updatedAt">): ProviderConfigView {
    const existing = this.readProviderConfig(input.providerId);
    const next: ProviderConfig = {
      providerId: input.providerId,
      envVar: input.envVar || existing?.envVar,
      apiKey: input.apiKey || existing?.apiKey,
      baseUrl: input.baseUrl ?? existing?.baseUrl,
      model: input.model ?? existing?.model,
      updatedAt: Date.now(),
    };
    this.db
      .prepare("INSERT OR REPLACE INTO provider_configs (provider_id, config, updated_at) VALUES (?, ?, ?)")
      .run(next.providerId, JSON.stringify(next), next.updatedAt);
    this.applyProviderEnv(next);
    return this.maskProviderConfig(next);
  }

  readProviderConfig(providerId: string): ProviderConfig | undefined {
    const row = this.db.prepare("SELECT config FROM provider_configs WHERE provider_id=?").get(providerId) as any;
    if (!row?.config) return undefined;
    return JSON.parse(row.config) as ProviderConfig;
  }

  readProviderConfigViews(): ProviderConfigView[] {
    return this.db
      .prepare("SELECT config FROM provider_configs ORDER BY provider_id")
      .all()
      .map((row: any) => this.maskProviderConfig(JSON.parse(row.config) as ProviderConfig));
  }

  applyProviderConfigsToEnv(): void {
    for (const row of this.db.prepare("SELECT config FROM provider_configs").all() as any[]) {
      this.applyProviderEnv(JSON.parse(row.config) as ProviderConfig);
    }
  }

  private applyProviderEnv(config: ProviderConfig): void {
    if (!config.envVar) return;
    if (config.apiKey) process.env[config.envVar] = config.apiKey;
    const prefix = config.envVar.replace(/_API_KEY$/i, "");
    if (config.baseUrl) process.env[`${prefix}_BASE_URL`] = config.baseUrl;
    if (config.model) process.env[`${prefix}_MODEL`] = config.model;
  }

  private maskProviderConfig(config: ProviderConfig): ProviderConfigView {
    const key = config.apiKey ?? "";
    return {
      providerId: config.providerId,
      envVar: config.envVar,
      configured: key.length > 0,
      apiKeyPreview: key ? `...${key.slice(-4)}` : undefined,
      baseUrl: config.baseUrl,
      model: config.model,
      updatedAt: config.updatedAt,
    };
  }

  private sessionRowView(row: any): SessionRow {
    return {
      sessionId: row.session_id,
      title: row.title ?? row.session_id,
      phase: row.phase,
      epoch: row.epoch,
      headSeq: row.head_seq,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      room: row.room_data ? JSON.parse(row.room_data) as Room : undefined,
    };
  }

  private ensureSession(e: RoomEvent): void {
    this.db
      .prepare(`
        INSERT INTO sessions (session_id, title, phase, epoch, head_seq, created_at, updated_at)
        VALUES (?, ?, 'idle', 0, ?, ?, ?)
        ON CONFLICT(session_id) DO UPDATE SET
          title=COALESCE(sessions.title, excluded.title),
          head_seq=excluded.head_seq,
          updated_at=excluded.updated_at
      `)
      .run(e.roomId, e.roomId, e.seq, e.ts, e.ts);
  }

  private sessionRow(sessionId: string): { phase: string; epoch: number; active_turn_id: string | null; active_speaker_id: string | null } {
    return this.db
      .prepare("SELECT phase, epoch, active_turn_id, active_speaker_id FROM sessions WHERE session_id=?")
      .get(sessionId) as any;
  }

  private writeSnapshot(e: RoomEvent): void {
    const row = this.sessionRow(e.roomId);
    this.db
      .prepare(`
        INSERT OR REPLACE INTO session_snapshots
          (session_id, seq, phase, epoch, active_turn_id, active_speaker_id, data, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        e.roomId,
        e.seq,
        row.phase,
        row.epoch,
        row.active_turn_id,
        row.active_speaker_id,
        json({ eventId: e.id, eventType: e.type, headSeq: e.seq, session: row }),
        e.ts,
      );
  }

  private applyProjection(e: RoomEvent): void {
    this.ensureSession(e);
    const body = e.body as Record<string, unknown>;

    if (e.type === "phase_changed") {
      this.db
        .prepare("UPDATE sessions SET phase=?, epoch=COALESCE(?, epoch), head_seq=?, updated_at=? WHERE session_id=?")
        .run(maybeString(body.to) ?? "idle", maybeNumber(body.epoch), e.seq, e.ts, e.roomId);
      this.writeSnapshot(e);
      return;
    }

    if (e.type === "bid_submitted") {
      const bid = body.bid as Record<string, unknown> | undefined;
      if (bid) {
        this.db
          .prepare(`
            INSERT INTO bids
              (session_id, epoch, agent_id, bid_id, kind, confidence, reply_to_turn_id, revision, status, created_seq, data)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'submitted', ?, ?)
            ON CONFLICT(session_id, bid_id) DO UPDATE SET
              kind=excluded.kind,
              confidence=excluded.confidence,
              reply_to_turn_id=excluded.reply_to_turn_id,
              revision=excluded.revision,
              status='submitted',
              data=excluded.data
          `)
          .run(
            e.roomId,
            maybeNumber(bid.epoch) ?? 0,
            maybeString(bid.agentId) ?? e.author.id,
            maybeString(bid.bidId) ?? e.id,
            maybeString(bid.kind) ?? "answer",
            maybeNumber(bid.confidence) ?? 0,
            maybeString(bid.replyToTurnId),
            maybeNumber(bid.revision) ?? 0,
            e.seq,
            json(bid),
          );
      }
    } else if (e.type === "bid_settled") {
      this.db
        .prepare("UPDATE bids SET status=?, settled_seq=? WHERE session_id=? AND bid_id=?")
        .run(maybeString(body.action) ?? "confirmed", e.seq, e.roomId, maybeString(body.bidId));
    } else if (e.type === "speaker_selected") {
      const winner = body.winner as Record<string, unknown> | undefined;
      const bid = winner?.bid as Record<string, unknown> | undefined;
      this.db
        .prepare("UPDATE sessions SET selected_agent_id=?, selected_score=?, head_seq=?, updated_at=? WHERE session_id=?")
        .run(bid ? maybeString(bid.agentId) : null, maybeNumber(winner?.score), e.seq, e.ts, e.roomId);
    } else if (e.type === "turn_started") {
      this.db
        .prepare(`
          INSERT INTO turns
            (session_id, turn_id, speaker_id, generation, status, started_seq, started_at, data)
          VALUES (?, ?, ?, ?, 'speaking', ?, ?, ?)
          ON CONFLICT(session_id, turn_id) DO UPDATE SET
            speaker_id=excluded.speaker_id,
            generation=excluded.generation,
            status='speaking',
            started_seq=excluded.started_seq,
            started_at=excluded.started_at,
            data=excluded.data
        `)
        .run(
          e.roomId,
          maybeString(body.turnId) ?? e.turnId ?? e.id,
          maybeString(body.speakerId) ?? e.author.id,
          maybeNumber(body.generation),
          e.seq,
          e.ts,
          json(body),
        );
      this.db
        .prepare("UPDATE sessions SET active_turn_id=?, active_speaker_id=?, head_seq=?, updated_at=? WHERE session_id=?")
        .run(maybeString(body.turnId) ?? e.turnId ?? e.id, maybeString(body.speakerId) ?? e.author.id, e.seq, e.ts, e.roomId);
    } else if (e.type === "turn_output_chunk") {
      this.db
        .prepare("UPDATE turns SET output_offset=MAX(output_offset, ?) WHERE session_id=? AND turn_id=?")
        .run(maybeNumber(body.offset) ?? 0, e.roomId, maybeString(body.turnId) ?? e.turnId);
    } else if (e.type === "turn_completed" || e.type === "turn_cancelled" || e.type === "turn_failed") {
      const status = e.type === "turn_completed" ? "completed" : e.type === "turn_cancelled" ? "cancelled" : "failed";
      this.db
        .prepare(`
          UPDATE turns
          SET status=?, completed_seq=?, ended_at=?, output_offset=MAX(output_offset, ?)
          WHERE session_id=? AND turn_id=?
        `)
        .run(status, e.seq, e.ts, maybeNumber(body.offset) ?? 0, e.roomId, maybeString(body.turnId) ?? e.turnId);
      this.db
        .prepare("UPDATE sessions SET active_turn_id=NULL, active_speaker_id=NULL, head_seq=?, updated_at=? WHERE session_id=?")
        .run(e.seq, e.ts, e.roomId);
    }

    this.db
      .prepare("UPDATE sessions SET head_seq=?, updated_at=? WHERE session_id=?")
      .run(e.seq, e.ts, e.roomId);
  }
}

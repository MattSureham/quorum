import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { RoomEvent } from "@quorum/protocol";
import type { EventStore } from "@quorum/core";

/** Append-only event store backed by SQLite (better-sqlite3). */
export class SqliteStore implements EventStore {
  private readonly db: Database.Database;

  constructor(path = ".quorum/quorum.sqlite") {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY, room_id TEXT, seq INTEGER, ts INTEGER, data TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_events_room_seq ON events(room_id, seq);
    `);
  }

  persist(e: RoomEvent): void {
    this.db
      .prepare("INSERT INTO events (id, room_id, seq, ts, data) VALUES (?,?,?,?,?)")
      .run(e.id, e.roomId, e.seq, e.ts, JSON.stringify(e));
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
}

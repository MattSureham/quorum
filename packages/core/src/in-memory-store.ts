import type { MemorySummary, RoomEvent } from "@quorum/protocol";
import { type EventStore } from "./types.js";

/** Dependency-free EventStore for tests and the local demo. */
export class InMemoryStore implements EventStore {
  private readonly events = new Map<string, RoomEvent[]>();
  private readonly summaries = new Map<string, MemorySummary[]>();

  persist(e: RoomEvent): void {
    const arr = this.events.get(e.roomId) ?? [];
    arr.push(e);
    this.events.set(e.roomId, arr);
  }

  read(roomId: string, sinceSeq = 0): RoomEvent[] {
    return (this.events.get(roomId) ?? []).filter((e) => e.seq > sinceSeq);
  }

  maxSeq(roomId: string): number {
    const arr = this.events.get(roomId);
    return arr && arr.length ? arr[arr.length - 1]!.seq : 0;
  }

  persistWorkingMemorySummary(summary: MemorySummary): void {
    const arr = this.summaries.get(summary.sessionId) ?? [];
    arr.push(summary);
    this.summaries.set(summary.sessionId, arr);
  }

  readWorkingMemorySummaries(sessionId: string): MemorySummary[] {
    return [...(this.summaries.get(sessionId) ?? [])];
  }
}

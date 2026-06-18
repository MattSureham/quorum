import type { RoomEvent } from "@quorum/protocol";
import { type EventStore } from "./types.js";

/** Dependency-free EventStore for tests and the local demo. */
export class InMemoryStore implements EventStore {
  private readonly events = new Map<string, RoomEvent[]>();

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
}

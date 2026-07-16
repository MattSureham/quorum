import type { MemorySummary, RoomEvent, SharedMemoryCommand, WriteResult } from "@quorum/protocol";
import { type EventStore } from "./types.js";

/** Dependency-free EventStore for tests and the local demo. */
export class InMemoryStore implements EventStore {
  private readonly events = new Map<string, RoomEvent[]>();
  private readonly summaries = new Map<string, MemorySummary[]>();
  private readonly sharedMemory = new Map<string, Map<string, { namespace: string; key: string; version: number; value: unknown }>>();

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

  readAttachment(roomId: string, eventId: string, attachmentId: string) {
    const event = (this.events.get(roomId) ?? []).find((item) => item.id === eventId);
    const attachments = (event?.body as { attachments?: import("@quorum/protocol").MessageAttachment[] } | undefined)?.attachments ?? [];
    return attachments.find((attachment) => attachment.id === attachmentId);
  }

  persistWorkingMemorySummary(summary: MemorySummary): void {
    const arr = this.summaries.get(summary.sessionId) ?? [];
    arr.push(summary);
    this.summaries.set(summary.sessionId, arr);
  }

  readWorkingMemorySummaries(sessionId: string): MemorySummary[] {
    return [...(this.summaries.get(sessionId) ?? [])];
  }

  readSharedMemory(sessionId: string) {
    return [...(this.sharedMemory.get(sessionId)?.values() ?? [])];
  }

  writeSharedMemory(sessionId: string, command: SharedMemoryCommand): WriteResult {
    const room = this.sharedMemory.get(sessionId) ?? new Map();
    const id = `${command.namespace}:${command.key}`;
    const current = room.get(id);
    if (command.expectedVersion !== undefined && current?.version !== command.expectedVersion) {
      return { ok: false, error: "version mismatch" };
    }
    const version = (current?.version ?? 0) + 1;
    room.set(id, { namespace: command.namespace, key: command.key, version, value: command.value });
    this.sharedMemory.set(sessionId, room);
    return { ok: true, version };
  }
}

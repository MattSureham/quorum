import { EventEmitter } from "node:events";
import type { RoomEvent } from "@quorum/protocol";
import { type EventStore, type AppendInput } from "./types.js";
import { ulid } from "./ids.js";

/**
 * The single source of truth for a room.
 * - Assigns a strictly monotonic `seq` even under concurrent callers, by chaining
 *   appends onto an internal promise (a logical single-writer).
 * - Fans out every event to subscribers and persists via the EventStore.
 */
export class EventLog {
  private seq: number;
  private chain: Promise<unknown> = Promise.resolve();
  private readonly emitter = new EventEmitter();

  constructor(
    private readonly roomId: string,
    private readonly store: EventStore,
  ) {
    this.seq = store.maxSeq(roomId);
    this.emitter.setMaxListeners(200);
  }

  append(input: AppendInput): Promise<RoomEvent> {
    const run = this.chain.then(() => {
      const e: RoomEvent = {
        id: input.id ?? ulid(),
        roomId: this.roomId,
        seq: ++this.seq,
        ts: input.ts ?? Date.now(),
        author: input.author,
        type: input.type,
        body: input.body,
        replyTo: input.replyTo,
        addressedTo: input.addressedTo,
        turnId: input.turnId,
        visibility: input.visibility ?? "room",
      };
      this.store.persist(e);
      this.emitter.emit("event", e);
      return e;
    });
    // keep the chain alive even if a consumer throws
    this.chain = run.then(() => undefined, () => undefined);
    return run;
  }

  /** Subscribe to live events. Returns an unsubscribe fn. */
  on(cb: (e: RoomEvent) => void): () => void {
    this.emitter.on("event", cb);
    return () => this.emitter.off("event", cb);
  }

  /** Replay persisted events with seq > sinceSeq (default: all). */
  replay(sinceSeq = 0): RoomEvent[] {
    return this.store.read(this.roomId, sinceSeq);
  }

  get headSeq(): number {
    return this.seq;
  }
}

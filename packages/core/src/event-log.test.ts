import { describe, it, expect } from "vitest";
import { EventLog } from "./event-log.js";
import { InMemoryStore } from "./in-memory-store.js";
import type { AppendInput } from "./types.js";

const human = (text: string): AppendInput => ({
  author: { kind: "human", id: "matt", display: "Matt" },
  type: "message",
  body: { text },
});

describe("EventLog (M0 acceptance)", () => {
  it("assigns a strictly monotonic, gap-free seq even under concurrent appends", async () => {
    const log = new EventLog("r", new InMemoryStore());
    const results = await Promise.all(
      Array.from({ length: 200 }, (_, i) => log.append(human(`m${i}`))),
    );
    const seqs = results.map((e) => e.seq).sort((a, b) => a - b);
    expect(seqs[0]).toBe(1);
    expect(seqs.at(-1)).toBe(200);
    expect(new Set(seqs).size).toBe(200);
    for (let i = 1; i < seqs.length; i++) expect(seqs[i]! - seqs[i - 1]!).toBe(1);
  });

  it("delivers every appended event to subscribers", async () => {
    const log = new EventLog("r", new InMemoryStore());
    const seen: number[] = [];
    log.on((e) => seen.push(e.seq));
    for (let i = 0; i < 10; i++) await log.append(human(`m${i}`));
    expect(seen).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it("replays only events after sinceSeq", async () => {
    const log = new EventLog("r", new InMemoryStore());
    for (let i = 0; i < 5; i++) await log.append(human(`m${i}`));
    expect(log.replay(0).map((e) => e.seq)).toEqual([1, 2, 3, 4, 5]);
    expect(log.replay(3).map((e) => e.seq)).toEqual([4, 5]);
  });
});

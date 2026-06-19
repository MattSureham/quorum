import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { EventLog } from "@quorum/core";
import { SqliteStore } from "./sqlite-store.js";

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
});

import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ParticipantDescriptor } from "@quorum/protocol";
import type { TurnInput } from "@quorum/core";
import { CodexAdapter } from "./codex.js";

async function fakeCli(source: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "quorum-codex-"));
  const path = join(dir, "codex");
  await writeFile(path, `#!/bin/sh\n${source}\n`, "utf8");
  await chmod(path, 0o755);
  return path;
}

function input(nativeSessionId?: string): TurnInput {
  const self: ParticipantDescriptor = { id: "codex", kind: "agent", display: "Codex", adapter: "codex", status: "idle" };
  return {
    turnId: "turn-1",
    roomTitle: "Test",
    self,
    participants: [self],
    projection: [],
    protocol: "",
    nativeSessionId,
    signal: new AbortController().signal,
  };
}

async function collect(adapter: CodexAdapter, turn = input()) {
  const events = [];
  for await (const event of adapter.takeTurn(turn)) events.push(event);
  return events;
}

describe("CodexAdapter", () => {
  it("parses current Codex agent_message JSONL events", async () => {
    const bin = await fakeCli(`printf '%s\\n' '{"type":"thread.started","thread_id":"thread-1"}' '{"type":"item.completed","item":{"id":"item-1","type":"agent_message","text":"hello"}}' '{"type":"turn.completed"}'`);
    const adapter = new CodexAdapter(input().self, { bin, sandbox: "read-only" });
    const events = await collect(adapter);
    expect(events.some((event) => event.type === "message" && (event.body as any).text === "hello")).toBe(true);
  });

  it("reports non-zero exits with stderr as structured errors", async () => {
    const bin = await fakeCli(`echo 'Invalid API key · Please run /login' >&2\nexit 7`);
    const adapter = new CodexAdapter(input().self, { bin, sandbox: "read-only" });
    const events = await collect(adapter);
    expect(events).toContainEqual(expect.objectContaining({
      type: "system",
      body: expect.objectContaining({ level: "error", category: "auth" }),
    }));
  });

  it("reports a successful process that produced no assistant response", async () => {
    const bin = await fakeCli(`printf '%s\\n' '{"type":"thread.started","thread_id":"thread-1"}' '{"type":"turn.completed"}'`);
    const adapter = new CodexAdapter(input().self, { bin, sandbox: "read-only" });
    const events = await collect(adapter);
    expect(events).toContainEqual(expect.objectContaining({
      type: "system",
      body: expect.objectContaining({ level: "error", category: "empty_output" }),
    }));
  });

  it("falls back from native resume only once", async () => {
    const bin = await fakeCli(`case " $* " in\n  *" resume "*) echo 'native thread missing' >&2; exit 9 ;;\n  *) printf '%s\\n' '{"type":"thread.started","thread_id":"thread-2"}' '{"type":"item.completed","item":{"type":"agent_message","text":"rebuilt"}}';;\nesac`);
    const adapter = new CodexAdapter(input().self, { bin, sandbox: "read-only" });
    const failures: string[] = [];
    const events = await collect(adapter, { ...input("old-thread"), onNativeSessionResumeFailed: (detail) => failures.push(detail) });
    expect(failures).toHaveLength(1);
    expect(events.some((event) => event.type === "message" && (event.body as any).text === "rebuilt")).toBe(true);
  });
});

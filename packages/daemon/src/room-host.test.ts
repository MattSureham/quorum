import { execFile } from "node:child_process";
import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, it, expect } from "vitest";
import type { Room, RoomEvent } from "@quorum/protocol";
import { createParticipant } from "./adapters/registry.js";
import { startRoom } from "./room-host.js";

const exec = promisify(execFile);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(predicate: () => boolean, timeoutMs = 1_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await sleep(10);
  }
  throw new Error("timed out waiting for condition");
}

function testRoom(dbDir: string): Room {
  return {
    id: "room",
    title: "Test room",
    branch: "main",
    policy: { name: "free-for-all", maxTurnsPerTopic: 2, noConsecutive: true, turnDeadlineMs: 1_000 },
    participants: [
      { id: "human", kind: "human", display: "Human", status: "idle" },
      {
        id: "echo",
        kind: "agent",
        display: "Echo",
        adapter: "echo",
        adapterConfig: { text: `echo from ${dbDir}` },
        status: "idle",
      },
    ],
    createdAt: 1,
  };
}

async function makeRepo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "quorum-room-workspace-"));
  await exec("git", ["-C", dir, "init"]);
  await exec("git", ["-C", dir, "config", "user.email", "test@example.com"]);
  await exec("git", ["-C", dir, "config", "user.name", "Test User"]);
  await exec("git", ["-C", dir, "commit", "--allow-empty", "-m", "init"]);
  return dir;
}

describe("RoomHost", () => {
  it("creates the built-in echo adapter through the registry", async () => {
    const participant = createParticipant({
      id: "echo",
      kind: "agent",
      display: "Echo",
      adapter: "echo",
      adapterConfig: { text: "hello" },
      status: "idle",
    });

    const events: RoomEvent[] = [];
    for await (const event of participant.takeTurn({
      turnId: "turn",
      roomTitle: "Room",
      self: participant.descriptor,
      participants: [participant.descriptor],
      projection: [],
      protocol: "",
      signal: new AbortController().signal,
    })) {
      events.push({
        id: "event",
        roomId: "room",
        seq: events.length + 1,
        ts: 1,
        author: participant.descriptor,
        visibility: "room",
        ...event,
      });
    }

    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe("message");
    expect((events[0]?.body as any).text).toBe("hello");
  });

  it("reports missing API-model credentials as a visible message", async () => {
    const oldKey = process.env.TEST_MISSING_MODEL_KEY;
    delete process.env.TEST_MISSING_MODEL_KEY;
    const participant = createParticipant({
      id: "deepseek-v4-pro",
      kind: "agent",
      display: "DeepSeek V4 Pro",
      adapter: "api-model",
      adapterConfig: { model: "deepseek-chat", apiKeyEnv: "TEST_MISSING_MODEL_KEY", baseUrl: "https://api.deepseek.com/v1" },
      status: "idle",
    });

    const events: RoomEvent[] = [];
    try {
      for await (const event of participant.takeTurn({
        turnId: "turn",
        roomTitle: "Room",
        self: participant.descriptor,
        participants: [participant.descriptor],
        projection: [],
        protocol: "",
        signal: new AbortController().signal,
      })) {
        events.push({
          id: "event",
          roomId: "room",
          seq: events.length + 1,
          ts: 1,
          author: participant.descriptor,
          visibility: "room",
          ...event,
        });
      }
    } finally {
      if (oldKey === undefined) delete process.env.TEST_MISSING_MODEL_KEY;
      else process.env.TEST_MISSING_MODEL_KEY = oldKey;
    }

    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe("message");
    expect((events[0]?.body as any).text).toContain("missing API key env var TEST_MISSING_MODEL_KEY");
  });

  it("runs Claude Code through a local CLI subprocess by default", async () => {
    const dir = await mkdtemp(join(tmpdir(), "quorum-claude-cli-"));
    const fakeClaude = join(dir, "claude");
await writeFile(fakeClaude, `#!/bin/sh
if [ -n "$ANTHROPIC_API_KEY" ]; then
  echo "unexpected ANTHROPIC_API_KEY" >&2
  exit 9
fi
case " $* " in
  *" --verbose "*) ;;
  *) echo "missing --verbose" >&2; exit 8 ;;
esac
printf '%s\\n' '{"type":"system","session_id":"fake-session"}'
printf '%s\\n' '{"type":"assistant","message":{"content":[{"type":"text","text":"hello from local claude cli"}]}}'
printf '%s\\n' '{"type":"result","session_id":"fake-session"}'
`);
await chmod(fakeClaude, 0o755);
    const oldAnthropicKey = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = "invalid-project-key";

    const participant = createParticipant({
      id: "claude-code",
      kind: "agent",
      display: "Claude Code",
      adapter: "claude-code",
      adapterConfig: { bin: fakeClaude },
      status: "idle",
    });

    const events: RoomEvent[] = [];
    try {
      for await (const event of participant.takeTurn({
        turnId: "turn",
        roomTitle: "Room",
        self: participant.descriptor,
        participants: [participant.descriptor],
        projection: [],
        protocol: "",
        signal: new AbortController().signal,
      })) {
        events.push({
          id: "event",
          roomId: "room",
          seq: events.length + 1,
          ts: 1,
          author: participant.descriptor,
          visibility: "room",
          ...event,
        });
      }
    } finally {
      if (oldAnthropicKey === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = oldAnthropicKey;
    }

    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe("message");
    expect((events[0]?.body as any).text).toBe("hello from local claude cli");
  });

  it("runs an echo agent from room configuration", async () => {
    const dir = await mkdtemp(join(tmpdir(), "quorum-room-"));
    const room = testRoom(dir);
    const host = await startRoom(room, { dbPath: join(dir, "room.sqlite"), port: 0 });
    const events: RoomEvent[] = [];
    const off = host.log.on((event) => events.push(event));

    try {
      await host.log.append({
        author: { kind: "human", id: "human", display: "Human" },
        type: "message",
        body: { text: "ping" },
      });
      await waitFor(() => events.some((event) => event.author.id === "echo"));

      const echo = events.find((event) => event.author.id === "echo" && event.type === "message");
      expect((echo?.body as any).text).toBe(`echo from ${dir}`);
    } finally {
      off();
      await host.stop();
    }
  });

  it("logs human out-of-band workspace checkpoints", async () => {
    const workspacePath = await makeRepo();
    const dbDir = await mkdtemp(join(tmpdir(), "quorum-room-db-"));
    const room: Room = {
      id: "workspace-room",
      title: "Workspace room",
      workspacePath,
      branch: "main",
      policy: { name: "free-for-all", maxTurnsPerTopic: 2, noConsecutive: true, turnDeadlineMs: 1_000 },
      participants: [{ id: "human", kind: "human", display: "Human", status: "idle" }],
      createdAt: 1,
    };
    const host = await startRoom(room, { dbPath: join(dbDir, "room.sqlite"), port: 0 });
    const events: RoomEvent[] = [];
    const off = host.log.on((event) => events.push(event));

    try {
      await sleep(20);
      await writeFile(join(workspacePath, "manual.txt"), "manual edit\n");
      await waitFor(() => events.some((event) => event.type === "checkpoint"));

      const checkpoint = events.find((event) => event.type === "checkpoint");
      expect(checkpoint?.author.kind).toBe("human");
      expect((checkpoint?.body as any).summary).toBe("out-of-band edit");
      expect((checkpoint?.body as any).stat.files).toBe(1);
    } finally {
      off();
      await host.stop();
    }
  });
});

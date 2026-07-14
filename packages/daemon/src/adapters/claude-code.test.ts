import { chmod, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { TurnInput } from "@quorum/core";
import type { ParticipantDescriptor } from "@quorum/protocol";
import { ClaudeCodeAdapter } from "./claude-code.js";

async function fakeCli(unixSource: string, windowsSource: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "quorum-claude-"));
  const path = join(dir, process.platform === "win32" ? "claude.cmd" : "claude");
  if (process.platform === "win32") {
    await writeFile(path, `@echo off\r\n${windowsSource}\r\n`, "utf8");
  } else {
    await writeFile(path, `#!/bin/sh\n${unixSource}\n`, "utf8");
    await chmod(path, 0o755);
  }
  return path;
}

function input(protocol = ""): TurnInput {
  const self: ParticipantDescriptor = { id: "claude-code", kind: "agent", display: "Claude Code", adapter: "claude-code", status: "idle" };
  return {
    turnId: "turn-1",
    roomTitle: "Test",
    self,
    participants: [self],
    projection: [],
    protocol,
    signal: new AbortController().signal,
  };
}

async function collect(adapter: ClaudeCodeAdapter, turn = input()) {
  const events = [];
  for await (const event of adapter.takeTurn(turn)) events.push(event);
  return events;
}

describe("ClaudeCodeAdapter", () => {
  it("sends untrusted prompt content through stdin instead of argv", async () => {
    const dir = await mkdtemp(join(tmpdir(), "quorum-claude-stdin-"));
    const argvPath = join(dir, "argv.txt");
    const stdinPath = join(dir, "stdin.txt");
    const marker = "CLAUDE_PROMPT_91d & echo unsafe | whoami";
    const bin = await fakeCli(
      `printf '%s' "$*" > '${argvPath}'\ncat > '${stdinPath}'\nprintf '%s\\n' '{"type":"assistant","message":{"content":[{"type":"text","text":"ok"}]}}' '{"type":"result"}'`,
      `echo %* > "${argvPath}"\nmore > "${stdinPath}"\necho {"type":"assistant","message":{"content":[{"type":"text","text":"ok"}]}}\necho {"type":"result"}`,
    );
    const turn = input(marker);
    await collect(new ClaudeCodeAdapter(turn.self, { bin, permissionMode: "default" }), turn);

    expect(await readFile(argvPath, "utf8")).not.toContain(marker);
    expect(await readFile(stdinPath, "utf8")).toContain(marker);
  });

  it("reports non-zero exits as structured errors", async () => {
    const bin = await fakeCli("echo 'Please run /login' >&2\nexit 7", "echo Please run /login 1>&2\nexit /b 7");
    const turn = input();
    const events = await collect(new ClaudeCodeAdapter(turn.self, { bin }), turn);
    expect(events).toContainEqual(expect.objectContaining({
      type: "system",
      body: expect.objectContaining({ level: "error", category: "auth" }),
    }));
  });

  it("reports successful empty output as a structured error", async () => {
    const bin = await fakeCli("exit 0", "exit /b 0");
    const turn = input();
    const events = await collect(new ClaudeCodeAdapter(turn.self, { bin }), turn);
    expect(events).toContainEqual(expect.objectContaining({
      type: "system",
      body: expect.objectContaining({ level: "error", category: "empty_output" }),
    }));
  });
});

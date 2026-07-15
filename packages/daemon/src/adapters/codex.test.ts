import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ParticipantDescriptor } from "@quorum/protocol";
import type { TurnInput } from "@quorum/core";
import { CodexAdapter } from "./codex.js";

async function fakeCli(unixSource: string, windowsSource: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "quorum-codex-"));
  const path = join(dir, process.platform === "win32" ? "codex.cmd" : "codex");
  if (process.platform === "win32") {
    await writeFile(path, `@echo off\r\n${windowsSource}\r\n`, "utf8");
  } else {
    await writeFile(path, `#!/bin/sh\n${unixSource}\n`, "utf8");
    await chmod(path, 0o755);
  }
  return path;
}

function input(nativeSessionId?: string): TurnInput {
  const self: ParticipantDescriptor = { id: "codex", kind: "agent", display: "Codex", adapter: "codex", status: "idle" };
  return {
    sessionId: "room",
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
    const bin = await fakeCli(
      `printf '%s\\n' '{"type":"thread.started","thread_id":"thread-1"}' '{"type":"item.completed","item":{"id":"item-1","type":"agent_message","text":"hello"}}' '{"type":"turn.completed"}'`,
      `echo {"type":"thread.started","thread_id":"thread-1"}\necho {"type":"item.completed","item":{"id":"item-1","type":"agent_message","text":"hello"}}\necho {"type":"turn.completed"}`,
    );
    const adapter = new CodexAdapter(input().self, { bin, sandbox: "read-only" });
    const events = await collect(adapter);
    expect(events.some((event) => event.type === "message" && (event.body as any).text === "hello")).toBe(true);
  });

  it("reports non-zero exits with stderr as structured errors", async () => {
    const bin = await fakeCli(
      `echo 'Invalid API key - Please run /login' >&2\nexit 7`,
      `echo Invalid API key - Please run /login 1>&2\nexit /b 7`,
    );
    const adapter = new CodexAdapter(input().self, { bin, sandbox: "read-only" });
    const events = await collect(adapter);
    expect(events).toContainEqual(expect.objectContaining({
      type: "system",
      body: expect.objectContaining({ level: "error", category: "auth" }),
    }));
  });

  it("reports a successful process that produced no assistant response", async () => {
    const bin = await fakeCli(
      `printf '%s\\n' '{"type":"thread.started","thread_id":"thread-1"}' '{"type":"turn.completed"}'`,
      `echo {"type":"thread.started","thread_id":"thread-1"}\necho {"type":"turn.completed"}`,
    );
    const adapter = new CodexAdapter(input().self, { bin, sandbox: "read-only" });
    const events = await collect(adapter);
    expect(events).toContainEqual(expect.objectContaining({
      type: "system",
      body: expect.objectContaining({ level: "error", category: "empty_output" }),
    }));
  });

  it("classifies a Codex turn.failed timeout", async () => {
    const bin = await fakeCli(
      `printf '%s\n' '{"type":"turn.failed","error":{"message":"Reconnecting... 2/5 (request timed out)"}}'`,
      `echo {"type":"turn.failed","error":{"message":"Reconnecting... 2/5 (request timed out)"}}`,
    );
    const adapter = new CodexAdapter(input().self, { bin, sandbox: "read-only" });
    const events = await collect(adapter);
    expect(events).toContainEqual(expect.objectContaining({
      type: "system",
      body: expect.objectContaining({ level: "error", category: "timeout", text: expect.stringContaining("request timed out") }),
    }));
  });

  it("keeps recoverable transport errors non-terminal when Codex later replies", async () => {
    const bin = await fakeCli(
      `printf '%s\n' '{"type":"thread.started","thread_id":"thread-1"}' '{"type":"error","message":"Reconnecting... 2/5 (request timed out)"}' '{"type":"item.completed","item":{"type":"error","message":"Falling back from WebSockets to HTTPS transport. request timed out"}}' '{"type":"item.completed","item":{"type":"agent_message","text":"recovered"}}' '{"type":"turn.completed"}'`,
      `echo {"type":"thread.started","thread_id":"thread-1"}\necho {"type":"error","message":"Reconnecting... 2/5 (request timed out)"}\necho {"type":"item.completed","item":{"type":"error","message":"Falling back from WebSockets to HTTPS transport. request timed out"}}\necho {"type":"item.completed","item":{"type":"agent_message","text":"recovered"}}\necho {"type":"turn.completed"}`,
    );
    const adapter = new CodexAdapter(input().self, { bin, sandbox: "read-only" });
    const events = await collect(adapter);
    expect(events).toContainEqual(expect.objectContaining({
      type: "thinking",
      body: expect.objectContaining({ text: expect.stringContaining("Reconnecting... 2/5") }),
    }));
    expect(events).toContainEqual(expect.objectContaining({
      type: "message",
      body: expect.objectContaining({ text: "recovered" }),
    }));
    expect(events.some((event) => event.type === "system" && (event.body as any)?.level === "error")).toBe(false);
  });

  it("falls back from native resume only once", async () => {
    const bin = await fakeCli(
      `case " $* " in\n  *" resume "*) echo 'native thread missing' >&2; exit 9 ;;\n  *) printf '%s\\n' '{"type":"thread.started","thread_id":"thread-2"}' '{"type":"item.completed","item":{"type":"agent_message","text":"rebuilt"}}';;\nesac`,
      `echo %* | findstr /C:" resume " >nul\nif not errorlevel 1 (\n  echo native thread missing 1>&2\n  exit /b 9\n)\necho {"type":"thread.started","thread_id":"thread-2"}\necho {"type":"item.completed","item":{"type":"agent_message","text":"rebuilt"}}`,
    );
    const adapter = new CodexAdapter(input().self, { bin, sandbox: "read-only" });
    const failures: string[] = [];
    const events = await collect(adapter, { ...input("old-thread"), onNativeSessionResumeFailed: (detail) => failures.push(detail) });
    expect(failures).toHaveLength(1);
    expect(events.some((event) => event.type === "message" && (event.body as any).text === "rebuilt")).toBe(true);
  });

  it("places Codex exec flags before the resume subcommand", async () => {
    const dir = await mkdtemp(join(tmpdir(), "quorum-codex-resume-"));
    const argvPath = join(dir, "argv.txt");
    const bin = await fakeCli(
      `printf '%s' "$*" > '${argvPath}'\ncat >/dev/null\nprintf '%s\\n' '{"type":"item.completed","item":{"type":"agent_message","text":"resumed"}}'`,
      `echo %* > "${argvPath}"\nmore >nul\necho {"type":"item.completed","item":{"type":"agent_message","text":"resumed"}}`,
    );
    const adapter = new CodexAdapter(input().self, { bin, sandbox: "read-only" });
    await collect(adapter, input("thread-123"));
    const { readFile } = await import("node:fs/promises");
    const argv = (await readFile(argvPath, "utf8")).trim();
    expect(argv).toMatch(/^exec --sandbox read-only resume thread-123 --json -$/);
  });

  it("sends untrusted prompt content through stdin instead of argv", async () => {
    const dir = await mkdtemp(join(tmpdir(), "quorum-codex-stdin-"));
    const argvPath = join(dir, "argv.txt");
    const stdinPath = join(dir, "stdin.txt");
    const marker = "PROMPT_INJECTION_7f3 & echo unsafe | whoami";
    const bin = await fakeCli(
      `printf '%s' "$*" > '${argvPath}'\ncat > '${stdinPath}'\nprintf '%s\\n' '{"type":"item.completed","item":{"type":"agent_message","text":"ok"}}'`,
      `echo %* > "${argvPath}"\nmore > "${stdinPath}"\necho {"type":"item.completed","item":{"type":"agent_message","text":"ok"}}`,
    );
    const adapter = new CodexAdapter(input().self, { bin, sandbox: "read-only" });
    await collect(adapter, { ...input(), protocol: marker });

    const { readFile } = await import("node:fs/promises");
    expect(await readFile(argvPath, "utf8")).not.toContain(marker);
    expect(await readFile(stdinPath, "utf8")).toContain(marker);
  });
});

import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import { BaseAgentAdapter } from "./base.js";
import type { TurnInput, PartialRoomEvent } from "@quorum/core";
import type { ParticipantDescriptor, Capabilities } from "@quorum/protocol";

export interface CodexOptions {
  sandbox?: "read-only" | "workspace-write" | "danger-full-access";
  model?: string;
  bin?: string;
}

/**
 * Drives the Codex CLI in non-interactive JSONL mode: `codex exec --json`.
 * Keeps native tool-calling; resumes its own thread across turns. Dependency-free
 * (uses node:child_process). Verify flags with `codex exec --help`.
 */
export class CodexAdapter extends BaseAgentAdapter {
  private threadId?: string;
  private child?: ChildProcess;

  constructor(descriptor: ParticipantDescriptor, private readonly opts: CodexOptions = {}) {
    super(descriptor);
  }

  capabilities(): Capabilities {
    return { canEditFiles: true, canRunCommands: true, supportsToolApproval: false, nativeTools: ["bash", "edit", "mcp"] };
  }

  async *takeTurn(input: TurnInput): AsyncIterable<PartialRoomEvent> {
    const prompt = this.prompt(input);
    const bin = this.opts.bin ?? "codex";
    const sandbox = this.opts.sandbox ?? "workspace-write";
    const cwd = input.workspacePath ?? process.cwd();
    const flags = ["--json", "--sandbox", sandbox, "--cd", cwd];
    if (this.opts.model) flags.push("-m", this.opts.model);
    const args = this.threadId
      ? ["exec", "resume", this.threadId, ...flags, prompt]
      : ["exec", ...flags, "--skip-git-repo-check", prompt];

    const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    this.child = child;
    const onAbort = () => child.kill("SIGINT");
    input.signal.addEventListener("abort", onAbort, { once: true });

    const queue: PartialRoomEvent[] = [];
    let wake: (() => void) | null = null;
    const push = (e: PartialRoomEvent) => { queue.push(e); wake?.(); wake = null; };

    const rl = createInterface({ input: child.stdout! });
    rl.on("line", (line) => {
      const t = line.trim();
      if (!t) return;
      let ev: Record<string, any>;
      try { ev = JSON.parse(t); } catch { return; }
      switch (ev.type) {
        case "thread.started":
          this.threadId = ev.thread_id;
          break;
        case "item.completed": {
          const it = ev.item ?? {};
          if (it.item_type === "reasoning" && it.text) push({ type: "thinking", body: { text: it.text } });
          else if (it.item_type === "command_execution") {
            push({ type: "tool_call", body: { tool: "bash", args: { command: it.command }, callId: String(it.id ?? "") } });
            push({ type: "tool_result", body: { callId: String(it.id ?? ""), ok: (it.exit_code ?? 0) === 0, stdout: it.aggregated_output, exitCode: it.exit_code } });
          } else if (it.item_type === "mcp_tool_call") {
            push({ type: "tool_call", body: { tool: `mcp:${it.name ?? "tool"}`, args: it.arguments ?? {}, callId: String(it.id ?? "") } });
          } else if (it.item_type === "assistant_message" && it.text) {
            push({ type: "message", body: { text: it.text } });
          }
          break;
        }
        case "turn.failed":
          push({ type: "system", body: { level: "error", text: ev.error?.message ?? "codex turn failed" } });
          break;
        case "error":
          push({ type: "system", body: { level: "error", text: ev.message ?? "codex error" } });
          break;
        default:
          break; // turn.started / turn.completed / item.started: ignore
      }
    });

    let closed = false;
    const done = new Promise<void>((res) => child.on("close", () => { closed = true; res(); wake?.(); }));

    try {
      while (true) {
        if (queue.length) { yield queue.shift()!; continue; }
        if (closed) break;
        await Promise.race([new Promise<void>((r) => { wake = r; }), done]);
      }
    } finally {
      input.signal.removeEventListener("abort", onAbort);
      rl.close();
    }
  }

  async interrupt(): Promise<void> {
    this.child?.kill("SIGINT");
  }
}

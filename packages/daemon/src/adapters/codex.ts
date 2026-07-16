import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import { BaseAgentAdapter } from "./base.js";
import { isRoomTool, normalizeToolName, runRoomTool, type TurnInput, type PartialRoomEvent } from "@quorum/core";
import type { ParticipantDescriptor, Capabilities } from "@quorum/protocol";
import { resolveCliWorkingDirectory, safeCliValue, safeWindowsBinary } from "./cli-safety.js";

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
  private terminateActiveChild?: () => Promise<void>;

  constructor(descriptor: ParticipantDescriptor, private readonly opts: CodexOptions = {}) {
    super(descriptor);
  }

  capabilities(): Capabilities {
    return { canEditFiles: true, canRunCommands: true, supportsToolApproval: false, nativeTools: ["bash", "edit", "mcp"] };
  }

  async *takeTurn(input: TurnInput): AsyncIterable<PartialRoomEvent> {
    if (!this.threadId && input.nativeSessionId) this.threadId = input.nativeSessionId;
    const usedResume = !!this.threadId;
    const prompt = this.prompt(input);
    const bin = safeWindowsBinary(this.opts.bin ?? "codex");
    const sandbox = safeCliValue(this.opts.sandbox ?? "workspace-write", "Codex sandbox");
    const cwd = resolveCliWorkingDirectory(input);
    const flags = ["--sandbox", sandbox];
    if (this.opts.model) flags.push("-m", safeCliValue(this.opts.model, "model"));
    const threadId = this.threadId ? safeCliValue(this.threadId, "thread id") : undefined;
    const args = this.threadId
      ? ["exec", ...flags, "resume", threadId!, "--json", "-"]
      : ["exec", "--json", ...flags, "--skip-git-repo-check", "-"];

    const child = spawn(bin, args, {
      cwd,
      shell: process.platform === "win32",
      detached: process.platform !== "win32",
      stdio: ["pipe", "pipe", "pipe"],
    });
    child.stdin?.end(prompt);
    this.child = child;

    const queue: PartialRoomEvent[] = [];
    let wake: (() => void) | null = null;
    let resumeFailed = false;
    let stderr = "";
    let exitCode: number | null = null;
    let spawnError: Error | undefined;
    let emittedMessage = false;
    let terminalFailure: { detail: string; category: string } | undefined;
    const streamErrors: string[] = [];
    const push = (e: PartialRoomEvent) => { queue.push(e); wake?.(); wake = null; };

    let closed = false;
    const done = new Promise<void>((resolve) => {
      child.on("close", (code) => {
        exitCode = code;
        closed = true;
        resolve();
        wake?.();
        wake = null;
      });
      child.on("error", (error) => {
        spawnError = error;
        exitCode = 1;
        closed = true;
        resolve();
        wake?.();
        wake = null;
      });
    });
    let termination: Promise<void> | undefined;
    const terminate = () => termination ??= terminateChildProcess(child, done);
    this.terminateActiveChild = terminate;
    const onAbort = () => { void terminate(); };
    input.signal.addEventListener("abort", onAbort, { once: true });

    const rl = createInterface({ input: child.stdout! });
    rl.on("line", (line) => {
      const t = line.trim();
      if (!t) return;
      let ev: Record<string, any>;
      try { ev = JSON.parse(t); } catch { return; }
      switch (ev.type) {
        case "thread.started":
          this.threadId = String(ev.thread_id);
          input.onNativeSessionId?.(this.threadId);
          break;
        case "item.completed": {
          const it = ev.item ?? {};
          const itemType = it.type ?? it.item_type;
          if (itemType === "reasoning" && it.text) push({ type: "thinking", body: { text: it.text } });
          else if (itemType === "command_execution") {
            push({ type: "tool_call", body: { tool: "bash", args: { command: it.command }, callId: String(it.id ?? "") } });
            push({ type: "tool_result", body: { callId: String(it.id ?? ""), ok: (it.exit_code ?? 0) === 0, stdout: it.aggregated_output, exitCode: it.exit_code } });
          } else if (itemType === "mcp_tool_call") {
            const rawName = String(it.name ?? it.tool ?? "tool");
            push({ type: "tool_call", body: { tool: `mcp:${rawName}`, args: it.arguments ?? {}, callId: String(it.id ?? "") } });
            // Room tools (§9): a `raise_hand` / `hand_off` call from Codex becomes
            // the corresponding room event, just as it does in-process for Claude.
            if (isRoomTool(rawName)) {
              const out = runRoomTool(normalizeToolName(rawName), (it.arguments as Record<string, unknown>) ?? {}, { readRoom: input.readRoom });
              for (const ev of out.events) push(ev);
            }
          } else if ((itemType === "assistant_message" || itemType === "agent_message") && it.text) {
            emittedMessage = true;
            push({ type: "message", body: { text: it.text } });
          }
          break;
        }
        case "turn.failed":
          if (usedResume) {
            resumeFailed = true;
            input.onNativeSessionResumeFailed?.(ev.error?.message ?? "Codex native resume failed");
            this.threadId = undefined;
            push({ type: "thinking", body: { text: "Native Codex thread resume failed; retrying with Quorum context bundle." } });
            void terminate();
            break;
          }
          {
            const detail = ev.error?.message ?? "codex turn failed";
            terminalFailure = { detail, category: classifyCliFailure(detail) };
            // Do not expose the terminal error to SessionManager until the CLI
            // and its process tree are gone. Otherwise the workspace lease can
            // be released while the failed process is still editing files.
            void terminate();
          }
          break;
        case "error": {
          const detail = String(ev.message ?? "codex transport error");
          streamErrors.push(detail);
          // Current Codex emits `error` records for recoverable transport
          // retries before falling back from WebSockets to HTTPS. The process
          // may still produce a valid assistant message, so only turn.failed,
          // a non-zero exit, or final empty output is terminal.
          push({ type: "thinking", body: { text: `Codex transport notice: ${detail}` } });
          break;
        }
        default:
          break; // turn.started / turn.completed / item.started: ignore
      }
    });
    child.stderr?.on("data", (chunk) => { stderr += chunk.toString(); });

    try {
      while (true) {
        if (queue.length) { yield queue.shift()!; continue; }
        if (closed) break;
        await Promise.race([new Promise<void>((r) => { wake = r; }), done]);
      }
      if (resumeFailed) {
        yield* this.takeTurn({ ...input, nativeSessionId: undefined });
      } else if (terminalFailure) {
        yield {
          type: "system",
          body: { level: "error", text: terminalFailure.detail, category: terminalFailure.category, detail: terminalFailure.detail },
        };
      } else if (spawnError) {
        yield {
          type: "system",
          body: { level: "error", text: `Codex CLI failed to start: ${spawnError.message}`, category: "cli_not_found", detail: spawnError.message },
        };
      } else if (exitCode !== 0) {
        const detail = stderr.trim() || streamErrors.at(-1) || `exit code ${exitCode}`;
        if (usedResume) {
          input.onNativeSessionResumeFailed?.(`Codex resume failed: ${detail}`);
          this.threadId = undefined;
          yield { type: "thinking", body: { text: `Native Codex thread resume failed; retrying with Quorum context bundle. ${detail}` } };
          yield* this.takeTurn({ ...input, nativeSessionId: undefined });
        } else {
          yield {
            type: "system",
            body: { level: "error", text: `Codex CLI failed: ${detail}`, category: classifyCliFailure(detail), detail },
          };
        }
      } else if (!emittedMessage) {
        const detail = (streamErrors.at(-1) ?? stderr.trim()) || undefined;
        yield {
          type: "system",
          body: {
            level: "error",
            text: detail
              ? `Codex CLI completed without an assistant response. Last error: ${detail}`
              : "Codex CLI completed without an assistant response",
            category: detail ? classifyCliFailure(detail) : "empty_output",
            detail,
          },
        };
      }
    } finally {
      input.signal.removeEventListener("abort", onAbort);
      if (closed) await done;
      else await terminate();
      rl.close();
      if (this.child === child) this.child = undefined;
      if (this.terminateActiveChild === terminate) this.terminateActiveChild = undefined;
    }
  }

  async interrupt(): Promise<void> {
    await this.terminateActiveChild?.();
  }
}

async function terminateChildProcess(child: ChildProcess, done: Promise<void>): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    await done;
    return;
  }
  const pid = child.pid;
  if (pid) {
    if (process.platform === "win32") {
      await runTaskkill(pid, false);
    } else {
      signalProcessGroup(child, "SIGINT");
    }
  } else {
    child.kill("SIGINT");
  }
  if (await closesWithin(done, 500)) return;

  if (pid && process.platform === "win32") {
    await runTaskkill(pid, true);
  } else if (pid) {
    signalProcessGroup(child, "SIGKILL");
  } else {
    child.kill("SIGKILL");
  }
  // Holding the caller here is intentional: releasing the SessionManager's
  // workspace lease while an unconfirmed process tree may still write is less
  // safe than surfacing a stuck termination. SIGKILL/taskkill should normally
  // close immediately; if it does not, wait for the actual close event.
  if (!await closesWithin(done, 2_000)) await done;
}

function signalProcessGroup(child: ChildProcess, signal: NodeJS.Signals): void {
  try {
    if (child.pid) process.kill(-child.pid, signal);
    else child.kill(signal);
  } catch {
    try { child.kill(signal); } catch { /* process already exited */ }
  }
}

function runTaskkill(pid: number, force: boolean): Promise<void> {
  return new Promise((resolve) => {
    const killer = spawn("taskkill", ["/PID", String(pid), "/T", ...(force ? ["/F"] : [])], {
      shell: false,
      stdio: "ignore",
      windowsHide: true,
    });
    killer.once("error", () => resolve());
    killer.once("close", () => resolve());
  });
}

async function closesWithin(done: Promise<void>, timeoutMs: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      done.then(() => true),
      new Promise<boolean>((resolve) => { timer = setTimeout(() => resolve(false), timeoutMs); }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function classifyCliFailure(detail: string): string {
  const normalized = detail.toLowerCase();
  if (normalized.includes("login") || normalized.includes("authentication") || normalized.includes("unauthorized")) return "auth";
  if (normalized.includes("unexpected argument") || normalized.includes("unknown option") || normalized.includes("usage:")) return "cli_arguments";
  if (normalized.includes("timed out") || normalized.includes("timeout")) return "timeout";
  return "cli_exit";
}

import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import { BaseAgentAdapter } from "./base.js";
import { ROOM_TOOLS, runRoomTool, ulid, type RoomToolSpec, type TurnInput, type PartialRoomEvent } from "@quorum/core";
import type { ParticipantDescriptor, Capabilities } from "@quorum/protocol";

export interface ClaudeOptions {
  model?: string;
  permissionMode?: "default" | "acceptEdits" | "bypassPermissions" | "plan";
  transport?: "cli" | "sdk";
  bin?: string;
  inheritApiKeyEnv?: boolean;
}

/** Build a zod shape for a room tool using a dynamically-loaded zod (`z`). */
function zodShape(z: any, spec: RoomToolSpec): Record<string, unknown> {
  const shape: Record<string, unknown> = {};
  for (const [key, f] of Object.entries(spec.fields)) {
    let t: any =
      f.type === "number" ? z.number()
      : f.type === "string[]" ? z.array(z.string())
      : f.type === "enum" ? z.enum(f.values as [string, ...string[]])
      : z.string();
    if (f.description) t = t.describe(f.description);
    if (!f.required) t = t.optional();
    shape[key] = t;
  }
  return shape;
}

/**
 * Drives Claude Code through the local CLI by default, so it reuses the same
 * local auth/keychain as a terminal `claude` session. The Agent SDK path remains
 * available behind `adapterConfig.transport = "sdk"` for future in-process MCP
 * work, but it is not the default because it can fall back to API-key auth.
 */
export class ClaudeCodeAdapter extends BaseAgentAdapter {
  private sessionId?: string;
  private ac?: AbortController;
  private child?: ChildProcess;

  constructor(descriptor: ParticipantDescriptor, private readonly opts: ClaudeOptions = {}) {
    super(descriptor);
  }

  capabilities(): Capabilities {
    return {
      canEditFiles: true,
      canRunCommands: true,
      supportsToolApproval: (this.opts.transport ?? "cli") === "sdk",
      nativeTools: ["Read", "Write", "Edit", "Bash", "MCP"],
    };
  }

  async *takeTurn(input: TurnInput): AsyncIterable<PartialRoomEvent> {
    if (this.opts.transport === "sdk") {
      yield* this.takeTurnWithSdk(input);
      return;
    }
    yield* this.takeTurnWithCli(input);
  }

  private async *takeTurnWithCli(input: TurnInput): AsyncIterable<PartialRoomEvent> {
    const prompt = this.prompt(input);
    const bin = this.opts.bin ?? "claude";
    const cwd = input.workspacePath ?? process.cwd();
    const args = [
      "-p",
      "--verbose",
      "--output-format",
      "stream-json",
      "--input-format",
      "text",
      "--permission-mode",
      this.opts.permissionMode ?? "acceptEdits",
      "--append-system-prompt",
      input.self.persona ?? input.protocol,
    ];
    if (this.opts.model) args.push("--model", this.opts.model);
    if (this.sessionId) args.push("--resume", this.sessionId);
    args.push(prompt);

    const env = { ...process.env };
    if (!this.opts.inheritApiKeyEnv) delete env.ANTHROPIC_API_KEY;
    const child = spawn(bin, args, {
      cwd,
      env,
      shell: process.platform === "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });
    this.child = child;
    const onAbort = () => child.kill("SIGINT");
    input.signal.addEventListener("abort", onAbort, { once: true });

    const queue: PartialRoomEvent[] = [];
    let wake: (() => void) | null = null;
    let stderr = "";
    let assistantText = "";
    const push = (e: PartialRoomEvent) => { queue.push(e); wake?.(); wake = null; };
    const flushAssistant = () => {
      const text = assistantText.trim();
      if (text) push(this.msg(text));
      assistantText = "";
    };

    const rl = createInterface({ input: child.stdout! });
    rl.on("line", (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      let ev: Record<string, any>;
      try { ev = JSON.parse(trimmed); } catch { return; }
      if (ev.type === "system" && ev.session_id) {
        this.sessionId = ev.session_id;
      } else if (ev.type === "assistant") {
        for (const block of ev.message?.content ?? []) {
          if (block.type === "text") assistantText += block.text;
          else if (block.type === "tool_use") {
            flushAssistant();
            push({ type: "tool_call", body: { tool: block.name, args: block.input, callId: block.id } });
          }
        }
      } else if (ev.type === "user") {
        for (const block of ev.message?.content ?? []) {
          if (block.type === "tool_result") {
            push({
              type: "tool_result",
              body: {
                callId: block.tool_use_id,
                ok: !block.is_error,
                stdout: typeof block.content === "string" ? block.content : JSON.stringify(block.content),
              },
            });
          }
        }
      } else if (ev.type === "result") {
        this.sessionId = ev.session_id ?? this.sessionId;
        if (ev.result && !assistantText.trim()) assistantText = String(ev.result);
        flushAssistant();
      } else if (ev.type === "error") {
        push(this.msg(String(ev.message ?? "Claude Code CLI error")));
      }
    });
    child.stderr?.on("data", (chunk) => { stderr += chunk.toString(); });

    let exitCode: number | null = null;
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
        exitCode = 1;
        closed = true;
        push(this.msg(`Claude Code CLI failed to start: ${error.message}`));
        resolve();
      });
    });

    try {
      while (true) {
        if (queue.length) { yield queue.shift()!; continue; }
        if (closed) break;
        await Promise.race([new Promise<void>((resolve) => { wake = resolve; }), done]);
      }
      flushAssistant();
      while (queue.length) yield queue.shift()!;
      if (exitCode && exitCode !== 0) {
        const detail = stderr.trim() || `exit code ${exitCode}`;
        yield this.msg(`Claude Code CLI failed. ${detail}`);
      }
    } finally {
      input.signal.removeEventListener("abort", onAbort);
      rl.close();
      this.child = undefined;
    }
  }

  private async *takeTurnWithSdk(input: TurnInput): AsyncIterable<PartialRoomEvent> {
    const sdkModule = "@anthropic-ai/claude-agent-sdk";
    const sdk = await import(sdkModule).catch(() => {
      throw new Error("install @anthropic-ai/claude-agent-sdk to use ClaudeCodeAdapter");
    });
    const ac = new AbortController();
    this.ac = ac;
    const onAbort = () => ac.abort();
    input.signal.addEventListener("abort", onAbort, { once: true });

    // Room tools (§9): an in-process MCP server whose handlers translate a tool
    // call into room events. Handlers push onto `emitted`; the loop below drains
    // it into the turn stream. Identity is stamped by the Conductor, not here.
    const emitted: PartialRoomEvent[] = [];
    let roomServer: unknown;
    try {
      const zodMod: string = "zod";
      const { z } = (await import(zodMod)) as any;
      const tools = ROOM_TOOLS.map((spec) =>
        (sdk as any).tool(spec.name, spec.description, zodShape(z, spec), async (args: Record<string, unknown>) => {
          const out = runRoomTool(spec.name, args, { readRoom: input.readRoom });
          emitted.push(...out.events);
          return { content: [{ type: "text", text: out.reply }] };
        }),
      );
      roomServer = (sdk as any).createSdkMcpServer({ name: "room", version: "0.1.0", tools });
    } catch {
      roomServer = undefined; // no zod / SDK without MCP helpers: degrade to no room tools
    }

    // In "default" permission mode, route each gated tool through the room's
    // human approval (approve_tool); other modes keep their auto behavior.
    const interactive = (this.opts.permissionMode ?? "acceptEdits") === "default";
    const canUseTool =
      interactive && input.requestToolApproval
        ? async (toolName: string, toolInput: Record<string, unknown>) => {
            const allow = await input.requestToolApproval!({ callId: ulid(), tool: toolName, input: toolInput });
            return allow
              ? { behavior: "allow", updatedInput: toolInput }
              : { behavior: "deny", message: "denied by human" };
          }
        : undefined;

    const stream = (sdk as any).query({
      prompt: this.prompt(input),
      options: {
        cwd: input.workspacePath,
        model: this.opts.model,
        resume: this.sessionId,
        permissionMode: this.opts.permissionMode ?? "acceptEdits",
        // preserve Claude Code defaults, append room persona/protocol on top
        systemPrompt: { type: "preset", preset: "claude_code", append: input.self.persona ?? input.protocol },
        ...(roomServer ? { mcpServers: { room: roomServer } } : {}),
        ...(canUseTool ? { canUseTool } : {}),
        abortController: ac,
      },
    });

    let buffer = "";
    try {
      for await (const m of stream as AsyncIterable<any>) {
        if (ac.signal.aborted) break;
        while (emitted.length) yield emitted.shift()!;
        if (m.type === "system" && m.session_id) this.sessionId = m.session_id;
        if (m.type === "assistant") {
          for (const block of m.message?.content ?? []) {
            if (block.type === "text") buffer += block.text;
            else if (block.type === "tool_use") {
              if (buffer.trim()) { yield this.msg(buffer.trim()); buffer = ""; }
              yield { type: "tool_call", body: { tool: block.name, args: block.input, callId: block.id } };
            }
          }
        } else if (m.type === "user") {
          for (const block of m.message?.content ?? []) {
            if (block.type === "tool_result") {
              yield {
                type: "tool_result",
                body: {
                  callId: block.tool_use_id,
                  ok: !block.is_error,
                  stdout: typeof block.content === "string" ? block.content : JSON.stringify(block.content),
                },
              };
            }
          }
        } else if (m.type === "result") {
          this.sessionId = m.session_id ?? this.sessionId;
          break;
        }
      }
    } finally {
      input.signal.removeEventListener("abort", onAbort);
      while (emitted.length) yield emitted.shift()!;
      if (buffer.trim()) yield this.msg(buffer.trim());
    }
  }

  async interrupt(): Promise<void> {
    this.ac?.abort();
    this.child?.kill("SIGINT");
  }
}

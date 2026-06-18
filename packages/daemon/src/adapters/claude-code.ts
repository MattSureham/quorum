import { BaseAgentAdapter } from "./base.js";
import type { TurnInput, PartialRoomEvent } from "@quorum/core";
import type { ParticipantDescriptor, Capabilities } from "@quorum/protocol";

export interface ClaudeOptions {
  model?: string;
  permissionMode?: "default" | "acceptEdits" | "bypassPermissions" | "plan";
}

/**
 * Drives Claude Code via the TypeScript Agent SDK (@anthropic-ai/claude-agent-sdk).
 * Keeps a session across turns (resume) and preserves native tools + MCP (no --bare).
 * The SDK is dynamically imported so the daemon still loads when it isn't installed.
 * NOTE: verify export/option names against the current SDK docs.
 */
export class ClaudeCodeAdapter extends BaseAgentAdapter {
  private sessionId?: string;
  private ac?: AbortController;

  constructor(descriptor: ParticipantDescriptor, private readonly opts: ClaudeOptions = {}) {
    super(descriptor);
  }

  capabilities(): Capabilities {
    return { canEditFiles: true, canRunCommands: true, supportsToolApproval: true, nativeTools: ["Read", "Write", "Edit", "Bash", "MCP"] };
  }

  async *takeTurn(input: TurnInput): AsyncIterable<PartialRoomEvent> {
    const sdkModule = "@anthropic-ai/claude-agent-sdk";
    const sdk = await import(sdkModule).catch(() => {
      throw new Error("install @anthropic-ai/claude-agent-sdk to use ClaudeCodeAdapter");
    });
    const ac = new AbortController();
    this.ac = ac;
    const onAbort = () => ac.abort();
    input.signal.addEventListener("abort", onAbort, { once: true });

    const stream = (sdk as any).query({
      prompt: this.prompt(input),
      options: {
        cwd: input.workspacePath,
        model: this.opts.model,
        resume: this.sessionId,
        permissionMode: this.opts.permissionMode ?? "acceptEdits",
        // preserve Claude Code defaults, append room persona/protocol on top
        systemPrompt: { type: "preset", preset: "claude_code", append: input.self.persona ?? input.protocol },
        abortController: ac,
      },
    });

    let buffer = "";
    try {
      for await (const m of stream as AsyncIterable<any>) {
        if (ac.signal.aborted) break;
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
      if (buffer.trim()) yield this.msg(buffer.trim());
    }
  }

  async interrupt(): Promise<void> {
    this.ac?.abort();
  }
}

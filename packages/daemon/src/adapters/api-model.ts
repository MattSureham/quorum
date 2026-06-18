import { BaseAgentAdapter } from "./base.js";
import type { TurnInput, PartialRoomEvent } from "@quorum/core";
import type { ParticipantDescriptor, Capabilities } from "@quorum/protocol";

export interface ApiModelOptions {
  model: string;
  baseUrl?: string;     // OpenAI-compatible /chat/completions endpoint base
  apiKeyEnv?: string;   // env var holding the key
}

/** A no-file-edit "speaker / second opinion / moderator" backed by a chat API. */
export class ApiModelAdapter extends BaseAgentAdapter {
  private ac?: AbortController;

  constructor(descriptor: ParticipantDescriptor, private readonly opts: ApiModelOptions) {
    super(descriptor);
  }

  capabilities(): Capabilities {
    return { canEditFiles: false, canRunCommands: false, supportsToolApproval: false, nativeTools: [] };
  }

  async *takeTurn(input: TurnInput): AsyncIterable<PartialRoomEvent> {
    const ac = new AbortController();
    this.ac = ac;
    const onAbort = () => ac.abort();
    input.signal.addEventListener("abort", onAbort, { once: true });
    try {
      const base = this.opts.baseUrl ?? "https://api.openai.com/v1";
      const key = process.env[this.opts.apiKeyEnv ?? "OPENAI_API_KEY"] ?? "";
      const res = await fetch(`${base}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model: this.opts.model,
          messages: [
            { role: "system", content: input.protocol },
            { role: "user", content: this.prompt(input) },
          ],
        }),
        signal: ac.signal,
      });
      const data = (await res.json()) as any;
      const text: string = data?.choices?.[0]?.message?.content ?? "";
      if (text) yield this.msg(text);
    } finally {
      input.signal.removeEventListener("abort", onAbort);
    }
  }

  async interrupt(): Promise<void> {
    this.ac?.abort();
  }
}

import { BaseAgentAdapter } from "./base.js";
import type { TurnInput, PartialRoomEvent } from "@quorum/core";
import type { ParticipantDescriptor, Capabilities, MessageAttachment } from "@quorum/protocol";

export interface ApiModelOptions {
  model?: string;
  baseUrl?: string;     // OpenAI-compatible /chat/completions endpoint base
  apiKeyEnv?: string;   // env var holding the key
  apiStyle?: "openai" | "anthropic";
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
      const apiKeyEnv = this.opts.apiKeyEnv ?? "OPENAI_API_KEY";
      const envPrefix = apiKeyEnv.replace(/_API_KEY$/i, "");
      const base = this.opts.baseUrl ?? process.env[`${envPrefix}_BASE_URL`] ?? "https://api.openai.com/v1";
      const model = this.opts.model ?? process.env[`${envPrefix}_MODEL`] ?? "gpt-4o-mini";
      const key = process.env[apiKeyEnv] ?? "";
      if (!key) {
        yield this.msg(`Cannot call ${this.descriptor.display}: missing API key env var ${apiKeyEnv}. Configure it in API keys, then start or retry the session.`);
        return;
      }
      const apiStyle = this.opts.apiStyle ?? "openai";
      const res = await fetch(apiStyle === "anthropic" ? `${base}/messages` : `${base}/chat/completions`, {
        method: "POST",
        headers: apiStyle === "anthropic"
          ? { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" }
          : { "content-type": "application/json", authorization: `Bearer ${key}` },
        body: JSON.stringify(apiStyle === "anthropic"
          ? {
              model,
              max_tokens: 8_192,
              system: input.protocol,
              messages: [{ role: "user", content: anthropicContentFor(input, this.prompt(input)) }],
            }
          : {
              model,
              messages: [
                { role: "system", content: input.protocol },
                { role: "user", content: userContentFor(input, this.prompt(input)) },
              ],
            }),
        signal: ac.signal,
      });
      const data = (await res.json()) as any;
      if (!res.ok) {
        const detail = typeof data?.error?.message === "string" ? data.error.message : `HTTP ${res.status}`;
        yield this.msg(`Cannot call ${this.descriptor.display}: ${detail}`);
        return;
      }
      const text: string = apiStyle === "anthropic"
        ? (data?.content ?? []).filter((block: any) => block?.type === "text").map((block: any) => block.text).join("\n")
        : data?.choices?.[0]?.message?.content ?? "";
      yield this.msg(text || `${this.descriptor.display} returned no text. Check the configured model/base URL for ${apiKeyEnv}.`);
    } finally {
      input.signal.removeEventListener("abort", onAbort);
    }
  }

  async interrupt(): Promise<void> {
    this.ac?.abort();
  }
}

function anthropicContentFor(input: TurnInput, text: string): Array<Record<string, unknown>> {
  return [
    { type: "text", text },
    ...(input.attachments ?? [])
      .filter(hasImagePayload)
      .map((image) => ({
        type: "image",
        source: {
          type: "base64",
          media_type: image.mimeType,
          data: image.dataUrl.slice(image.dataUrl.indexOf(",") + 1),
        },
      })),
  ];
}

function userContentFor(input: TurnInput, text: string): string | Array<Record<string, unknown>> {
  const images = (input.attachments ?? [])
    .filter(hasImagePayload);
  if (!images.length) return text;
  return [
    { type: "text", text },
    ...images.map((image) => ({
      type: "image_url",
      image_url: { url: image.dataUrl },
    })),
  ];
}

function hasImagePayload(attachment: MessageAttachment): attachment is MessageAttachment & { dataUrl: string } {
  return attachment.mimeType.startsWith("image/") && typeof attachment.dataUrl === "string" && attachment.dataUrl.length > 0;
}

import type { Participant } from "@quorum/core";
import type { ParticipantDescriptor } from "@quorum/protocol";
import { CodexAdapter, type CodexOptions } from "./codex.js";
import { ClaudeCodeAdapter, type ClaudeOptions } from "./claude-code.js";
import { ApiModelAdapter, type ApiModelOptions } from "./api-model.js";
import { EchoAdapter, type EchoLine } from "./echo.js";

export type AdapterFactory = (d: ParticipantDescriptor) => Participant;

const registry = new Map<string, AdapterFactory>();

export function registerAdapter(name: string, factory: AdapterFactory): void {
  registry.set(name, factory);
}

export function createParticipant(d: ParticipantDescriptor): Participant {
  const f = registry.get(d.adapter ?? "");
  if (!f) throw new Error(`no adapter registered for "${d.adapter ?? "(none)"}"`);
  return f(d);
}

interface EchoOptions {
  script?: EchoLine[];
  text?: string;
}

// built-in adapters
registerAdapter("echo", (d) => {
  const cfg = (d.adapterConfig as EchoOptions | undefined) ?? {};
  const script = cfg.script ?? [{ type: "message" as const, text: cfg.text ?? "echo" }];
  return new EchoAdapter(d, () => script);
});
registerAdapter("claude-code", (d) => new ClaudeCodeAdapter(d, (d.adapterConfig as ClaudeOptions) ?? {}));
registerAdapter("codex", (d) => new CodexAdapter(d, (d.adapterConfig as CodexOptions) ?? {}));
registerAdapter("api-model", (d) => new ApiModelAdapter(d, (d.adapterConfig as unknown as ApiModelOptions) ?? { model: "gpt-4o-mini" }));

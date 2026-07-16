import type { ParticipantDescriptor } from "@quorum/protocol";

export type PermissionPolicy = "read-only" | "workspace-write" | "approval-required" | "full-auto";

function cleanEchoStep(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const source = value as Record<string, unknown>;
  const step: Record<string, unknown> = {};
  if (Number.isInteger(source.delayMs) && Number(source.delayMs) >= 0 && Number(source.delayMs) <= 60_000) step.delayMs = source.delayMs;
  if (["message", "thinking", "floor_request", "tool"].includes(String(source.type))) step.type = source.type;
  if (typeof source.text === "string") step.text = source.text.slice(0, 20_000);
  if (Array.isArray(source.addressedTo)) {
    step.addressedTo = source.addressedTo
      .filter((item): item is string => typeof item === "string")
      .slice(0, 100)
      .map((item) => item.slice(0, 128));
  }
  if (["reply", "rebut", "act"].includes(String(source.intent))) step.intent = source.intent;
  if (typeof source.tool === "string") step.tool = source.tool.slice(0, 200);
  return step;
}

/** Strip fields copied from historical Echo Sessions to the strict schema. */
export function cleanEchoAdapterConfig(config?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!config) return undefined;
  const cleaned: Record<string, unknown> = {};
  if (typeof config.text === "string") cleaned.text = config.text.slice(0, 20_000);
  if (Array.isArray(config.script)) cleaned.script = config.script.slice(0, 100).map(cleanEchoStep).filter(Boolean);
  return Object.keys(cleaned).length ? cleaned : undefined;
}

/** Apply only adapter fields accepted by the protocol's strict schemas. */
export function withPermissionPolicy(
  participant: ParticipantDescriptor,
  policy: PermissionPolicy,
): ParticipantDescriptor {
  if (!participant.adapter) return participant;
  if (participant.adapter === "echo") {
    return { ...participant, adapterConfig: cleanEchoAdapterConfig(participant.adapterConfig) };
  }
  const adapterConfig: Record<string, unknown> = { ...(participant.adapterConfig ?? {}) };
  if (participant.adapter === "codex") {
    adapterConfig.permissionPolicy = policy;
    adapterConfig.sandbox = policy === "read-only" || policy === "approval-required"
      ? "read-only"
      : policy === "full-auto"
        ? "danger-full-access"
        : "workspace-write";
  } else if (participant.adapter === "claude-code") {
    adapterConfig.permissionPolicy = policy;
    adapterConfig.permissionMode = policy === "full-auto"
      ? "bypassPermissions"
      : policy === "workspace-write"
        ? "acceptEdits"
        : "default";
  } else if (participant.adapter === "api-model") {
    adapterConfig.permissionPolicy = "read-only";
  } else if (participant.adapter === "openclaw") {
    adapterConfig.permissionPolicy = policy;
  } else {
    return participant;
  }
  return { ...participant, adapterConfig };
}

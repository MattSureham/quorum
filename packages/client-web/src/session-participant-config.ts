import type { ParticipantDescriptor } from "@quorum/protocol";

export type PermissionPolicy = "read-only" | "workspace-write" | "approval-required" | "full-auto";

/** Apply only adapter fields accepted by the protocol's strict schemas. */
export function withPermissionPolicy(
  participant: ParticipantDescriptor,
  policy: PermissionPolicy,
): ParticipantDescriptor {
  if (!participant.adapter || participant.adapter === "echo") return participant;
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

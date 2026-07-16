import { describe, expect, it } from "vitest";
import type { ParticipantDescriptor } from "@quorum/protocol";
import { withPermissionPolicy } from "./session-participant-config.js";

function agent(adapter: string, adapterConfig?: Record<string, unknown>): ParticipantDescriptor {
  return { id: adapter, kind: "agent", display: adapter, adapter, adapterConfig, status: "idle" };
}

describe("withPermissionPolicy", () => {
  it("does not add unsupported fields to strict Echo configuration", () => {
    expect(withPermissionPolicy(agent("echo"), "workspace-write").adapterConfig).toBeUndefined();
    expect(withPermissionPolicy(agent("echo", { text: "ready" }), "full-auto").adapterConfig).toEqual({ text: "ready" });
  });

  it("maps file permissions for local CLI adapters", () => {
    expect(withPermissionPolicy(agent("codex"), "approval-required").adapterConfig).toMatchObject({
      permissionPolicy: "approval-required",
      sandbox: "read-only",
    });
    expect(withPermissionPolicy(agent("claude-code"), "workspace-write").adapterConfig).toMatchObject({
      permissionPolicy: "workspace-write",
      permissionMode: "acceptEdits",
    });
  });

  it("keeps direct API models read-only", () => {
    expect(withPermissionPolicy(agent("api-model", { model: "example" }), "full-auto").adapterConfig).toEqual({
      model: "example",
      permissionPolicy: "read-only",
    });
  });
});

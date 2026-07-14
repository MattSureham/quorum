import { describe, expect, it } from "vitest";
import { ClientMessageSchema } from "./schema.js";

const participant = {
  id: "codex",
  kind: "agent" as const,
  display: "Codex",
  adapter: "codex",
  status: "idle" as const,
};

function createMessage(adapterConfig: Record<string, unknown>) {
  return {
    t: "create_session",
    session: {
      id: "room",
      title: "Room",
      mode: "open-discussion",
      participants: [{ id: "human", kind: "human", display: "Human", status: "idle" }, { ...participant, adapterConfig }],
    },
  };
}

describe("ClientMessageSchema adapter configuration", () => {
  it("accepts supported Codex configuration", () => {
    expect(ClientMessageSchema.safeParse(createMessage({ sandbox: "workspace-write", model: "gpt-5.6-sol" })).success).toBe(true);
  });

  it("rejects shell metacharacters and invalid enum values at the network boundary", () => {
    expect(ClientMessageSchema.safeParse(createMessage({ bin: "codex & whoami" })).success).toBe(false);
    expect(ClientMessageSchema.safeParse(createMessage({ sandbox: "workspace-write & whoami" })).success).toBe(false);
  });

  it("rejects arbitrary fields for built-in adapters", () => {
    expect(ClientMessageSchema.safeParse(createMessage({ sandbox: "read-only", arbitrary: "value" })).success).toBe(false);
  });
});

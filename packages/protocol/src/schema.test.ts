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

  it("allows global credential commands without a session id", () => {
    expect(ClientMessageSchema.safeParse({ t: "get_credentials" }).success).toBe(true);
    expect(ClientMessageSchema.safeParse({
      t: "set_credential",
      requestId: "save-1",
      providerId: "deepseek",
      apiKey: "test-key",
    }).success).toBe(true);
  });

  it("accepts only bounded whole-number discussion-round targets", () => {
    expect(ClientMessageSchema.safeParse({
      ...createMessage({ sandbox: "read-only" }),
      session: {
        ...createMessage({ sandbox: "read-only" }).session,
        targetDiscussionRounds: 3,
      },
    }).success).toBe(true);
    for (const targetDiscussionRounds of [0, 1.5, 13]) {
      expect(ClientMessageSchema.safeParse({
        ...createMessage({ sandbox: "read-only" }),
        session: {
          ...createMessage({ sandbox: "read-only" }).session,
          targetDiscussionRounds,
        },
      }).success).toBe(false);
    }
  });
});

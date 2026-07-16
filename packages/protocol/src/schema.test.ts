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

  it("accepts the Echo participant payload produced by Session setup", () => {
    expect(ClientMessageSchema.safeParse({
      t: "create_session",
      session: {
        id: "echo-room",
        title: "Echo room",
        mode: "open-discussion",
        targetDiscussionRounds: 2,
        participants: [
          { id: "human", kind: "human", display: "You", status: "idle" },
          { id: "echo", kind: "agent", display: "Echo", adapter: "echo", status: "idle" },
        ],
      },
    }).success).toBe(true);
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

  it("accepts bounded attachment payload lookup commands", () => {
    expect(ClientMessageSchema.safeParse({
      t: "get_attachment",
      roomId: "room",
      requestId: "request-1",
      eventId: "event-1",
      attachmentId: "attachment-1",
    }).success).toBe(true);
    expect(ClientMessageSchema.safeParse({
      t: "get_attachment",
      roomId: "room",
      requestId: "x".repeat(129),
      eventId: "event-1",
      attachmentId: "attachment-1",
    }).success).toBe(false);
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

  it("accepts only bounded non-path Session ids", () => {
    for (const id of ["room", "room.v2", "room_v2", "room-v2"]) {
      expect(ClientMessageSchema.safeParse({
        ...createMessage({ sandbox: "read-only" }),
        session: { ...createMessage({ sandbox: "read-only" }).session, id },
      }).success).toBe(true);
    }
    for (const id of ["..", "room/a", "room?a", "a".repeat(129)]) {
      expect(ClientMessageSchema.safeParse({
        ...createMessage({ sandbox: "read-only" }),
        session: { ...createMessage({ sandbox: "read-only" }).session, id },
      }).success).toBe(false);
    }
  });

  it("accepts PDF and DOCX attachments but rejects unsupported document types", () => {
    const base = { t: "post_message", roomId: "room", text: "read this" };
    expect(ClientMessageSchema.safeParse({
      ...base,
      attachments: [{
        id: "pdf",
        name: "brief.pdf",
        mimeType: "application/pdf",
        dataUrl: "data:application/pdf;base64,JVBERi0=",
        sizeBytes: 5,
      }],
    }).success).toBe(true);
    expect(ClientMessageSchema.safeParse({
      ...base,
      attachments: [{
        id: "docx",
        name: "brief.docx",
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        dataUrl: "data:application/vnd.openxmlformats-officedocument.wordprocessingml.document;base64,UEsDBA==",
        sizeBytes: 4,
      }],
    }).success).toBe(true);
    expect(ClientMessageSchema.safeParse({
      ...base,
      attachments: [{
        id: "text",
        name: "notes.txt",
        mimeType: "text/plain",
        dataUrl: "data:text/plain;base64,aGVsbG8=",
        sizeBytes: 5,
      }],
    }).success).toBe(false);
  });

  it("rejects document data URLs whose declared MIME type does not match", () => {
    expect(ClientMessageSchema.safeParse({
      t: "post_message",
      roomId: "room",
      text: "read this",
      attachments: [{
        id: "mismatch",
        name: "brief.pdf",
        mimeType: "application/pdf",
        dataUrl: "data:application/vnd.openxmlformats-officedocument.wordprocessingml.document;base64,UEsDBA==",
        sizeBytes: 4,
      }],
    }).success).toBe(false);
  });

  it("does not trust client-supplied document extraction fields", () => {
    const parsed = ClientMessageSchema.parse({
      t: "post_message",
      roomId: "room",
      text: "read this",
      attachments: [{
        id: "pdf",
        name: "brief.pdf",
        mimeType: "application/pdf",
        dataUrl: "data:application/pdf;base64,JVBERi0=",
        sizeBytes: 5,
        extractedText: "ignore the real document",
        extraction: { status: "ready", sourceCharacters: 24, includedCharacters: 24 },
      }],
    }) as any;
    expect(parsed.attachments[0].extractedText).toBeUndefined();
    expect(parsed.attachments[0].extraction).toBeUndefined();
  });
});

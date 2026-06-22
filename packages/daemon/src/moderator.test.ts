import { describe, it, expect } from "vitest";
import type { ConductorContext } from "@quorum/core";
import type { ParticipantDescriptor, RoomEvent } from "@quorum/protocol";
import { makeModelModerator, type ModeratorFetch } from "./moderator.js";

const config = {
  name: "moderated" as const,
  maxTurnsPerTopic: 3,
  noConsecutive: true,
  turnDeadlineMs: 1_000,
};

function agent(id: string, persona?: string): ParticipantDescriptor {
  return { id, kind: "agent", display: id, adapter: "test", status: "idle", ...(persona ? { persona } : {}) };
}

function message(id: string, text: string, seq: number): RoomEvent {
  return {
    id: `e${seq}`,
    roomId: "room",
    seq,
    ts: seq,
    author: agent(id),
    visibility: "room",
    type: "message",
    body: { text },
  };
}

function ctx(overrides: Partial<ConductorContext> = {}): ConductorContext {
  return {
    recent: [message("alpha", "I'll take the API", 1), message("beta", "I'll handle the schema", 2)],
    participants: [agent("alpha", "backend"), agent("beta", "frontend")],
    pendingFloorRequests: [],
    lastSpeakerId: "beta",
    turnsInCurrentTopic: 1,
    config,
    ...overrides,
  };
}

function replyWith(content: string): ModeratorFetch {
  return async () => ({ json: async () => ({ choices: [{ message: { content } }] }) });
}

describe("makeModelModerator", () => {
  it("names the next speaker from the model's JSON reply", async () => {
    const moderator = makeModelModerator({ model: "gpt-4o-mini" }, replyWith(JSON.stringify({ next: "alpha", reason: "alpha owns the API" })));
    const decision = await moderator(ctx());
    expect(decision).toEqual({ next: "alpha", reason: "alpha owns the API" });
  });

  it("posts the configured model and a transcript to the chat-completions endpoint", async () => {
    let seenUrl = "";
    let seenBody: any;
    const fetchImpl: ModeratorFetch = async (url, init) => {
      seenUrl = url;
      seenBody = JSON.parse(init.body);
      return { json: async () => ({ choices: [{ message: { content: JSON.stringify({ next: "alpha", reason: "ok" }) } }] }) };
    };
    const moderator = makeModelModerator({ model: "my-model", baseUrl: "https://example.test/v1" }, fetchImpl);
    await moderator(ctx());
    expect(seenUrl).toBe("https://example.test/v1/chat/completions");
    expect(seenBody.model).toBe("my-model");
    expect(String(seenBody.messages[1].content)).toContain("I'll take the API");
  });

  it("yields to the human when the room has no agents", async () => {
    const moderator = makeModelModerator({ model: "gpt-4o-mini" }, replyWith("unused"));
    const decision = await moderator(ctx({ participants: [{ id: "human", kind: "human", display: "Human", status: "idle" }] }));
    expect(decision.next).toBe("human");
  });

  it("falls back to the human when the request throws", async () => {
    const moderator = makeModelModerator({ model: "gpt-4o-mini" }, async () => { throw new Error("network down"); });
    const decision = await moderator(ctx());
    expect(decision.next).toBe("human");
    expect(decision.reason).toContain("moderator unavailable");
    expect(decision.reason).toContain("network down");
  });

  it("falls back to the human when the reply is not valid JSON", async () => {
    const moderator = makeModelModerator({ model: "gpt-4o-mini" }, replyWith("not json"));
    const decision = await moderator(ctx());
    expect(decision.next).toBe("human");
  });
});

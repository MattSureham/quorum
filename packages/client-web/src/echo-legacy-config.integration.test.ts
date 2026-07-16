import { describe, expect, it } from "vitest";
import type { PartialRoomEvent } from "@quorum/core";
import type { ParticipantDescriptor } from "@quorum/protocol";
import { ClientMessageSchema } from "@quorum/protocol/schema";
import { createParticipant } from "@quorum/daemon";
import { cleanEchoAdapterConfig } from "./session-participant-config.js";

async function runEcho(descriptor: ParticipantDescriptor): Promise<PartialRoomEvent[]> {
  const participant = createParticipant(descriptor);
  const events: PartialRoomEvent[] = [];
  for await (const event of participant.takeTurn({
    turnId: "turn",
    roomTitle: "Room",
    self: descriptor,
    participants: [descriptor],
    projection: [],
    protocol: "",
    signal: new AbortController().signal,
  })) {
    events.push(event);
  }
  return events;
}

describe("legacy Echo config integration", () => {
  it("cleans invalid historical script entries, passes the network schema, and falls back to text at runtime", async () => {
    const adapterConfig = cleanEchoAdapterConfig({
      text: "legacy fallback",
      script: [
        "bad",
        { permissionPolicy: "full-auto" },
        { type: ["message"], intent: ["reply"] },
        { type: { toString: null }, intent: { toString: null } },
      ],
    });
    const parsed = ClientMessageSchema.safeParse({
      t: "create_session",
      requestId: "echo-legacy-create",
      session: {
        id: "echo-legacy-room",
        title: "Echo legacy room",
        mode: "open-discussion",
        participants: [
          { id: "human", kind: "human", display: "Human", status: "idle" },
          { id: "echo", kind: "agent", display: "Echo", adapter: "echo", adapterConfig, status: "idle" },
        ],
      },
    });

    expect(parsed.success).toBe(true);
    if (!parsed.success || parsed.data.t !== "create_session") throw new Error("expected a valid create_session");
    const descriptor = parsed.data.session.participants.find((participant) => participant.id === "echo") as ParticipantDescriptor;
    const events = await runEcho(descriptor);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "message", body: { text: "legacy fallback" } });
  });

  it("treats an already persisted empty script as absent", async () => {
    const events = await runEcho({
      id: "echo",
      kind: "agent",
      display: "Echo",
      adapter: "echo",
      adapterConfig: { text: "persisted fallback", script: [] },
      status: "idle",
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "message", body: { text: "persisted fallback" } });
  });
});

import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Room, RoomEvent } from "@quorum/protocol";
import { startSharedSessionRoom } from "./shared-session-host.js";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(predicate: () => boolean, timeoutMs = 1_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await sleep(10);
  }
  throw new Error("timed out waiting for condition");
}

describe("SharedSessionHost", () => {
  it("routes a human prompt through SessionManager and legacy echo adapter", async () => {
    const dir = await mkdtemp(join(tmpdir(), "quorum-shared-session-"));
    const room: Room = {
      id: "shared-room",
      title: "Shared session room",
      branch: "main",
      policy: { name: "free-for-all", maxTurnsPerTopic: 3, noConsecutive: true, turnDeadlineMs: 1_000 },
      participants: [
        { id: "human", kind: "human", display: "Human", status: "idle" },
        {
          id: "echo",
          kind: "agent",
          display: "Echo",
          adapter: "echo",
          adapterConfig: { text: "shared kernel response" },
          status: "idle",
        },
      ],
      createdAt: Date.now(),
    };
    const host = await startSharedSessionRoom(room, { dbPath: join(dir, "room.sqlite"), port: 0 });
    const events: RoomEvent[] = [];
    const off = host.log.on((event) => events.push(event));

    try {
      await host.session.submitUserPrompt("hello");
      await waitFor(() => events.some((event) => event.type === "turn_completed"));

      expect(events.some((event) => event.type === "phase_changed" && (event.body as any).to === "speaking")).toBe(true);
      expect(events.some((event) => event.type === "bid_submitted" && (event.body as any).bid.agentId === "echo")).toBe(true);
      expect(events.some((event) => event.type === "message" && event.author.id === "echo" && (event.body as any).text === "shared kernel response")).toBe(true);
    } finally {
      off();
      await host.stop();
    }
  });

  it("runs a three-agent open discussion through queued bids", async () => {
    const dir = await mkdtemp(join(tmpdir(), "quorum-shared-session-three-agent-"));
    const room: Room = {
      id: "three-agent-room",
      title: "Three agent room",
      branch: "main",
      policy: { name: "free-for-all", maxTurnsPerTopic: 6, noConsecutive: true, turnDeadlineMs: 1_000 },
      participants: [
        { id: "human", kind: "human", display: "Human", status: "idle" },
        { id: "alpha", kind: "agent", display: "Alpha", adapter: "echo", adapterConfig: { text: "alpha response" }, status: "idle" },
        { id: "bravo", kind: "agent", display: "Bravo", adapter: "echo", adapterConfig: { text: "bravo response" }, status: "idle" },
        { id: "charlie", kind: "agent", display: "Charlie", adapter: "echo", adapterConfig: { text: "charlie response" }, status: "idle" },
      ],
      createdAt: Date.now(),
    };
    const host = await startSharedSessionRoom(room, { dbPath: join(dir, "room.sqlite"), port: 0 });
    const events: RoomEvent[] = [];
    const off = host.log.on((event) => events.push(event));

    try {
      await host.session.submitUserPrompt("open discussion");
      await waitFor(() => {
        const speakers = new Set(
          events
            .filter((event) => event.type === "turn_completed")
            .map((event) => (event.body as any).speakerId),
        );
        return speakers.has("alpha") && speakers.has("bravo") && speakers.has("charlie");
      }, 2_000);

      const bidAgents = new Set(
        events
          .filter((event) => event.type === "bid_submitted")
          .map((event) => (event.body as any).bid.agentId),
      );
      expect(bidAgents).toEqual(new Set(["alpha", "bravo", "charlie"]));
      expect(events.filter((event) => event.type === "speaker_selected")).toHaveLength(3);
      expect(events.some((event) => event.type === "message" && event.author.id === "alpha" && (event.body as any).text === "alpha response")).toBe(true);
      expect(events.some((event) => event.type === "message" && event.author.id === "bravo" && (event.body as any).text === "bravo response")).toBe(true);
      expect(events.some((event) => event.type === "message" && event.author.id === "charlie" && (event.body as any).text === "charlie response")).toBe(true);
    } finally {
      off();
      await host.stop();
    }
  });
});

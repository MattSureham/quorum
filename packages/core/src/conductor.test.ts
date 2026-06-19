import { describe, it, expect } from "vitest";
import type { Capabilities, ParticipantDescriptor, RoomEvent } from "@quorum/protocol";
import { Conductor } from "./conductor.js";
import { EventLog } from "./event-log.js";
import { InMemoryStore } from "./in-memory-store.js";
import { freeForAll } from "./policies/free-for-all.js";
import type { AppendInput, PartialRoomEvent, Participant, TurnInput } from "./types.js";

const config = {
  name: "free-for-all" as const,
  maxTurnsPerTopic: 3,
  noConsecutive: true,
  turnDeadlineMs: 1_000,
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(predicate: () => boolean, timeoutMs = 1_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await sleep(10);
  }
  throw new Error("timed out waiting for condition");
}

function human(text: string): AppendInput {
  return {
    author: { kind: "human", id: "human", display: "Human" },
    type: "message",
    body: { text },
  };
}

function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}

class ScriptedAgent implements Participant {
  readonly descriptor: ParticipantDescriptor;
  interrupts = 0;

  constructor(
    readonly id: string,
    private readonly run: (input: TurnInput) => AsyncIterable<PartialRoomEvent>,
  ) {
    this.descriptor = { id, kind: "agent", display: id, adapter: "test", status: "idle" };
  }

  capabilities(): Capabilities {
    return { canEditFiles: false, canRunCommands: false, supportsToolApproval: false, nativeTools: [] };
  }

  takeTurn(input: TurnInput): AsyncIterable<PartialRoomEvent> {
    return this.run(input);
  }

  async interrupt(): Promise<void> {
    this.interrupts++;
  }
}

describe("Conductor", () => {
  it("interrupts an active agent turn and drops late output", async () => {
    const log = new EventLog("room", new InMemoryStore());
    const events: RoomEvent[] = [];
    log.on((event) => events.push(event));

    const agent = new ScriptedAgent("alpha", async function* (input) {
      yield { type: "message", body: { text: "started" } };
      await abortableSleep(150, input.signal);
      if (!input.signal.aborted) yield { type: "message", body: { text: "late" } };
    });
    const conductor = new Conductor({
      roomId: "room",
      roomTitle: "Test",
      log,
      participants: [agent],
      policy: freeForAll,
      config,
    });

    conductor.start();
    try {
      await log.append(human("start"));
      await waitFor(() => events.some((e) => e.author.id === "alpha" && (e.body as any).text === "started"));

      await log.append(human("stop"));
      await waitFor(() => events.some((e) => e.type === "floor_release" && (e.body as any).reason === "interrupted"));
      await sleep(200);

      expect(agent.interrupts).toBe(1);
      expect(events.some((e) => e.author.id === "alpha" && (e.body as any).text === "late")).toBe(false);
    } finally {
      await conductor.stop();
    }
  });

  it("announces an open floor when the topic budget is reached", async () => {
    const log = new EventLog("room", new InMemoryStore());
    const events: RoomEvent[] = [];
    log.on((event) => events.push(event));

    const agent = new ScriptedAgent("alpha", async function* () {
      yield { type: "message", body: { text: "one turn" } };
    });
    const conductor = new Conductor({
      roomId: "room",
      roomTitle: "Test",
      log,
      participants: [agent],
      policy: freeForAll,
      config: { ...config, maxTurnsPerTopic: 1 },
    });

    conductor.start();
    try {
      await log.append(human("start"));
      await waitFor(() => events.some((e) => e.type === "system" && String((e.body as any).text).includes("topic budget")));

      expect(events.some((e) => e.author.id === "alpha" && (e.body as any).text === "one turn")).toBe(true);
    } finally {
      await conductor.stop();
    }
  });
});

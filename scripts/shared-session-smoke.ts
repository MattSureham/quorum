import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startSharedSessionRoom } from "@quorum/daemon";
import type { Room, RoomEvent } from "@quorum/protocol";

const room: Room = {
  id: "shared-smoke",
  title: "Shared session smoke",
  branch: "main",
  policy: { name: "free-for-all", maxTurnsPerTopic: 3, noConsecutive: true, turnDeadlineMs: 2_000 },
  participants: [
    { id: "human", kind: "human", display: "Human", status: "idle" },
    {
      id: "echo",
      kind: "agent",
      display: "Echo",
      adapter: "echo",
      adapterConfig: { text: "shared-session smoke response" },
      status: "idle",
    },
  ],
  createdAt: Date.now(),
};

async function waitForEvent(url: string): Promise<RoomEvent[]> {
  return new Promise((resolve, reject) => {
    const events: RoomEvent[] = [];
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error("timed out waiting for shared-session response"));
    }, 5_000);

    const ws = new WebSocket(url);
    ws.addEventListener("open", () => {
      ws.send(JSON.stringify({ t: "subscribe", roomId: room.id, sinceSeq: 0 }));
      ws.send(JSON.stringify({ t: "post_message", roomId: room.id, text: "hello shared kernel" }));
    });
    ws.addEventListener("message", (raw) => {
      const msg = JSON.parse(String(raw.data)) as any;
      if (msg.t === "snapshot") events.push(...msg.events);
      if (msg.t === "event") events.push(msg.event);
      const hasResponse = events.some((event) =>
        event.type === "message" &&
        event.author.id === "echo" &&
        (event.body as any).text === "shared-session smoke response",
      );
      const hasPhase = events.some((event) => event.type === "phase_changed" && (event.body as any).to === "speaking");
      const hasBid = events.some((event) => event.type === "bid_submitted");
      if (hasResponse && hasPhase && hasBid) {
        clearTimeout(timeout);
        ws.close();
        resolve(events);
      }
    });
    ws.addEventListener("error", () => reject(new Error("websocket error")));
  });
}

const dir = await mkdtemp(join(tmpdir(), "quorum-shared-smoke-"));
const host = await startSharedSessionRoom(room, { dbPath: join(dir, "quorum.sqlite"), port: 0 });

try {
  const events = await waitForEvent(host.gateway.url());
  console.log(`shared-session smoke pass (${events.length} events)`);
} finally {
  await host.stop();
}

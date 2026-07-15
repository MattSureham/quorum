import { spawn } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { RoomEvent } from "@quorum/protocol";

interface Handshake {
  port: number;
  token: string;
  bootId: string;
  protocolVersion: number;
}

function readHandshake(proc: ReturnType<typeof spawn>): Promise<Handshake> {
  return new Promise((resolve, reject) => {
    let buf = "";
    const timer = setTimeout(() => reject(new Error("node sidecar handshake timed out")), 5_000);
    proc.stdout?.on("data", (chunk) => {
      buf += String(chunk);
      const line = buf.split("\n")[0]?.trim();
      if (!line) return;
      clearTimeout(timer);
      resolve(JSON.parse(line) as Handshake);
    });
    proc.once("error", reject);
    proc.once("exit", (code) => {
      if (code !== null && code !== 0) reject(new Error(`node sidecar exited early: ${code}`));
    });
  });
}

function roundTrip(handshake: Handshake): Promise<RoomEvent[]> {
  return new Promise((resolve, reject) => {
    const events: RoomEvent[] = [];
    const timer = setTimeout(() => reject(new Error("node sidecar websocket timed out")), 5_000);
    const ws = new WebSocket(`ws://127.0.0.1:${handshake.port}?token=${handshake.token}`);
    ws.addEventListener("open", () => {
      ws.send(JSON.stringify({ t: "subscribe", roomId: "main", sinceSeq: 0 }));
      ws.send(JSON.stringify({ t: "post_message", roomId: "main", text: "node sidecar smoke" }));
    });
    ws.addEventListener("message", (raw) => {
      const msg = JSON.parse(String(raw.data)) as any;
      if (msg.t === "snapshot") events.push(...msg.events);
      if (msg.t === "event") events.push(msg.event);
      const ok = events.some((event) =>
        event.type === "message" &&
        event.author.id === "echo" &&
        (event.body as any).text === "sidecar ready",
      );
      if (ok) {
        clearTimeout(timer);
        ws.close();
        resolve(events);
      }
    });
    ws.addEventListener("error", () => reject(new Error("websocket error")));
  });
}

await import("./build-sidecar-node.js");

const dir = await mkdtemp(join(tmpdir(), "quorum-node-sidecar-smoke-"));
const proc = spawn(resolve("dist-sidecar/node/quorum-sidecar"), [], {
  cwd: process.cwd(),
  env: { ...process.env, QUORUM_DB_PATH: join(dir, "sidecar.sqlite") },
  stdio: ["ignore", "pipe", "inherit"],
});

try {
  const handshake = await readHandshake(proc);
  if (handshake.protocolVersion !== 2) throw new Error(`unexpected sidecar protocol ${handshake.protocolVersion}`);
  const events = await roundTrip(handshake);
  console.log(`node sidecar fallback smoke pass (${events.length} events, port ${handshake.port})`);
} finally {
  proc.kill("SIGTERM");
}

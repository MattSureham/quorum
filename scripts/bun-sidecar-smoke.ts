import { spawn, execFile } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import type { RoomEvent } from "@quorum/protocol";

const exec = promisify(execFile);

interface Handshake {
  port: number;
  token: string;
  bootId: string;
}

function readHandshake(proc: ReturnType<typeof spawn>): Promise<Handshake> {
  return new Promise((resolve, reject) => {
    let buf = "";
    const timer = setTimeout(() => reject(new Error("bun sidecar handshake timed out")), 5_000);
    proc.stdout?.on("data", (chunk) => {
      buf += String(chunk);
      const line = buf.split("\n")[0]?.trim();
      if (!line) return;
      clearTimeout(timer);
      resolve(JSON.parse(line) as Handshake);
    });
    proc.once("error", reject);
    proc.once("exit", (code) => {
      if (code !== null && code !== 0) reject(new Error(`bun sidecar exited early: ${code}`));
    });
  });
}

function roundTrip(handshake: Handshake): Promise<RoomEvent[]> {
  return new Promise((resolve, reject) => {
    const events: RoomEvent[] = [];
    const timer = setTimeout(() => reject(new Error("bun sidecar websocket timed out")), 5_000);
    const ws = new WebSocket(`ws://127.0.0.1:${handshake.port}?token=${handshake.token}`);
    ws.addEventListener("open", () => {
      ws.send(JSON.stringify({ t: "subscribe", roomId: "main", sinceSeq: 0 }));
      ws.send(JSON.stringify({ t: "post_message", roomId: "main", text: "bun sidecar smoke" }));
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

await exec("tsx", ["scripts/build-sidecar-bun.ts"], { cwd: process.cwd() });

const dir = await mkdtemp(join(tmpdir(), "quorum-bun-sidecar-smoke-"));
const proc = spawn(resolve("dist-sidecar/bun/quorum-sidecar"), [], {
  cwd: process.cwd(),
  env: { ...process.env, QUORUM_DB_PATH: join(dir, "sidecar.sqlite") },
  stdio: ["ignore", "pipe", "inherit"],
});

try {
  const handshake = await readHandshake(proc);
  const events = await roundTrip(handshake);
  console.log(`bun sidecar smoke pass (${events.length} events, port ${handshake.port})`);
} finally {
  proc.kill("SIGTERM");
}

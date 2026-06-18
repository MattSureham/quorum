#!/usr/bin/env -S node --experimental-strip-types
import { startRoom } from "@quorum/daemon";
import type { Room } from "@quorum/protocol";

// Minimal launcher (paseo-style). A fuller CLI would read quorum.config.json
// and support `quorum start | connect | add-agent`.
const room: Room = {
  id: "main",
  title: "Quorum",
  workspacePath: process.cwd(),
  branch: process.env.QUORUM_BRANCH ?? "main",
  primary: "claude",
  policy: { name: "free-for-all", maxTurnsPerTopic: 6, noConsecutive: true, turnDeadlineMs: 180_000 },
  participants: [
    { id: "matt", kind: "human", display: "You", status: "idle" },
    { id: "claude", kind: "agent", display: "Claude", adapter: "claude-code", adapterConfig: { permissionMode: "acceptEdits" }, status: "idle" },
    { id: "codex", kind: "agent", display: "Codex", adapter: "codex", adapterConfig: { sandbox: "workspace-write" }, status: "idle" },
  ],
  createdAt: Date.now(),
};

const port = Number(process.env.QUORUM_PORT ?? 8787);
const host = await startRoom(room, { port });
console.log(`Quorum daemon on ws://127.0.0.1:${port}  (room "${room.id}", workspace ${room.workspacePath})`);
process.on("SIGINT", async () => { await host.stop(); process.exit(0); });

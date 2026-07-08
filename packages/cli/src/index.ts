#!/usr/bin/env -S node --experimental-strip-types
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { startRoom, startSharedSessionRoom } from "@quorum/daemon";
import type { ConductorPolicyConfig, ParticipantDescriptor, Room } from "@quorum/protocol";

interface RoomConfig {
  id: string;
  title?: string;
  workspacePath?: string;
  branch?: string;
  primary?: string;
  policy: ConductorPolicyConfig;
  participants: ParticipantDescriptor[];
}

const DEFAULT_CONFIG: RoomConfig = {
  id: "main",
  title: "Quorum",
  primary: "claude",
  policy: { name: "free-for-all", maxTurnsPerTopic: 6, noConsecutive: true, turnDeadlineMs: 180_000 },
  participants: [
    { id: "matt",   kind: "human", display: "You",    status: "idle" },
    { id: "claude", kind: "agent", display: "Claude", adapter: "claude-code", adapterConfig: { permissionMode: "bypassPermissions" }, status: "idle" },
    { id: "codex",  kind: "agent", display: "Codex",  adapter: "codex",        adapterConfig: { sandbox: "workspace-write" },        status: "idle" },
  ],
};

function loadConfig(): { cfg: RoomConfig; source: string } {
  const path = process.env.QUORUM_CONFIG ?? resolve("quorum.config.json");
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return { cfg: DEFAULT_CONFIG, source: "<built-in defaults>" };
  }
  const cfg = JSON.parse(raw) as RoomConfig;
  if (!cfg.id || !cfg.policy || !Array.isArray(cfg.participants) || cfg.participants.length === 0) {
    throw new Error(`Invalid room config at ${path}: needs { id, policy, participants[] }`);
  }
  return { cfg, source: path };
}

const { cfg, source } = loadConfig();

const room: Room = {
  id: cfg.id,
  title: cfg.title ?? "Quorum",
  workspacePath: cfg.workspacePath ?? process.cwd(),
  branch: cfg.branch ?? process.env.QUORUM_BRANCH ?? "main",
  primary: cfg.primary,
  policy: cfg.policy,
  participants: cfg.participants,
  createdAt: Date.now(),
};

const port = Number(process.env.QUORUM_PORT ?? 8787);
const sharedSession = process.env.QUORUM_SESSION_KERNEL === "shared";
const host = sharedSession
  ? await startSharedSessionRoom(room, { port, dbPath: process.env.QUORUM_DB_PATH })
  : await startRoom(room, { port });
console.log(`Quorum daemon on ws://127.0.0.1:${port}  (room "${room.id}", workspace ${room.workspacePath})`);
console.log(`  session kernel: ${sharedSession ? "shared-session" : "legacy-conductor"}`);
console.log(`  config: ${source}`);
process.on("SIGINT", async () => { await host.stop(); process.exit(0); });

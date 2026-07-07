#!/usr/bin/env node
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ConductorPolicyConfig, ParticipantDescriptor, Room } from "@quorum/protocol";
import { startSharedSessionRoom } from "./shared-session-host.js";

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
  primary: "echo",
  policy: { name: "free-for-all", maxTurnsPerTopic: 6, noConsecutive: true, turnDeadlineMs: 180_000 },
  participants: [
    { id: "human", kind: "human", display: "Human", status: "idle" },
    { id: "echo", kind: "agent", display: "Echo", adapter: "echo", adapterConfig: { text: "sidecar ready" }, status: "idle" },
  ],
};

function loadConfig(): RoomConfig {
  const path = process.env.QUORUM_CONFIG;
  if (!path) return DEFAULT_CONFIG;
  return JSON.parse(readFileSync(resolve(path), "utf8")) as RoomConfig;
}

const cfg = loadConfig();
const token = randomBytes(32).toString("hex");
const bootId = randomUUID();
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

const host = await startSharedSessionRoom(room, {
  dbPath: process.env.QUORUM_DB_PATH,
  port: 0,
  authToken: token,
});
const { port } = host.gateway.address();
process.stdout.write(`${JSON.stringify({ port, token, bootId })}\n`);

async function shutdown(): Promise<void> {
  await host.stop();
}

process.on("SIGINT", () => void shutdown().finally(() => process.exit(0)));
process.on("SIGTERM", () => void shutdown().finally(() => process.exit(0)));

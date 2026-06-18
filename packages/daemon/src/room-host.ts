import { EventLog, Conductor, freeForAll, directed, makeModerated } from "@quorum/core";
import type { Participant, ConductorPolicy } from "@quorum/core";
import type { Room, ConductorPolicyConfig } from "@quorum/protocol";
import { SqliteStore } from "./persistence/sqlite-store.js";
import { GitWorkspace } from "./workspace/git-workspace.js";
import { Gateway } from "./gateway/ws-server.js";
import { createParticipant } from "./adapters/registry.js";

function policyFor(cfg: ConductorPolicyConfig): ConductorPolicy {
  if (cfg.name === "directed") return directed;
  if (cfg.name === "moderated") return makeModerated(async () => ({ next: "human", reason: "no moderator wired yet" }));
  return freeForAll;
}

export interface RoomHost {
  log: EventLog;
  conductor: Conductor;
  gateway: Gateway;
  stop(): Promise<void>;
}

/** Wire store -> log -> conductor -> participants -> workspace -> gateway for one room. */
export async function startRoom(room: Room, opts: { dbPath?: string; port?: number } = {}): Promise<RoomHost> {
  const store = new SqliteStore(opts.dbPath);
  const log = new EventLog(room.id, store);

  const participants: Participant[] = room.participants
    .filter((p) => p.kind === "agent")
    .map(createParticipant);

  const humanId = room.participants.find((p) => p.kind === "human")?.id;

  let workspace: GitWorkspace | undefined;
  if (room.workspacePath) {
    workspace = new GitWorkspace(room.workspacePath, room.branch);
    await workspace.init();
  }

  const conductor = new Conductor({
    roomId: room.id,
    roomTitle: room.title,
    log,
    participants,
    policy: policyFor(room.policy),
    config: room.policy,
    primary: room.primary,
    workspace,
    workspacePath: room.workspacePath,
  });
  conductor.start();

  const unwatch = workspace?.watchOutOfBand((stat) => {
    if (stat.files > 0) {
      void log.append({
        author: { kind: "human", id: humanId ?? "human", display: "Human" },
        type: "checkpoint",
        body: { preHead: "", postHead: "", stat, summary: "out-of-band edit" },
      });
    }
  });

  const gateway = new Gateway(
    { log, room, humanId, setPolicy: (cfg) => conductor.setPolicy(policyFor(cfg), cfg) },
    opts.port,
  );

  return {
    log,
    conductor,
    gateway,
    async stop() {
      unwatch?.();
      await conductor.stop();
      gateway.close();
    },
  };
}

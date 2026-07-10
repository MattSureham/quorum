import { EventLog, Conductor, freeForAll, directed, makeModerated } from "@quorum/core";
import type { Participant, ConductorPolicy } from "@quorum/core";
import type { Room, ConductorPolicyConfig } from "@quorum/protocol";
import { SqliteStore } from "./persistence/sqlite-store.js";
import { GitWorkspace } from "./workspace/git-workspace.js";
import { Gateway } from "./gateway/ws-server.js";
import { createParticipant } from "./adapters/registry.js";
import { makeModelModerator } from "./moderator.js";

function policyFor(cfg: ConductorPolicyConfig): ConductorPolicy {
  if (cfg.name === "directed") return directed;
  if (cfg.name === "moderated") {
    const model = cfg.moderatorModel ?? process.env.QUORUM_MODERATOR_MODEL ?? "gpt-4o-mini";
    return makeModerated(makeModelModerator({ model, baseUrl: process.env.QUORUM_MODERATOR_BASE_URL }));
  }
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

  const unwatch = workspace?.watchOutOfBand((checkpoint) => {
    void log.append({
      author: { kind: "human", id: humanId ?? "human", display: "Human" },
      type: "checkpoint",
      body: checkpoint,
    });
  });

  const ws = workspace;
  const gateway = new Gateway(
    {
      log,
      room,
      humanId,
      setPolicy: (cfg) => conductor.setPolicy(policyFor(cfg), cfg),
      approveTool: (callId, allow) => conductor.resolveToolApproval(callId, allow),
      takeWriteFloor: () => conductor.takeWriteFloor(),
      releaseWriteFloor: () => conductor.releaseWriteFloor(),
      rollback: ws
        ? async (toHead) => {
            // Serialize behind any active edit, then reset, then announce (SPEC §7.4).
            const lease = await ws.acquireWriteFloor("rollback", "human");
            try {
              await ws.rollbackTo(toHead);
            } finally {
              lease.release();
            }
            await log.append({
              author: { kind: "system", id: "workspace", display: "Workspace" },
              type: "system",
              body: { level: "warn", text: `rolled back to ${toHead}` },
            });
          }
        : undefined,
    },
    opts.port,
  );
  await gateway.ready;

  return {
    log,
    conductor,
    gateway,
    async stop() {
      unwatch?.();
      await conductor.stop();
      await gateway.close();
      store.close();
    },
  };
}

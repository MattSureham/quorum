import { EventLog, LegacyAgentAdapter, SessionManager } from "@quorum/core";
import type { Room } from "@quorum/protocol";
import { createParticipant } from "./adapters/registry.js";
import { Gateway } from "./gateway/ws-server.js";
import { SqliteStore } from "./persistence/sqlite-store.js";

export interface SharedSessionHost {
  log: EventLog;
  session: SessionManager;
  gateway: Gateway;
  stop(): Promise<void>;
}

/**
 * New architecture entrypoint: existing adapters are wrapped into ISpeakerAgent
 * and human prompts are routed through SessionManager instead of Conductor.
 */
export async function startSharedSessionRoom(
  room: Room,
  opts: { dbPath?: string; port?: number; authToken?: string } = {},
): Promise<SharedSessionHost> {
  const store = new SqliteStore(opts.dbPath);
  const log = new EventLog(room.id, store);
  const participants = room.participants
    .filter((participant) => participant.kind === "agent")
    .map(createParticipant);
  const agents = participants.map((participant) => new LegacyAgentAdapter(participant));
  const humans = room.participants.filter((participant) => participant.kind === "human");

  const session = new SessionManager({
    sessionId: room.id,
    title: room.title,
    log,
    agents,
    humans,
    settlingWindowMs: 400,
    turnTimeoutMs: room.policy.turnDeadlineMs,
  });
  session.start();

  const gateway = new Gateway(
    {
      log,
      room,
      humanId: humans[0]?.id,
      authToken: opts.authToken,
      postMessage: (text, addressedTo) => session.submitUserPrompt(text, addressedTo),
      setPolicy: () => {
        void log.append({
          author: { kind: "system", id: "session", display: "SessionManager" },
          type: "system",
          body: { level: "warn", text: "set_policy is not available in shared-session mode yet" },
          visibility: "system",
        });
      },
    },
    opts.port,
  );
  await gateway.ready;

  return {
    log,
    session,
    gateway,
    async stop() {
      await session.stop();
      await gateway.close();
      store.close();
    },
  };
}

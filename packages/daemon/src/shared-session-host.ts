import { EventLog, LegacyAgentAdapter, SessionManager } from "@quorum/core";
import type { CreateSessionInput, ParticipantDescriptor, Room, SessionMode } from "@quorum/protocol";
import { createParticipant } from "./adapters/registry.js";
import { Gateway, type GatewaySessionDeps } from "./gateway/ws-server.js";
import { SqliteStore } from "./persistence/sqlite-store.js";
import { createLocalSandboxToolExecutor } from "./tools/local-sandbox-executor.js";

export interface SharedSessionHost {
  log: EventLog;
  session: SessionManager;
  gateway: Gateway;
  stop(): Promise<void>;
}

interface ManagedSharedSession {
  room: Room;
  log: EventLog;
  session: SessionManager;
  gatewayDeps: GatewaySessionDeps;
}

function policyForMode(mode: SessionMode, base: Room["policy"]): Room["policy"] {
  if (mode === "raise-hand") return { ...base, name: "free-for-all", noConsecutive: true };
  if (mode === "round-robin") return { ...base, name: "directed", noConsecutive: true };
  return { ...base, name: "free-for-all" };
}

function ensureHuman(participants: ParticipantDescriptor[]): ParticipantDescriptor[] {
  return participants.some((participant) => participant.kind === "human")
    ? participants
    : [{ id: "human", kind: "human", display: "You", status: "idle" }, ...participants];
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
  store.applyProviderConfigsToEnv();
  const managed = new Map<string, ManagedSharedSession>();

  function createManaged(nextRoom: Room): ManagedSharedSession {
    const existing = managed.get(nextRoom.id);
    if (existing) return existing;
    store.upsertSessionRoom(nextRoom);
    const log = new EventLog(nextRoom.id, store);
    const participants = nextRoom.participants
      .filter((participant) => participant.kind === "agent")
      .map(createParticipant);
    const agents = participants.map((participant) => new LegacyAgentAdapter(participant, {
      workspacePath: nextRoom.workspacePath,
      nativeSessionStore: {
        read: (sessionId, agentId) => {
          const value = store.readAgentPrivateMemory(sessionId, agentId, "native_session", "id");
          return typeof value === "string" ? value : undefined;
        },
        write: (sessionId, agentId, nativeSessionId) =>
          store.writeAgentPrivateMemory(sessionId, agentId, "native_session", "id", nativeSessionId),
      },
      onNativeSessionResumeFailed: (agentId, detail) => {
        void log.append({
          author: { kind: "system", id: "session", display: "SessionManager" },
          type: "system",
          body: { level: "warn", text: `native session resume failed for ${agentId}: ${detail}` },
          visibility: "debug",
        });
      },
    }));
    const humans = nextRoom.participants.filter((participant) => participant.kind === "human");

    const session = new SessionManager({
      sessionId: nextRoom.id,
      title: nextRoom.title,
      log,
      agents,
      humans,
      workspacePath: nextRoom.workspacePath,
      toolExecutor: nextRoom.workspacePath ? createLocalSandboxToolExecutor({ workspacePath: nextRoom.workspacePath }) : undefined,
      settlingWindowMs: 400,
      turnTimeoutMs: nextRoom.policy.turnDeadlineMs,
    });
    session.start();
    const gatewayDeps: GatewaySessionDeps = {
      log,
      room: nextRoom,
      humanId: humans[0]?.id,
      postMessage: (text, addressedTo, attachments) => session.submitUserPrompt(text, addressedTo, attachments),
      interrupt: (hard) => session.interrupt("human", hard),
      approveTool: (callId, allow) => session.approveTool(callId, allow),
      compactMemory: (fromSeq, toSeq) => session.compactWorkingMemory(fromSeq, toSeq),
      listCredentials: () => store.readProviderConfigViews(),
      setCredential: (input) => store.upsertProviderConfig(input),
      setPolicy: () => {
        void log.append({
          author: { kind: "system", id: "session", display: "SessionManager" },
          type: "system",
          body: { level: "warn", text: "set_policy is not available in shared-session mode yet" },
          visibility: "system",
        });
      },
    };
    const created = { room: nextRoom, log, session, gatewayDeps };
    managed.set(nextRoom.id, created);
    return created;
  }

  const primary = createManaged(room);

  function listRooms(): Room[] {
    const rooms = new Map<string, Room>();
    for (const row of store.listSessionRows()) {
      const storedRoom = row.room ?? store.readSessionRoom(row.sessionId);
      if (storedRoom) rooms.set(storedRoom.id, storedRoom);
    }
    for (const item of managed.values()) rooms.set(item.room.id, item.room);
    return [...rooms.values()];
  }

  function continueManaged(sessionId: string): GatewaySessionDeps {
    const existing = managed.get(sessionId);
    if (existing) return existing.gatewayDeps;
    const storedRoom = store.readSessionRoom(sessionId);
    if (!storedRoom) throw new Error(`unknown session: ${sessionId}`);
    return createManaged(storedRoom).gatewayDeps;
  }

  const gateway = new Gateway(
    {
      ...primary.gatewayDeps,
      authToken: opts.authToken,
      listCredentials: () => store.readProviderConfigViews(),
      setCredential: (input) => store.upsertProviderConfig(input),
      listSessions: listRooms,
      createSession: (input: CreateSessionInput) => {
        if (managed.has(input.id) || store.readSessionRoom(input.id)) throw new Error(`session already exists: ${input.id}`);
        const nextRoom: Room = {
          id: input.id,
          title: input.title || input.id,
          workspacePath: input.workspacePath?.trim() || room.workspacePath,
          branch: room.branch,
          primary: input.participants.find((participant) => participant.kind === "agent")?.id,
          policy: policyForMode(input.mode, room.policy),
          participants: ensureHuman(input.participants),
          createdAt: Date.now(),
        };
        return createManaged(nextRoom).gatewayDeps;
      },
      continueSession: continueManaged,
    },
    opts.port,
  );
  await gateway.ready;

  return {
    log: primary.log,
    session: primary.session,
    gateway,
    async stop() {
      await Promise.all([...managed.values()].map((item) => item.session.stop()));
      await gateway.close();
      store.close();
    },
  };
}

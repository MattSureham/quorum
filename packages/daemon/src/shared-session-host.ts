import { EventLog, LegacyAgentAdapter, SessionManager, type WorkspaceManager } from "@quorum/core";
import type { AgentHealth, CreateSessionInput, ParticipantDescriptor, Room, SessionMode } from "@quorum/protocol";
import { execFile } from "node:child_process";
import { mkdirSync } from "node:fs";
import { readdir, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { createParticipant } from "./adapters/registry.js";
import { Gateway, type GatewaySessionDeps } from "./gateway/ws-server.js";
import { SqliteStore } from "./persistence/sqlite-store.js";
import { createLocalSandboxToolExecutor } from "./tools/local-sandbox-executor.js";
import { GitWorkspace } from "./workspace/git-workspace.js";

const exec = promisify(execFile);

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
  unwatch?: () => void;
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

function readyWorkspace(workspace: GitWorkspace, ready: Promise<void>): WorkspaceManager {
  return {
    async acquireWriteFloor(turnId, who) {
      await ready;
      return workspace.acquireWriteFloor(turnId, who);
    },
    async snapshotPre() {
      await ready;
      return workspace.snapshotPre();
    },
    async checkpoint(turnId, who, eventId) {
      await ready;
      return workspace.checkpoint(turnId, who, eventId);
    },
    async rollbackTo(head) {
      await ready;
      return workspace.rollbackTo(head);
    },
  };
}

async function commandExists(bin: string): Promise<boolean> {
  try {
    await exec(bin, ["--version"], { timeout: 2_500, shell: process.platform === "win32" });
    return true;
  } catch {
    try {
      await exec(bin, ["--help"], { timeout: 2_500, shell: process.platform === "win32" });
      return true;
    } catch {
      return false;
    }
  }
}

async function commandSupports(bin: string, args: string[], required: string[]): Promise<{ ok: boolean; detail?: string }> {
  try {
    const { stdout, stderr } = await exec(bin, args, { timeout: 2_500, shell: process.platform === "win32" });
    const help = `${stdout}\n${stderr}`;
    const missing = required.filter((flag) => !help.includes(flag));
    return missing.length
      ? { ok: false, detail: `${bin} is installed but lacks required flags: ${missing.join(", ")}` }
      : { ok: true };
  } catch (err) {
    return { ok: false, detail: `${bin} compatibility check failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}

async function checkParticipantHealth(participant: ParticipantDescriptor): Promise<AgentHealth> {
  const adapter = participant.adapter ?? "";
  const cfg = participant.adapterConfig ?? {};
  if (adapter === "echo") return { ok: true, status: "idle", detail: "local echo agent ready" };
  if (adapter === "openclaw") return { ok: false, status: "offline", detail: "adapter placeholder is not installed" };
  if (adapter === "codex") {
    const bin = typeof cfg.bin === "string" ? cfg.bin : "codex";
    const ok = await commandExists(bin);
    if (!ok) return { ok: false, status: "offline", detail: `${bin} CLI not found on PATH` };
    const compatibility = await commandSupports(bin, ["exec", "--help"], ["--json", "--sandbox", "--cd"]);
    return compatibility.ok
      ? { ok: true, status: "idle", detail: `${bin} CLI found and non-interactive flags are compatible` }
      : { ok: false, status: "offline", detail: compatibility.detail };
  }
  if (adapter === "claude-code") {
    const bin = typeof cfg.bin === "string" ? cfg.bin : "claude";
    const ok = await commandExists(bin);
    if (!ok) return { ok: false, status: "offline", detail: `${bin} CLI not found on PATH` };
    const compatibility = await commandSupports(bin, ["--help"], ["--output-format", "--permission-mode"]);
    return compatibility.ok
      ? { ok: true, status: "idle", detail: `${bin} CLI flags are compatible; local login is verified on first turn` }
      : { ok: false, status: "offline", detail: compatibility.detail };
  }
  if (adapter === "api-model") {
    const apiKeyEnv = typeof cfg.apiKeyEnv === "string" ? cfg.apiKeyEnv : "OPENAI_API_KEY";
    const key = process.env[apiKeyEnv];
    return key
      ? { ok: true, status: "idle", detail: `${apiKeyEnv} configured` }
      : { ok: false, status: "offline", detail: `missing API key env var ${apiKeyEnv}` };
  }
  return { ok: false, status: "offline", detail: `unknown adapter ${adapter || "(none)"}` };
}

async function checkRoomAgents(room: Room): Promise<Record<string, AgentHealth>> {
  const entries = await Promise.all(room.participants
    .filter((participant) => participant.kind === "agent")
    .map(async (participant) => [participant.id, await checkParticipantHealth(participant)] as const));
  return Object.fromEntries(entries);
}

async function listWorkspaceDirectories(inputPath?: string): Promise<{
  path: string;
  parent?: string;
  directories: Array<{ name: string; path: string }>;
}> {
  const requested = resolve(inputPath?.trim() || homedir());
  const canonical = await realpath(requested).catch(() => {
    throw new Error(`folder does not exist: ${requested}`);
  });
  const metadata = await stat(canonical);
  if (!metadata.isDirectory()) throw new Error(`not a folder: ${canonical}`);
  const entries = await readdir(canonical, { withFileTypes: true });
  const directories = entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => ({ name: entry.name, path: join(canonical, entry.name) }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const parent = dirname(canonical);
  return { path: canonical, ...(parent !== canonical ? { parent } : {}), directories };
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
    const workspace = nextRoom.workspacePath ? new GitWorkspace(nextRoom.workspacePath, nextRoom.branch) : undefined;
    let workspaceReady: Promise<void> | undefined;
    if (workspace) {
      mkdirSync(nextRoom.workspacePath!, { recursive: true });
      workspaceReady = workspace.init().catch((err) => {
        void log.append({
          author: { kind: "system", id: "workspace", display: "Workspace" },
          type: "system",
          body: { level: "warn", text: `workspace init failed: ${err instanceof Error ? err.message : String(err)}` },
          visibility: "system",
        });
        throw err;
      });
    }
    let unwatch: (() => void) | undefined;
    if (workspace && workspaceReady) {
      void workspaceReady.then(() => {
        unwatch = workspace.watchOutOfBand((checkpoint) => {
          void log.append({
            author: { kind: "human", id: humans[0]?.id ?? "human", display: humans[0]?.display ?? "Human" },
            type: "checkpoint",
            body: checkpoint,
            visibility: "system",
          });
        });
      }).catch(() => {
        /* workspace init warning has already been recorded */
      });
    }

    const session = new SessionManager({
      sessionId: nextRoom.id,
      title: nextRoom.title,
      log,
      agents,
      humans,
      workspacePath: nextRoom.workspacePath,
      workspace: workspace && workspaceReady ? readyWorkspace(workspace, workspaceReady) : undefined,
      schedulerMode: nextRoom.schedulerMode,
      maxTurnsPerTopic: nextRoom.policy.maxTurnsPerTopic,
      noConsecutive: nextRoom.policy.noConsecutive,
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
      checkAgents: () => checkRoomAgents(nextRoom),
      listWorkspaceDirectories,
      takeWriteFloor: () => session.takeWriteFloor(),
      releaseWriteFloor: () => session.releaseWriteFloor(),
      setPolicy: () => {
        void log.append({
          author: { kind: "system", id: "session", display: "SessionManager" },
          type: "system",
          body: { level: "warn", text: "set_policy is not available in shared-session mode yet" },
          visibility: "system",
        });
      },
    };
    const created = { room: nextRoom, log, session, gatewayDeps, unwatch: () => unwatch?.() };
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

  async function deleteManaged(sessionId: string): Promise<Room[]> {
    const existing = managed.get(sessionId);
    if (existing) {
      existing.unwatch?.();
      await existing.session.stop();
      managed.delete(sessionId);
    }
    store.deleteSession(sessionId);
    return listRooms();
  }

  function updateLifecycle(sessionId: string, lifecycle: NonNullable<Room["lifecycle"]>): Room[] {
    const current = managed.get(sessionId)?.room ?? store.readSessionRoom(sessionId);
    if (!current) throw new Error(`unknown session: ${sessionId}`);
    const nextRoom: Room = { ...current, lifecycle };
    store.upsertSessionRoom(nextRoom);
    const existing = managed.get(sessionId);
    if (existing) {
      existing.room = nextRoom;
      existing.gatewayDeps.room = nextRoom;
    }
    return listRooms();
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
          schedulerMode: input.mode === "round-robin" ? "round-robin" : input.mode === "raise-hand" ? "raise-hand" : "bid",
          participants: ensureHuman(input.participants),
          createdAt: Date.now(),
          lifecycle: "active",
        };
        return createManaged(nextRoom).gatewayDeps;
      },
      continueSession: continueManaged,
      deleteSession: deleteManaged,
      updateSessionLifecycle: updateLifecycle,
    },
    opts.port,
  );
  await gateway.ready;

  return {
    log: primary.log,
    session: primary.session,
    gateway,
    async stop() {
      await Promise.all([...managed.values()].map(async (item) => {
        item.unwatch?.();
        await item.session.stop();
      }));
      await gateway.close();
      store.close();
    },
  };
}

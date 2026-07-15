import { EventLog, LegacyAgentAdapter, SessionManager, type WorkspaceManager } from "@quorum/core";
import type { AgentHealth, CreateSessionInput, ParticipantDescriptor, Room, SessionMode } from "@quorum/protocol";
import { execFile } from "node:child_process";
import { mkdirSync, realpathSync } from "node:fs";
import { readdir, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { createParticipant } from "./adapters/registry.js";
import { safeWindowsBinary } from "./adapters/cli-safety.js";
import { Gateway, type GatewayDeps, type GatewaySessionDeps } from "./gateway/ws-server.js";
import { openCredentialStore, SqliteStore } from "./persistence/sqlite-store.js";
import { createLocalSandboxToolExecutor } from "./tools/local-sandbox-executor.js";
import { GitWorkspace } from "./workspace/git-workspace.js";

const exec = promisify(execFile);
const MIN_AGENT_TURN_DEADLINE_MS = 180_000;

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

interface SharedWorkspaceCoordinator {
  path: string;
  branch: string;
  workspace: GitWorkspace;
  ready: Promise<void>;
  subscribers: Map<string, { log: EventLog; human: ParticipantDescriptor }>;
  unwatch?: () => void;
}

function policyForMode(mode: SessionMode, base: Room["policy"]): Room["policy"] {
  const turnDeadlineMs = Math.max(base.turnDeadlineMs, MIN_AGENT_TURN_DEADLINE_MS);
  if (mode === "raise-hand") return { ...base, name: "free-for-all", noConsecutive: true, turnDeadlineMs };
  if (mode === "round-robin") return { ...base, name: "directed", noConsecutive: true, turnDeadlineMs };
  return { ...base, name: "free-for-all", turnDeadlineMs };
}

function policyWithDiscussionBudget(
  mode: SessionMode,
  base: Room["policy"],
  targetDiscussionRounds: number | undefined,
  participants: ParticipantDescriptor[],
): Room["policy"] {
  const policy = policyForMode(mode, base);
  if (!targetDiscussionRounds) return policy;
  const agentCount = Math.max(1, participants.filter((participant) => participant.kind === "agent").length);
  const normalTurns = targetDiscussionRounds * agentCount;
  const wrapUpTurns = agentCount;
  return { ...policy, maxTurnsPerTopic: Math.max(policy.maxTurnsPerTopic, normalTurns + wrapUpTurns) };
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

type HealthCommandRunner = (
  bin: string,
  args: string[],
  options: { timeout: number; shell: boolean },
) => Promise<{ stdout: string; stderr: string }>;

export async function commandExists(
  bin: string,
  run: HealthCommandRunner = exec,
  platform = process.platform,
): Promise<boolean> {
  let safeBin: string;
  try {
    safeBin = safeWindowsBinary(bin, "CLI binary path", platform);
  } catch {
    return false;
  }
  try {
    await run(safeBin, ["--version"], { timeout: 2_500, shell: platform === "win32" });
    return true;
  } catch {
    try {
      await run(safeBin, ["--help"], { timeout: 2_500, shell: platform === "win32" });
      return true;
    } catch {
      return false;
    }
  }
}

async function commandSupports(bin: string, args: string[], required: string[]): Promise<{ ok: boolean; detail?: string }> {
  try {
    bin = safeWindowsBinary(bin);
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
    const compatibility = await commandSupports(bin, ["exec", "--help"], ["--json", "--sandbox"]);
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
  opts: { dbPath?: string; credentialDbPath?: string; port?: number; authToken?: string } = {},
): Promise<SharedSessionHost> {
  const store = new SqliteStore(opts.dbPath);
  const credentialStore = openCredentialStore(store, opts.dbPath, opts.credentialDbPath);
  credentialStore.applyProviderConfigsToEnv();
  const managed = new Map<string, ManagedSharedSession>();
  const workspaceCoordinators = new Map<string, SharedWorkspaceCoordinator>();

  function attachWorkspace(nextRoom: Room, log: EventLog, humans: ParticipantDescriptor[]): {
    workspace?: GitWorkspace;
    ready?: Promise<void>;
    detach?: () => void;
  } {
    if (!nextRoom.workspacePath) return {};
    mkdirSync(nextRoom.workspacePath, { recursive: true });
    const canonicalPath = realpathSync(nextRoom.workspacePath);
    let coordinator = workspaceCoordinators.get(canonicalPath);
    if (coordinator && coordinator.branch !== nextRoom.branch) {
      throw new Error(`workspace ${canonicalPath} is already active on branch ${coordinator.branch}`);
    }
    if (!coordinator) {
      const workspace = new GitWorkspace(canonicalPath, nextRoom.branch);
      coordinator = {
        path: canonicalPath,
        branch: nextRoom.branch,
        workspace,
        ready: workspace.init(),
        subscribers: new Map(),
      };
      workspaceCoordinators.set(canonicalPath, coordinator);
      const shared = coordinator;
      void shared.ready.then(() => {
        shared.unwatch = shared.workspace.watchOutOfBand((checkpoint) => {
          for (const subscriber of shared.subscribers.values()) {
            void subscriber.log.append({
              author: subscriber.human,
              type: "checkpoint",
              body: checkpoint,
              visibility: "system",
            });
          }
        });
      }).catch((err) => {
        for (const subscriber of shared.subscribers.values()) {
          void subscriber.log.append({
            author: { kind: "system", id: "workspace", display: "Workspace" },
            type: "system",
            body: { level: "warn", text: `workspace init failed: ${err instanceof Error ? err.message : String(err)}` },
            visibility: "system",
          });
        }
      });
    }
    const human = humans[0] ?? { id: "human", kind: "human", display: "Human", status: "idle" };
    coordinator.subscribers.set(nextRoom.id, { log, human });
    return {
      workspace: coordinator.workspace,
      ready: coordinator.ready,
      detach: () => {
        coordinator!.subscribers.delete(nextRoom.id);
        if (!coordinator!.subscribers.size) {
          coordinator!.unwatch?.();
          workspaceCoordinators.delete(canonicalPath);
        }
      },
    };
  }

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
    const workspaceAttachment = attachWorkspace(nextRoom, log, humans);
    const workspace = workspaceAttachment.workspace;
    const workspaceReady = workspaceAttachment.ready;

    const session = new SessionManager({
      sessionId: nextRoom.id,
      title: nextRoom.title,
      log,
      agents,
      humans,
      workspacePath: nextRoom.workspacePath,
      workspace: workspace && workspaceReady ? readyWorkspace(workspace, workspaceReady) : undefined,
      schedulerMode: nextRoom.schedulerMode,
      targetDiscussionRounds: nextRoom.targetDiscussionRounds,
      maxTurnsPerTopic: nextRoom.policy.maxTurnsPerTopic,
      noConsecutive: nextRoom.policy.noConsecutive,
      toolExecutor: nextRoom.workspacePath ? createLocalSandboxToolExecutor({ workspacePath: nextRoom.workspacePath }) : undefined,
      settlingWindowMs: 400,
      turnTimeoutMs: Math.max(nextRoom.policy.turnDeadlineMs, MIN_AGENT_TURN_DEADLINE_MS),
    });
    session.start();
    const gatewayDeps: GatewaySessionDeps = {
      log,
      room: nextRoom,
      humanId: humans[0]?.id,
      postMessage: (text, addressedTo, attachments) => session.submitUserPrompt(text, addressedTo, attachments),
      interrupt: (hard) => session.interrupt(humans[0]?.id ?? "human", hard),
      approveTool: (callId, allow) => session.approveTool(callId, allow),
      compactMemory: (fromSeq, toSeq) => session.compactWorkingMemory(fromSeq, toSeq),
      listCredentials: () => credentialStore.readProviderConfigViews(),
      setCredential: (input: Parameters<NonNullable<GatewayDeps["setCredential"]>>[0]) => credentialStore.upsertProviderConfig(input),
      checkAgents: () => checkRoomAgents(nextRoom),
      listWorkspaceDirectories,
      takeWriteFloor: () => session.takeWriteFloor(),
      releaseWriteFloor: () => session.releaseWriteFloor(),
      rollback: workspace
        ? async (toHead) => {
            const lease = await workspace.acquireWriteFloor("rollback", humans[0]?.id ?? "human");
            try {
              await workspace.rollbackTo(toHead);
            } finally {
              lease.release();
            }
            await log.append({
              author: { kind: "system", id: "workspace", display: "Workspace" },
              type: "system",
              body: { level: "warn", text: `rolled back to ${toHead}`, toHead },
              visibility: "system",
            });
          }
        : undefined,
      setPolicy: () => {
        void log.append({
          author: { kind: "system", id: "session", display: "SessionManager" },
          type: "system",
          body: { level: "warn", text: "set_policy is not available in shared-session mode yet" },
          visibility: "system",
        });
      },
    };
    const created = { room: nextRoom, log, session, gatewayDeps, unwatch: workspaceAttachment.detach };
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

  const gatewayDeps: GatewayDeps = Object.assign(
    primary.gatewayDeps,
    {
      authToken: opts.authToken,
      listCredentials: () => credentialStore.readProviderConfigViews(),
      setCredential: (input: Parameters<NonNullable<GatewayDeps["setCredential"]>>[0]) => credentialStore.upsertProviderConfig(input),
      listSessions: listRooms,
      createSession: (input: CreateSessionInput) => {
        if (managed.has(input.id) || store.readSessionRoom(input.id)) throw new Error(`session already exists: ${input.id}`);
        const nextRoom: Room = {
          id: input.id,
          title: input.title || input.id,
          workspacePath: input.workspacePath?.trim() || room.workspacePath,
          branch: room.branch,
          primary: input.participants.find((participant) => participant.kind === "agent")?.id,
          policy: policyWithDiscussionBudget(input.mode, room.policy, input.targetDiscussionRounds, input.participants),
          schedulerMode: input.mode === "round-robin" ? "round-robin" : input.mode === "raise-hand" ? "raise-hand" : "bid",
          targetDiscussionRounds: input.targetDiscussionRounds,
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
  );
  const gateway = new Gateway(gatewayDeps, opts.port);
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
      if (credentialStore !== store) credentialStore.close();
      store.close();
    },
  };
}

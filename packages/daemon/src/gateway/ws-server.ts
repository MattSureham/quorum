import { WebSocketServer, type WebSocket } from "ws";
import type { AddressInfo } from "node:net";
import { ClientMessageSchema } from "@quorum/protocol/schema";
import type { Room, ConductorPolicyConfig, CreateSessionInput, MessageAttachment, AgentHealth } from "@quorum/protocol";
import { projectSessionState, type EventLog } from "@quorum/core";
import type { MemorySummary } from "@quorum/protocol";
import type { ProviderConfigView } from "../persistence/sqlite-store.js";
import { prepareMessageAttachments } from "../attachments/document-extractor.js";

export interface GatewayDeps {
  log: EventLog;
  room: Room;
  setPolicy: (cfg: ConductorPolicyConfig) => void;
  humanId?: string;
  authToken?: string;
  /** Override human prompt handling, e.g. to route through SessionManager. */
  postMessage?: (text: string, addressedTo?: string[], attachments?: MessageAttachment[]) => Promise<void> | void;
  /** Resolve a pending tool-approval request (approve_tool). */
  approveTool?: (callId: string, allow: boolean) => void;
  compactMemory?: (fromSeq?: number, toSeq?: number) => Promise<MemorySummary | undefined> | MemorySummary | undefined;
  listCredentials?: () => ProviderConfigView[];
  setCredential?: (input: { providerId: string; envVar?: string; apiKey?: string; baseUrl?: string; model?: string }) => ProviderConfigView;
  checkAgents?: () => Promise<Record<string, AgentHealth>> | Record<string, AgentHealth>;
  listWorkspaceDirectories?: (path?: string) => Promise<{ path: string; parent?: string; directories: Array<{ name: string; path: string }> }>;
  interrupt?: (hard: boolean) => Promise<void> | void;
  /** Let the human take the write floor to edit files directly (take_write_floor). */
  takeWriteFloor?: () => Promise<void> | void;
  /** Explicitly release the human write floor without requiring a chat message. */
  releaseWriteFloor?: () => Promise<void> | void;
  /** Roll the workspace back to a prior head (rollback); destructive git reset. */
  rollback?: (toHead: string) => Promise<void>;
  listSessions?: () => Room[];
  createSession?: (input: CreateSessionInput) => GatewaySessionDeps | Promise<GatewaySessionDeps>;
  continueSession?: (sessionId: string) => GatewaySessionDeps | Promise<GatewaySessionDeps>;
  deleteSession?: (sessionId: string) => Room[] | Promise<Room[]>;
  updateSessionLifecycle?: (sessionId: string, lifecycle: NonNullable<Room["lifecycle"]>) => Room[] | Promise<Room[]>;
}

export type GatewaySessionDeps = Omit<GatewayDeps, "authToken" | "listSessions" | "createSession" | "continueSession" | "deleteSession" | "updateSessionLifecycle">;

/**
 * Thin WebSocket gateway. Clients render the event stream and send commands.
 * v1 binds to localhost; add pairing / relay / E2E for remote (M6).
 * CLI agents use their own auth. API-model provider keys may be persisted in
 * the local SQLite store; gateway responses expose masked previews only.
 */
export class Gateway {
  private readonly wss: WebSocketServer;
  private readonly clients = new Set<WebSocket>();
  private readonly subscriptions = new Map<WebSocket, string>();
  private readonly sessions = new Map<string, GatewaySessionDeps>();
  private readonly postMessageQueues = new Map<string, Promise<void>>();
  private readonly unsubscribeLogs: Array<() => void> = [];
  readonly ready: Promise<void>;

  constructor(private readonly deps: GatewayDeps, port = 8787) {
    this.wss = new WebSocketServer({ host: "127.0.0.1", port, maxPayload: 32_000_000 });
    this.ready = new Promise((resolve, reject) => {
      this.wss.once("listening", resolve);
      this.wss.once("error", reject);
    });
    this.wss.on("connection", (ws, req) => this.onConnection(ws, req));
    this.registerSession(deps);
  }

  address(): AddressInfo {
    const address = this.wss.address();
    if (!address || typeof address === "string") throw new Error("gateway is not listening on a TCP port");
    return address;
  }

  url(): string {
    const { address, port } = this.address();
    const host = address === "::" ? "127.0.0.1" : address;
    return `ws://${host}:${port}`;
  }

  private isAuthorized(req: import("node:http").IncomingMessage): boolean {
    if (!this.deps.authToken) return true;
    const auth = req.headers.authorization;
    if (auth === `Bearer ${this.deps.authToken}`) return true;
    const url = new URL(req.url ?? "/", "ws://127.0.0.1");
    return url.searchParams.get("token") === this.deps.authToken;
  }

  private onConnection(ws: WebSocket, req: import("node:http").IncomingMessage): void {
    if (!this.isAuthorized(req)) {
      ws.close(1008, "unauthorized");
      return;
    }
    this.clients.add(ws);
    ws.on("close", () => {
      this.clients.delete(ws);
      this.subscriptions.delete(ws);
    });
    ws.on("message", (raw) => {
      let msg: any;
      let requestId: string | undefined;
      try {
        const candidate = JSON.parse(String(raw));
        requestId = candidate && typeof candidate === "object" && typeof candidate.requestId === "string"
          ? candidate.requestId.slice(0, 128)
          : undefined;
        msg = ClientMessageSchema.parse(candidate);
      } catch (err) {
        const attachmentError = err && typeof err === "object" && "issues" in err
          && Array.isArray((err as any).issues)
          && (err as any).issues.some((issue: any) => issue.path?.includes("attachments"));
        ws.send(JSON.stringify({
          t: "error",
          ...(requestId ? { requestId } : {}),
          text: attachmentError
            ? "invalid attachments: use images up to 5 MB or PDF/DOCX files up to 10 MB each"
            : "bad message",
        }));
        return;
      }
      this.route(ws, msg);
    });
  }

  private registerSession(session: GatewaySessionDeps): GatewaySessionDeps {
    const existing = this.sessions.get(session.room.id);
    if (existing) return existing;
    this.sessions.set(session.room.id, session);
    this.unsubscribeLogs.push(session.log.on((event) => this.broadcastToRoom(event.roomId, { t: "event", event })));
    return session;
  }

  private session(roomId: string): GatewaySessionDeps | undefined {
    return this.sessions.get(roomId);
  }

  private rooms(): Room[] {
    return this.deps.listSessions?.() ?? [...this.sessions.values()].map((session) => session.room);
  }

  private route(ws: WebSocket, m: any): void {
    if (m.t === "list_sessions") {
      ws.send(JSON.stringify({ t: "sessions", rooms: this.rooms() }));
      return;
    }
    if (m.t === "create_session") {
      if (!this.deps.createSession) {
        ws.send(JSON.stringify({ t: "error", requestId: m.requestId, text: "session creation is not available" }));
        return;
      }
      void Promise.resolve().then(() => this.deps.createSession!(m.session)).then((session) => {
        const registered = this.registerSession(session);
        ws.send(JSON.stringify({ t: "session_created", requestId: m.requestId, room: registered.room, rooms: this.rooms() }));
      }).catch((err) =>
        ws.send(JSON.stringify({ t: "error", requestId: m.requestId, text: `create_session failed: ${err instanceof Error ? err.message : String(err)}` })),
      );
      return;
    }
    if (m.t === "continue_session") {
      const sessionId = m.sessionId ?? m.roomId;
      if (!sessionId) {
        ws.send(JSON.stringify({ t: "error", text: "continue_session requires sessionId" }));
        return;
      }
      if (!this.deps.continueSession) {
        ws.send(JSON.stringify({ t: "error", text: "session continuation is not available" }));
        return;
      }
      void Promise.resolve().then(() => this.deps.continueSession!(sessionId)).then((session) => {
        const registered = this.registerSession(session);
        ws.send(JSON.stringify({ t: "session_continued", room: registered.room, rooms: this.rooms() }));
      }).catch((err) =>
        ws.send(JSON.stringify({ t: "error", text: `continue_session failed: ${err instanceof Error ? err.message : String(err)}` })),
      );
      return;
    }
    if (m.t === "delete_session") {
      if (!this.deps.deleteSession) {
        ws.send(JSON.stringify({ t: "error", text: "session deletion is not available" }));
        return;
      }
      void Promise.resolve().then(() => this.deps.deleteSession!(m.sessionId)).then((rooms) => {
        this.sessions.delete(m.sessionId);
        for (const [client, roomId] of this.subscriptions.entries()) {
          if (roomId === m.sessionId) this.subscriptions.delete(client);
        }
        this.broadcastToAll({ t: "session_deleted", sessionId: m.sessionId, rooms });
      }).catch((err) =>
        ws.send(JSON.stringify({ t: "error", text: `delete_session failed: ${err instanceof Error ? err.message : String(err)}` })),
      );
      return;
    }
    if (m.t === "update_session_lifecycle") {
      if (!this.deps.updateSessionLifecycle) {
        ws.send(JSON.stringify({ t: "error", text: "session lifecycle updates are not available" }));
        return;
      }
      void Promise.resolve()
        .then(() => this.deps.updateSessionLifecycle!(m.sessionId, m.lifecycle))
        .then((rooms) => this.broadcastToAll({ t: "sessions", rooms }))
        .catch((err) =>
          ws.send(JSON.stringify({ t: "error", text: `update_session_lifecycle failed: ${err instanceof Error ? err.message : String(err)}` })),
        );
      return;
    }
    // Provider credentials belong to the daemon installation, not a room.
    // Keep them available when the user has deleted every session.
    if (m.t === "get_credentials") {
      ws.send(JSON.stringify({ t: "credentials", providers: this.deps.listCredentials?.() ?? [] }));
      return;
    }
    if (m.t === "set_credential") {
      if (!this.deps.setCredential) {
        ws.send(JSON.stringify({ t: "credential_error", requestId: m.requestId, providerId: m.providerId, text: "credential storage is not available" }));
        return;
      }
      try {
        const provider = this.deps.setCredential({
          providerId: m.providerId,
          envVar: m.envVar,
          apiKey: m.apiKey,
          baseUrl: m.baseUrl,
          model: m.model,
        });
        ws.send(JSON.stringify({ t: "credential_saved", requestId: m.requestId, provider, providers: this.deps.listCredentials?.() ?? [provider] }));
      } catch (err) {
        ws.send(JSON.stringify({
          t: "credential_error",
          requestId: m.requestId,
          providerId: m.providerId,
          text: err instanceof Error ? err.message : String(err),
        }));
      }
      return;
    }
    const session = this.session(m.roomId ?? this.deps.room.id);
    if (!session) {
      ws.send(JSON.stringify({ t: "error", text: `unknown session: ${m.roomId}` }));
      return;
    }
    switch (m.t) {
      case "subscribe":
        this.subscriptions.set(ws, session.room.id);
        ws.send(JSON.stringify({
          t: "snapshot",
          room: session.room,
          events: session.log.replay(m.sinceSeq ?? 0),
          summaries: session.log.readWorkingMemorySummaries(),
        }));
        break;
      case "post_message":
        this.queuePostMessage(ws, session, m);
        break;
      case "interrupt":
        if (session.interrupt) void Promise.resolve(session.interrupt(!!m.hard)).catch((err) =>
          ws.send(JSON.stringify({ t: "error", text: `interrupt failed: ${err instanceof Error ? err.message : String(err)}` })),
        );
        else void session.log.append({ author: this.human(session), type: "interrupt", body: { by: "human", hard: !!m.hard } });
        break;
      case "set_policy":
        session.setPolicy(m.policy);
        break;
      case "approve_tool":
        session.approveTool?.(m.callId, !!m.allow);
        break;
      case "replay_projection": {
        const afterSeq = m.afterSeq ?? 0;
        const events = session.log.replay(afterSeq);
        ws.send(JSON.stringify({
          t: "replay_projection",
          afterSeq,
          headSeq: session.log.headSeq,
          eventCount: events.length,
          projection: projectSessionState(events),
        }));
        break;
      }
      case "get_attachment": {
        const attachment = session.log.readAttachment(m.eventId, m.attachmentId);
        if (!attachment) {
          ws.send(JSON.stringify({ t: "attachment_error", roomId: session.room.id, requestId: m.requestId, text: "attachment payload is unavailable" }));
          break;
        }
        ws.send(JSON.stringify({ t: "attachment", roomId: session.room.id, requestId: m.requestId, eventId: m.eventId, attachment }));
        break;
      }
      case "compact_memory":
        if (session.compactMemory) {
          void Promise.resolve(session.compactMemory(m.fromSeq, m.toSeq)).then((summary) => {
            ws.send(JSON.stringify({
              t: "memory_compacted",
              summary,
              summaries: session.log.readWorkingMemorySummaries(),
            }));
          }).catch((err) =>
            ws.send(JSON.stringify({ t: "error", text: `compact_memory failed: ${err instanceof Error ? err.message : String(err)}` })),
          );
        } else {
          ws.send(JSON.stringify({ t: "memory_compacted", summaries: session.log.readWorkingMemorySummaries() }));
        }
        break;
      case "check_agents":
        if (!session.checkAgents) {
          ws.send(JSON.stringify({ t: "agent_health", roomId: session.room.id, health: {} }));
          break;
        }
        void Promise.resolve(session.checkAgents()).then((health) => {
          ws.send(JSON.stringify({ t: "agent_health", roomId: session.room.id, health }));
        }).catch((err) =>
          ws.send(JSON.stringify({ t: "error", text: `check_agents failed: ${err instanceof Error ? err.message : String(err)}` })),
        );
        break;
      case "list_workspace_directories":
        if (!session.listWorkspaceDirectories) {
          ws.send(JSON.stringify({ t: "workspace_directories_error", requestId: m.requestId, text: "workspace browsing is not available" }));
          break;
        }
        void Promise.resolve(session.listWorkspaceDirectories(m.path)).then((listing) => {
          ws.send(JSON.stringify({ t: "workspace_directories", requestId: m.requestId, ...listing }));
        }).catch((err) => {
          ws.send(JSON.stringify({
            t: "workspace_directories_error",
            requestId: m.requestId,
            text: err instanceof Error ? err.message : String(err),
          }));
        });
        break;
      case "take_write_floor":
        void Promise.resolve(session.takeWriteFloor?.()).catch(() => {});
        break;
      case "release_write_floor":
        void Promise.resolve(session.releaseWriteFloor?.()).catch(() => {});
        break;
      case "rollback":
        if (!session.rollback) {
          ws.send(JSON.stringify({ t: "error", text: "rollback is not available for this session" }));
          break;
        }
        void session.rollback(m.toHead).catch((err) =>
          ws.send(JSON.stringify({ t: "error", text: `rollback failed: ${err instanceof Error ? err.message : String(err)}` })),
        );
        break;
      default:
        break;
    }
  }

  private queuePostMessage(ws: WebSocket, session: GatewaySessionDeps, message: {
    text: string;
    addressedTo?: string[];
    attachments?: MessageAttachment[];
  }): void {
    const roomId = session.room.id;
    const previous = this.postMessageQueues.get(roomId) ?? Promise.resolve();
    const next = previous
      .catch(() => undefined)
      .then(async () => {
        const attachments = message.attachments?.length
          ? await prepareMessageAttachments(message.attachments)
          : undefined;
        if (session.postMessage) {
          await session.postMessage(message.text, message.addressedTo, attachments);
        } else {
          await session.log.append({
            author: this.human(session),
            type: "message",
            body: { text: message.text, ...(attachments?.length ? { attachments } : {}) },
            addressedTo: message.addressedTo,
          });
        }
      });
    this.postMessageQueues.set(roomId, next);
    void next.catch((err) => {
      try {
        ws.send(JSON.stringify({ t: "error", text: `post_message failed: ${err instanceof Error ? err.message : String(err)}` }));
      } catch { /* connection closed */ }
    }).finally(() => {
      if (this.postMessageQueues.get(roomId) === next) this.postMessageQueues.delete(roomId);
    });
  }

  private human(session = this.deps) {
    return { kind: "human" as const, id: session.humanId ?? "human", display: "Human" };
  }

  private broadcastToRoom(roomId: string, msg: unknown): void {
    const s = JSON.stringify(msg);
    for (const ws of this.clients) {
      if (this.subscriptions.get(ws) !== roomId) continue;
      try { ws.send(s); } catch { /* drop */ }
    }
  }

  private broadcastToAll(msg: unknown): void {
    const s = JSON.stringify(msg);
    for (const ws of this.clients) {
      try { ws.send(s); } catch { /* drop */ }
    }
  }

  close(): Promise<void> {
    for (const unsubscribe of this.unsubscribeLogs) unsubscribe();
    for (const ws of this.clients) ws.terminate();
    this.clients.clear();
    return new Promise((resolve, reject) => {
      this.wss.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }
}

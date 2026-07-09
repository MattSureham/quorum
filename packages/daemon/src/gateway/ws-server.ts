import { WebSocketServer, type WebSocket } from "ws";
import type { AddressInfo } from "node:net";
import { ClientMessageSchema } from "@quorum/protocol/schema";
import type { Room, ConductorPolicyConfig, CreateSessionInput, ImageAttachment } from "@quorum/protocol";
import { projectSessionState, type EventLog } from "@quorum/core";
import type { MemorySummary } from "@quorum/protocol";
import type { ProviderConfigView } from "../persistence/sqlite-store.js";

export interface GatewayDeps {
  log: EventLog;
  room: Room;
  setPolicy: (cfg: ConductorPolicyConfig) => void;
  humanId?: string;
  authToken?: string;
  /** Override human prompt handling, e.g. to route through SessionManager. */
  postMessage?: (text: string, addressedTo?: string[], attachments?: ImageAttachment[]) => Promise<void> | void;
  /** Resolve a pending tool-approval request (approve_tool). */
  approveTool?: (callId: string, allow: boolean) => void;
  compactMemory?: (fromSeq?: number, toSeq?: number) => Promise<MemorySummary | undefined> | MemorySummary | undefined;
  listCredentials?: () => ProviderConfigView[];
  setCredential?: (input: { providerId: string; envVar?: string; apiKey?: string; baseUrl?: string; model?: string }) => ProviderConfigView;
  interrupt?: (hard: boolean) => Promise<void> | void;
  /** Let the human take the write floor to edit files directly (take_write_floor). */
  takeWriteFloor?: () => Promise<void> | void;
  /** Roll the workspace back to a prior head (rollback); destructive git reset. */
  rollback?: (toHead: string) => Promise<void>;
  listSessions?: () => Room[];
  createSession?: (input: CreateSessionInput) => GatewaySessionDeps | Promise<GatewaySessionDeps>;
}

export type GatewaySessionDeps = Omit<GatewayDeps, "authToken" | "listSessions" | "createSession">;

/**
 * Thin WebSocket gateway. Clients render the event stream and send commands.
 * v1 binds to localhost; add pairing / relay / E2E for remote (M6).
 * The daemon never stores provider API keys — agents use their own credentials.
 */
export class Gateway {
  private readonly wss: WebSocketServer;
  private readonly clients = new Set<WebSocket>();
  private readonly subscriptions = new Map<WebSocket, string>();
  private readonly sessions = new Map<string, GatewaySessionDeps>();
  private readonly unsubscribeLogs: Array<() => void> = [];
  readonly ready: Promise<void>;

  constructor(private readonly deps: GatewayDeps, port = 8787) {
    this.wss = new WebSocketServer({ host: "127.0.0.1", port });
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
      try {
        msg = ClientMessageSchema.parse(JSON.parse(String(raw)));
      } catch {
        ws.send(JSON.stringify({ t: "error", text: "bad message" }));
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
    return this.sessions.get(roomId) ?? (roomId === this.deps.room.id ? this.deps : undefined);
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
        ws.send(JSON.stringify({ t: "error", text: "session creation is not available" }));
        return;
      }
      void Promise.resolve(this.deps.createSession(m.session)).then((session) => {
        const registered = this.registerSession(session);
        ws.send(JSON.stringify({ t: "session_created", room: registered.room, rooms: this.rooms() }));
      }).catch((err) =>
        ws.send(JSON.stringify({ t: "error", text: `create_session failed: ${err instanceof Error ? err.message : String(err)}` })),
      );
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
        ws.send(JSON.stringify({ t: "snapshot", room: session.room, events: session.log.replay(m.sinceSeq ?? 0) }));
        break;
      case "post_message":
        if (session.postMessage) void Promise.resolve(session.postMessage(m.text, m.addressedTo, m.attachments)).catch((err) =>
          ws.send(JSON.stringify({ t: "error", text: `post_message failed: ${err instanceof Error ? err.message : String(err)}` })),
        );
        else void session.log.append({
          author: this.human(session),
          type: "message",
          body: { text: m.text, ...(m.attachments?.length ? { attachments: m.attachments } : {}) },
          addressedTo: m.addressedTo,
        });
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
      case "get_credentials":
        ws.send(JSON.stringify({ t: "credentials", providers: this.deps.listCredentials?.() ?? [] }));
        break;
      case "set_credential":
        if (!this.deps.setCredential) {
          ws.send(JSON.stringify({ t: "error", text: "credential storage is not available" }));
          break;
        }
        try {
          const provider = this.deps.setCredential({
            providerId: m.providerId,
            envVar: m.envVar,
            apiKey: m.apiKey,
            baseUrl: m.baseUrl,
            model: m.model,
          });
          ws.send(JSON.stringify({ t: "credential_saved", provider, providers: this.deps.listCredentials?.() ?? [provider] }));
        } catch (err) {
          ws.send(JSON.stringify({ t: "error", text: `set_credential failed: ${err instanceof Error ? err.message : String(err)}` }));
        }
        break;
      case "take_write_floor":
        void Promise.resolve(session.takeWriteFloor?.()).catch(() => {});
        break;
      case "rollback":
        void session.rollback?.(m.toHead).catch((err) =>
          ws.send(JSON.stringify({ t: "error", text: `rollback failed: ${err instanceof Error ? err.message : String(err)}` })),
        );
        break;
      default:
        break;
    }
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

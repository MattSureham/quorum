import { WebSocketServer, type WebSocket } from "ws";
import type { AddressInfo } from "node:net";
import { ClientMessageSchema } from "@quorum/protocol/schema";
import type { Room, ConductorPolicyConfig } from "@quorum/protocol";
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
  postMessage?: (text: string, addressedTo?: string[]) => Promise<void> | void;
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
}

/**
 * Thin WebSocket gateway. Clients render the event stream and send commands.
 * v1 binds to localhost; add pairing / relay / E2E for remote (M6).
 * The daemon never stores provider API keys — agents use their own credentials.
 */
export class Gateway {
  private readonly wss: WebSocketServer;
  private readonly clients = new Set<WebSocket>();
  private readonly unsubscribeLog: () => void;
  readonly ready: Promise<void>;

  constructor(private readonly deps: GatewayDeps, port = 8787) {
    this.wss = new WebSocketServer({ host: "127.0.0.1", port });
    this.ready = new Promise((resolve, reject) => {
      this.wss.once("listening", resolve);
      this.wss.once("error", reject);
    });
    this.wss.on("connection", (ws, req) => this.onConnection(ws, req));
    this.unsubscribeLog = this.deps.log.on((e) => this.broadcast({ t: "event", event: e }));
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

  private human() {
    return { kind: "human" as const, id: this.deps.humanId ?? "human", display: "Human" };
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
    ws.on("close", () => this.clients.delete(ws));
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

  private route(ws: WebSocket, m: any): void {
    switch (m.t) {
      case "subscribe":
        ws.send(JSON.stringify({ t: "snapshot", room: this.deps.room, events: this.deps.log.replay(m.sinceSeq ?? 0) }));
        break;
      case "post_message":
        if (this.deps.postMessage) void Promise.resolve(this.deps.postMessage(m.text, m.addressedTo)).catch((err) =>
          ws.send(JSON.stringify({ t: "error", text: `post_message failed: ${err instanceof Error ? err.message : String(err)}` })),
        );
        else void this.deps.log.append({ author: this.human(), type: "message", body: { text: m.text }, addressedTo: m.addressedTo });
        break;
      case "interrupt":
        if (this.deps.interrupt) void Promise.resolve(this.deps.interrupt(!!m.hard)).catch((err) =>
          ws.send(JSON.stringify({ t: "error", text: `interrupt failed: ${err instanceof Error ? err.message : String(err)}` })),
        );
        else void this.deps.log.append({ author: this.human(), type: "interrupt", body: { by: "human", hard: !!m.hard } });
        break;
      case "set_policy":
        this.deps.setPolicy(m.policy);
        break;
      case "approve_tool":
        this.deps.approveTool?.(m.callId, !!m.allow);
        break;
      case "replay_projection": {
        const afterSeq = m.afterSeq ?? 0;
        const events = this.deps.log.replay(afterSeq);
        ws.send(JSON.stringify({
          t: "replay_projection",
          afterSeq,
          headSeq: this.deps.log.headSeq,
          eventCount: events.length,
          projection: projectSessionState(events),
        }));
        break;
      }
      case "compact_memory":
        if (this.deps.compactMemory) {
          void Promise.resolve(this.deps.compactMemory(m.fromSeq, m.toSeq)).then((summary) => {
            ws.send(JSON.stringify({
              t: "memory_compacted",
              summary,
              summaries: this.deps.log.readWorkingMemorySummaries(),
            }));
          }).catch((err) =>
            ws.send(JSON.stringify({ t: "error", text: `compact_memory failed: ${err instanceof Error ? err.message : String(err)}` })),
          );
        } else {
          ws.send(JSON.stringify({ t: "memory_compacted", summaries: this.deps.log.readWorkingMemorySummaries() }));
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
        void Promise.resolve(this.deps.takeWriteFloor?.()).catch(() => {});
        break;
      case "rollback":
        void this.deps.rollback?.(m.toHead).catch((err) =>
          ws.send(JSON.stringify({ t: "error", text: `rollback failed: ${err instanceof Error ? err.message : String(err)}` })),
        );
        break;
      default:
        break;
    }
  }

  private broadcast(msg: unknown): void {
    const s = JSON.stringify(msg);
    for (const ws of this.clients) {
      try { ws.send(s); } catch { /* drop */ }
    }
  }

  close(): Promise<void> {
    this.unsubscribeLog();
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

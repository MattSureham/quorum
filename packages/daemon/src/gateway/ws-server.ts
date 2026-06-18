import { WebSocketServer, type WebSocket } from "ws";
import { ClientMessageSchema } from "@quorum/protocol/schema";
import type { Room, ConductorPolicyConfig } from "@quorum/protocol";
import type { EventLog } from "@quorum/core";

export interface GatewayDeps {
  log: EventLog;
  room: Room;
  setPolicy: (cfg: ConductorPolicyConfig) => void;
  humanId?: string;
}

/**
 * Thin WebSocket gateway. Clients render the event stream and send commands.
 * v1 binds to localhost; add pairing / relay / E2E for remote (M6).
 * The daemon never stores provider API keys — agents use their own credentials.
 */
export class Gateway {
  private readonly wss: WebSocketServer;
  private readonly clients = new Set<WebSocket>();

  constructor(private readonly deps: GatewayDeps, port = 8787) {
    this.wss = new WebSocketServer({ host: "127.0.0.1", port });
    this.wss.on("connection", (ws) => this.onConnection(ws));
    this.deps.log.on((e) => this.broadcast({ t: "event", event: e }));
  }

  private human() {
    return { kind: "human" as const, id: this.deps.humanId ?? "human", display: "Human" };
  }

  private onConnection(ws: WebSocket): void {
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
        void this.deps.log.append({ author: this.human(), type: "message", body: { text: m.text }, addressedTo: m.addressedTo });
        break;
      case "interrupt":
        void this.deps.log.append({ author: this.human(), type: "interrupt", body: { by: "human", hard: !!m.hard } });
        break;
      case "set_policy":
        this.deps.setPolicy(m.policy);
        break;
      // approve_tool / take_write_floor / rollback: wire to conductor + workspace (M3/M4)
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

  close(): void {
    this.wss.close();
  }
}

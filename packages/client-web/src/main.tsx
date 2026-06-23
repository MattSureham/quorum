import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Activity,
  AlertTriangle,
  Bot,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleDot,
  GitCommitHorizontal,
  Hand,
  MessageSquare,
  PauseCircle,
  PenLine,
  Plug,
  Radio,
  RefreshCcw,
  Send,
  Settings2,
  ShieldQuestion,
  SquareTerminal,
  Undo2,
  UserRound,
  Wrench,
  XCircle,
  Zap,
} from "lucide-react";
import type {
  ApprovalSignal,
  CheckpointBody,
  ConductorPolicyConfig,
  FloorGrantBody,
  FloorReleaseBody,
  FloorRequestBody,
  MessageBody,
  ParticipantDescriptor,
  Room,
  RoomEvent,
  SystemBody,
  ThinkingBody,
  ToolCallBody,
  ToolResultBody,
} from "@quorum/protocol";
import "./styles.css";

type ConnectionState = "idle" | "connecting" | "connected" | "offline" | "error";

type ServerMessage =
  | { t: "snapshot"; room: Room; events: RoomEvent[] }
  | { t: "event"; event: RoomEvent }
  | { t: "error"; text: string };

interface ClientSettings {
  url: string;
  roomId: string;
}

const defaultSettings: ClientSettings = {
  url: "ws://127.0.0.1:8787",
  roomId: "main",
};

const previewRoom: Room = {
  id: "main",
  title: "Quorum",
  workspacePath: "/Users/matthew/Projects/quorum",
  branch: "main",
  primary: "claude",
  policy: { name: "free-for-all", maxTurnsPerTopic: 6, noConsecutive: true, turnDeadlineMs: 180_000 },
  participants: [
    { id: "matt", kind: "human", display: "You", status: "idle" },
    { id: "claude", kind: "agent", display: "Claude", adapter: "claude-code", status: "active" },
    { id: "codex", kind: "agent", display: "Codex", adapter: "codex", status: "idle" },
    { id: "echo", kind: "agent", display: "Echo", adapter: "echo", status: "idle" },
  ],
  createdAt: Date.now(),
};

const previewEvents: RoomEvent[] = [
  event(1, "matt", "You", "human", "message", { text: "Review the daemon and make the UI easier to run." }),
  event(2, "conductor", "Conductor", "system", "floor_grant", { participantId: "claude", turnId: "turn-1", reason: "open floor" }),
  event(3, "claude", "Claude", "agent", "thinking", { text: "Checking workspace state and packaging path", partial: true }, "turn-1"),
  event(4, "claude", "Claude", "agent", "message", { text: "The current backend is healthy. I would add a desktop shell after the web client is usable." }, "turn-1"),
  event(5, "workspace", "Workspace", "system", "checkpoint", {
    preHead: "b41aef8",
    postHead: "ddd40f3",
    stat: { files: 11, insertions: 617, deletions: 20 },
    summary: "framework test hardening",
  }),
  event(6, "codex", "Codex", "agent", "floor_request", { intent: "rebut", reason: "Validate installer security before packaging" }),
  event(7, "conductor", "Conductor", "system", "floor_release", { turnId: "turn-1", reason: "done" }),
];

function event(
  seq: number,
  id: string,
  display: string,
  kind: RoomEvent["author"]["kind"],
  type: RoomEvent["type"],
  body: unknown,
  turnId?: string,
): RoomEvent {
  return {
    id: `preview-${seq}`,
    roomId: "main",
    seq,
    ts: Date.now() - (8 - seq) * 44_000,
    author: { kind, id, display },
    type,
    body,
    turnId,
    visibility: "room",
  };
}

function mergeEvents(current: RoomEvent[], incoming: RoomEvent[]): RoomEvent[] {
  if (!incoming.length) return current;
  const byId = new Map(current.map((item) => [item.id, item]));
  for (const item of incoming) byId.set(item.id, item);
  return [...byId.values()].sort((a, b) => a.seq - b.seq);
}

// Latest approval state per callId; the UI shows a prompt for any still "requested".
function pendingApprovals(events: RoomEvent[]): ApprovalSignal[] {
  const latest = new Map<string, ApprovalSignal>();
  for (const item of events) {
    if (item.type !== "system") continue;
    const signal = (item.body as SystemBody).approval;
    if (signal) latest.set(signal.callId, signal);
  }
  return [...latest.values()].filter((signal) => signal.state === "requested");
}

// Reconstruct whether the human currently holds the write floor from system events.
function humanHoldsWriteFloor(events: RoomEvent[]): boolean {
  let held = false;
  for (const item of events) {
    if (item.type !== "system") continue;
    const text = (item.body as SystemBody).text ?? "";
    if (text.includes("human holds the write floor")) held = true;
    else if (text.includes("write floor released")) held = false;
  }
  return held;
}

function loadSettings(): ClientSettings {
  try {
    const raw = localStorage.getItem("quorum.client.settings");
    if (!raw) return defaultSettings;
    return { ...defaultSettings, ...JSON.parse(raw) };
  } catch {
    return defaultSettings;
  }
}

function saveSettings(settings: ClientSettings): void {
  localStorage.setItem("quorum.client.settings", JSON.stringify(settings));
}

function App() {
  const [settings, setSettings] = useState<ClientSettings>(() => loadSettings());
  const [draftSettings, setDraftSettings] = useState<ClientSettings>(() => loadSettings());
  const [status, setStatus] = useState<ConnectionState>("idle");
  const [error, setError] = useState<string>("");
  const [room, setRoom] = useState<Room | undefined>();
  const [events, setEvents] = useState<RoomEvent[]>([]);
  const [selectedTargets, setSelectedTargets] = useState<string[]>([]);
  const [composer, setComposer] = useState("");
  const wsRef = useRef<WebSocket | null>(null);
  const lastSeqRef = useRef(0);
  const attemptRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const teardownRef = useRef(false);
  const feedRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true); // keep pinned to newest unless the user scrolls up

  const displayRoom = room ?? previewRoom;
  const displayEvents = events.length ? events : previewEvents;
  const isPreview = !events.length || status !== "connected";
  const participants = displayRoom.participants;
  const agents = participants.filter((participant) => participant.kind === "agent");
  const checkpoints = displayEvents.filter((item) => item.type === "checkpoint");
  const activeTurn = [...displayEvents].reverse().find((item) => item.type === "floor_grant")?.body as FloorGrantBody | undefined;
  const latestRelease = [...displayEvents].reverse().find((item) => item.type === "floor_release")?.body as FloorReleaseBody | undefined;
  const policy = displayRoom.policy;
  const connected = status === "connected";
  const approvals = isPreview ? [] : pendingApprovals(events);
  const holdsWriteFloor = isPreview ? false : humanHoldsWriteFloor(events);

  const groupedTurns = useMemo(() => {
    const turns = new Map<string, RoomEvent[]>();
    for (const item of displayEvents) {
      const key = item.turnId ?? "room";
      const group = turns.get(key) ?? [];
      group.push(item);
      turns.set(key, group);
    }
    return turns;
  }, [displayEvents]);

  useEffect(() => {
    saveSettings(settings);
  }, [settings]);

  // Keep the transcript pinned to the newest event unless the user scrolled up.
  useEffect(() => {
    const el = feedRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [displayEvents.length]);

  function onFeedScroll() {
    const el = feedRef.current;
    if (el) stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  }

  function ingest(merged: RoomEvent[]) {
    lastSeqRef.current = merged.length ? merged[merged.length - 1].seq : lastSeqRef.current;
    return merged;
  }

  function scheduleReconnect(next: ClientSettings) {
    if (teardownRef.current) return;
    const attempt = attemptRef.current++;
    const delay = Math.min(15_000, 500 * 2 ** attempt);
    reconnectTimerRef.current = setTimeout(() => connect(next, true), delay);
  }

  function connect(next = settings, resume = false) {
    if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
    teardownRef.current = false;
    wsRef.current?.close();
    if (!resume) {
      lastSeqRef.current = 0;
      setEvents([]);
      setSelectedTargets([]);
    }
    setStatus("connecting");
    setError("");

    try {
      const socket = new WebSocket(next.url);
      wsRef.current = socket;
      socket.addEventListener("open", () => {
        attemptRef.current = 0;
        setStatus("connected");
        setError(""); // clear any stale failure from a prior attempt
        socket.send(JSON.stringify({ t: "subscribe", roomId: next.roomId, sinceSeq: lastSeqRef.current }));
      });
      socket.addEventListener("message", (raw) => {
        const message = JSON.parse(String(raw.data)) as ServerMessage;
        if (message.t === "snapshot") {
          setRoom(message.room);
          setEvents((current) => ingest(mergeEvents(current, message.events)));
        } else if (message.t === "event") {
          setEvents((current) => ingest(mergeEvents(current, [message.event])));
        } else if (message.t === "error") {
          setError(message.text);
        }
      });
      socket.addEventListener("close", () => {
        if (wsRef.current !== socket || teardownRef.current) return; // replaced or intentional
        setStatus("offline");
        scheduleReconnect(next);
      });
      socket.addEventListener("error", () => {
        if (wsRef.current !== socket || teardownRef.current) return; // ignore a replaced/torn-down socket
        setError("Connection failed"); // a close event follows and drives the retry
      });
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Connection failed");
      scheduleReconnect(next);
    }
  }

  // Connect on load and tear the socket down cleanly on unmount.
  useEffect(() => {
    connect(settings, false);
    return () => {
      teardownRef.current = true;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      wsRef.current?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function applyConnection() {
    setSettings(draftSettings);
    attemptRef.current = 0;
    connect(draftSettings, false);
  }

  function send(payload: Record<string, unknown>): boolean {
    if (status !== "connected" || !wsRef.current) return false;
    wsRef.current.send(JSON.stringify({ roomId: settings.roomId, ...payload }));
    return true;
  }

  function sendMessage() {
    const text = composer.trim();
    if (!text) return;
    if (send({ t: "post_message", text, addressedTo: selectedTargets.length ? selectedTargets : undefined })) {
      setComposer("");
    }
  }

  function sendInterrupt() {
    send({ t: "interrupt", hard: true });
  }

  function setPolicy(name: ConductorPolicyConfig["name"]) {
    send({ t: "set_policy", policy: { ...policy, name } });
  }

  function approveTool(callId: string, allow: boolean) {
    send({ t: "approve_tool", callId, allow });
  }

  function takeWriteFloor() {
    send({ t: "take_write_floor" });
  }

  function rollback(toHead: string) {
    if (!window.confirm(`Roll the workspace back to ${toHead.slice(0, 7)}?\nThis is a hard git reset — commits after it are discarded.`)) return;
    send({ t: "rollback", toHead });
  }

  function toggleTarget(id: string) {
    setSelectedTargets((current) => current.includes(id)
      ? current.filter((target) => target !== id)
      : [...current, id]);
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand-block">
          <div className="brand-mark"><CircleDot size={18} /></div>
          <div>
            <div className="brand-name">Quorum</div>
            <div className="brand-meta">{displayRoom.branch} / {displayRoom.id}</div>
          </div>
        </div>

        <section className="panel connection-panel">
          <div className="panel-title">
            <Plug size={16} />
            <span>Connection</span>
            <StatusPill status={status} preview={isPreview} />
          </div>
          <label>
            <span>WebSocket</span>
            <input
              value={draftSettings.url}
              onChange={(input) => setDraftSettings((current) => ({ ...current, url: input.currentTarget.value }))}
            />
          </label>
          <label>
            <span>Room</span>
            <input
              value={draftSettings.roomId}
              onChange={(input) => setDraftSettings((current) => ({ ...current, roomId: input.currentTarget.value }))}
            />
          </label>
          <button className="primary-action" type="button" onClick={applyConnection}>
            <Radio size={16} />
            <span>{status === "connecting" ? "Connecting" : "Connect"}</span>
          </button>
          {error ? <div className="inline-alert"><AlertTriangle size={14} />{error}</div> : null}
        </section>

        <section className="panel">
          <div className="panel-title"><Bot size={16} /><span>Participants</span></div>
          <div className="participant-list">
            {participants.map((participant) => (
              <ParticipantRow key={participant.id} participant={participant} active={activeTurn?.participantId === participant.id} />
            ))}
          </div>
        </section>

        <section className="panel">
          <div className="panel-title"><GitCommitHorizontal size={16} /><span>Checkpoints</span></div>
          <div className="checkpoint-list">
            {checkpoints.slice(-4).reverse().map((item) => (
              <CheckpointRow key={item.id} event={item} canRollback={connected} onRollback={rollback} />
            ))}
          </div>
        </section>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <h1>{displayRoom.title}</h1>
            <div className="workspace-path">{displayRoom.workspacePath ?? "No workspace selected"}</div>
          </div>
          <div className="topbar-actions">
            <SegmentedControl current={policy.name} disabled={status !== "connected"} onChange={setPolicy} />
            <button className="danger-action" type="button" disabled={status !== "connected"} onClick={sendInterrupt}>
              <Zap size={16} />
              <span>Interrupt</span>
            </button>
          </div>
        </header>

        <section className="status-strip">
          <Metric icon={<Activity size={16} />} label="Events" value={String(displayEvents.length)} />
          <Metric icon={<Hand size={16} />} label="Floor" value={activeTurn?.participantId ?? "open"} />
          <Metric icon={<PauseCircle size={16} />} label="Last turn" value={latestRelease?.reason ?? "pending"} />
          <Metric icon={<Settings2 size={16} />} label="Policy" value={policy.name} />
        </section>

        <section className="room-grid">
          <section className="transcript">
            <div className="section-heading">
              <MessageSquare size={17} />
              <span>Room Stream</span>
              <small>{groupedTurns.size} groups</small>
            </div>
            <div className="event-feed" ref={feedRef} onScroll={onFeedScroll}>
              {displayEvents.map((item) => (
                <EventRow key={item.id} event={item} />
              ))}
            </div>
          </section>

          <aside className="activity-panel">
            <div className="section-heading">
              <SquareTerminal size={17} />
              <span>Operations</span>
            </div>
            {approvals.length ? (
              <div className="approval-list">
                {approvals.map((signal) => (
                  <div key={signal.callId} className="approval-card">
                    <div className="approval-head">
                      <ShieldQuestion size={15} />
                      <strong>{signal.tool}</strong>
                      <span>{signal.callId}</span>
                    </div>
                    <div className="approval-actions">
                      <button type="button" className="approve" disabled={!connected} onClick={() => approveTool(signal.callId, true)}>
                        <Check size={14} /> Approve
                      </button>
                      <button type="button" className="deny" disabled={!connected} onClick={() => approveTool(signal.callId, false)}>
                        <XCircle size={14} /> Deny
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
            <div className="agent-targets">
              {agents.map((agent) => (
                <button
                  key={agent.id}
                  className={selectedTargets.includes(agent.id) ? "target-chip selected" : "target-chip"}
                  type="button"
                  onClick={() => toggleTarget(agent.id)}
                >
                  <Bot size={14} />
                  <span>{agent.id}</span>
                </button>
              ))}
            </div>
            <textarea
              value={composer}
              onChange={(input) => setComposer(input.currentTarget.value)}
              onKeyDown={(key) => {
                if (key.key === "Enter" && (key.metaKey || key.ctrlKey)) sendMessage();
              }}
              placeholder="Message the room"
            />
            <button className="send-action" type="button" disabled={!connected || !composer.trim()} onClick={sendMessage}>
              <Send size={16} />
              <span>Send</span>
            </button>
            <button
              className={holdsWriteFloor ? "write-floor-action holding" : "write-floor-action"}
              type="button"
              disabled={!connected || holdsWriteFloor}
              onClick={takeWriteFloor}
              title="Pause agents and edit files directly. Sending a message hands the floor back."
            >
              <PenLine size={16} />
              <span>{holdsWriteFloor ? "You hold the write floor" : "Take write floor"}</span>
            </button>

            <div className="section-heading compact">
              <Wrench size={16} />
              <span>Tool Activity</span>
              <ChevronDown size={15} />
            </div>
            <div className="tool-list">
              {displayEvents.filter((item) => item.type === "tool_call" || item.type === "tool_result" || item.type === "thinking").slice(-6).map((item) => (
                <ToolRow key={item.id} event={item} />
              ))}
            </div>
          </aside>
        </section>
      </section>
    </main>
  );
}

function StatusPill({ status, preview }: { status: ConnectionState; preview: boolean }) {
  const reconnecting = status === "offline";
  const label = reconnecting ? "reconnecting" : preview ? "preview" : status;
  return (
    <span className={`status-pill ${status}`}>
      {reconnecting ? <RefreshCcw size={11} className="spin" /> : null}
      {label}
    </span>
  );
}

function ParticipantRow({ participant, active }: { participant: ParticipantDescriptor; active: boolean }) {
  const Icon = participant.kind === "human" ? UserRound : Bot;
  return (
    <div className={active ? "participant-row active" : "participant-row"}>
      <Icon size={16} />
      <div>
        <strong>{participant.display}</strong>
        <span>{participant.adapter ?? participant.kind}</span>
      </div>
      <i>{active ? "live" : participant.status}</i>
    </div>
  );
}

function CheckpointRow({
  event,
  canRollback,
  onRollback,
}: {
  event: RoomEvent;
  canRollback: boolean;
  onRollback: (toHead: string) => void;
}) {
  const body = event.body as CheckpointBody;
  return (
    <div className="checkpoint-row">
      <GitCommitHorizontal size={15} />
      <div>
        <strong>{body.summary ?? event.author.display}</strong>
        <span>{body.stat.files} files · +{body.stat.insertions} -{body.stat.deletions}</span>
      </div>
      <button
        type="button"
        className="rollback-btn"
        disabled={!canRollback || !body.preHead}
        title={`Roll back to ${body.preHead?.slice(0, 7) ?? "?"} (undo this checkpoint)`}
        onClick={() => onRollback(body.preHead)}
      >
        <Undo2 size={14} />
      </button>
    </div>
  );
}

function SegmentedControl({
  current,
  disabled,
  onChange,
}: {
  current: ConductorPolicyConfig["name"];
  disabled: boolean;
  onChange: (name: ConductorPolicyConfig["name"]) => void;
}) {
  const options: ConductorPolicyConfig["name"][] = ["free-for-all", "directed", "moderated"];
  return (
    <div className="segmented-control">
      {options.map((option) => (
        <button key={option} className={current === option ? "selected" : ""} disabled={disabled} type="button" onClick={() => onChange(option)}>
          {option}
        </button>
      ))}
    </div>
  );
}

function Metric({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="metric">
      {icon}
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
      </div>
    </div>
  );
}

function EventRow({ event }: { event: RoomEvent }) {
  const Icon = iconFor(event.type);
  return (
    <article className={`event-row ${event.author.kind} ${event.type}`}>
      <div className="event-icon"><Icon size={17} /></div>
      <div className="event-content">
        <div className="event-meta">
          <strong>{event.author.display}</strong>
          <span>{event.type}</span>
          <time>{new Date(event.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time>
        </div>
        <div className="event-body">{renderBody(event)}</div>
      </div>
    </article>
  );
}

function ToolRow({ event }: { event: RoomEvent }) {
  return (
    <div className="tool-row">
      {React.createElement(iconFor(event.type), { size: 15 })}
      <span>{event.author.display}</span>
      <strong>{renderBody(event)}</strong>
    </div>
  );
}

function iconFor(type: RoomEvent["type"]) {
  switch (type) {
    case "message": return MessageSquare;
    case "thinking": return Activity;
    case "tool_call": return Wrench;
    case "tool_result": return CheckCircle2;
    case "floor_request": return Hand;
    case "floor_grant": return Radio;
    case "floor_release": return PauseCircle;
    case "interrupt": return Zap;
    case "checkpoint": return GitCommitHorizontal;
    case "system": return AlertTriangle;
    default: return CircleDot;
  }
}

function renderBody(event: RoomEvent): React.ReactNode {
  switch (event.type) {
    case "message":
      return (event.body as MessageBody).text;
    case "thinking":
      return (event.body as ThinkingBody).text;
    case "tool_call": {
      const body = event.body as ToolCallBody;
      return `${body.tool}${body.name ? ` / ${body.name}` : ""}`;
    }
    case "tool_result": {
      const body = event.body as ToolResultBody;
      return body.ok ? `ok ${body.exitCode ?? 0}` : `failed ${body.exitCode ?? ""}`;
    }
    case "floor_request": {
      const body = event.body as FloorRequestBody;
      return `${body.intent}: ${body.reason}`;
    }
    case "floor_grant": {
      const body = event.body as FloorGrantBody;
      return `${body.participantId} · ${body.reason ?? "granted"}`;
    }
    case "floor_release": {
      const body = event.body as FloorReleaseBody;
      return body.reason;
    }
    case "checkpoint": {
      const body = event.body as CheckpointBody;
      return `${body.summary ?? "checkpoint"} · ${body.stat.files} files · +${body.stat.insertions} -${body.stat.deletions}`;
    }
    case "system":
      return (event.body as SystemBody).text;
    case "interrupt":
      return "hard interrupt";
    default:
      return JSON.stringify(event.body);
  }
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

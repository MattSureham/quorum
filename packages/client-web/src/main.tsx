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
  KeyRound,
  MessageSquare,
  NotebookText,
  PauseCircle,
  PenLine,
  Plug,
  Plus,
  Radio,
  RefreshCcw,
  Send,
  Settings2,
  ShieldQuestion,
  SquareTerminal,
  Trash2,
  Undo2,
  UserRound,
  Wrench,
  XCircle,
  Zap,
} from "lucide-react";
import type {
  ApprovalSignal,
  Bid,
  CheckpointBody,
  ConductorPolicyConfig,
  FloorGrantBody,
  FloorReleaseBody,
  FloorRequestBody,
  ImageAttachment,
  MessageBody,
  MemorySummary,
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
type SessionMode = "open-discussion" | "raise-hand" | "round-robin";
type Language = "en" | "zh";
type Translate = (text: string) => string;

const zhText: Record<string, string> = {
  "Sessions": "会话",
  "New session": "新建会话",
  "Delete session": "删除会话",
  "Connection": "连接",
  "WebSocket": "WebSocket",
  "Room": "房间",
  "Connecting": "连接中",
  "Connect": "连接",
  "Language": "语言",
  "No workspace selected": "未选择工作路径",
  "Interrupt": "中断",
  "Events": "事件",
  "Speaker": "发言者",
  "Floor": "发言权",
  "Phase": "阶段",
  "Last turn": "上一轮",
  "Activity": "活动",
  "Kernel": "内核",
  "Chat": "聊天",
  "No messages in this session yet.": "当前会话还没有消息。",
  "messages": "条消息",
  "Approve": "批准",
  "Deny": "拒绝",
  "No agents in this session": "当前会话没有智能体",
  "This session includes": "当前会话包含",
  "CLI agent; uses the local Codex session/auth": "CLI 智能体；使用本地 Codex 会话/认证",
  "CLI/SDK agent; uses Claude Code auth": "CLI/SDK 智能体；使用 Claude Code 认证",
  "Agent adapter placeholder; not installed in this build": "智能体 adapter 占位；当前构建未安装",
  "Direct API model agent": "直接 API 模型智能体",
  "local CLI": "本地 CLI",
  "API model": "API 模型",
  "placeholder": "占位",
  "files": "文件",
  "commands": "命令",
  "vision": "视觉",
  "no files": "不写文件",
  "key required": "需要 key",
  "health unknown": "健康状态未知",
  "Message the session": "发送消息到会话",
  "Image": "图片",
  "Send": "发送",
  "Write floor held": "已持有写入权",
  "Take write floor": "获取写入权",
  "Release write floor": "释放写入权",
  "Pause agents and edit files directly. Sending a message hands the floor back.": "暂停智能体并直接编辑文件。发送消息会交还发言权。",
  "Release the write floor so agents can edit files again.": "释放写入权，让智能体可以继续编辑文件。",
  "You hold the write floor. Release it or send a message to let agents continue editing.": "你正在持有写入权。点击释放或发送消息，让智能体继续编辑。",
  "Participants": "参与者",
  "Agents & Models": "智能体与模型",
  "In this room": "当前房间",
  "Available agent/model types": "可用智能体/模型类型",
  "Configure API keys": "配置 API keys",
  "Connect to a room before editing API credentials.": "连接到房间后才能编辑 API 凭证。",
  "Agent/model selection is room-based; provider keys only unlock API-model agents.": "智能体/模型选择按房间生效；provider keys 只用于解锁 API 模型智能体。",
  "Session diagnostics": "会话诊断",
  "Tool Activity": "工具活动",
  "Recent Activity": "最近活动",
  "Checkpoints": "检查点",
  "API model credentials": "API 模型凭证",
  "These keys are credential sources for API-model agents. CLI agents such as Codex and Claude Code use their own local auth/session.": "这些 key 是 API 模型智能体的凭证来源。Codex 和 Claude Code 等 CLI 智能体使用自己的本地登录/会话。",
  "Add provider": "添加 provider",
  "Close credentials": "关闭凭证",
  "New provider": "新 provider",
  "not set": "未设置",
  "Provider id": "Provider id",
  "API key": "API key",
  "Env var": "环境变量",
  "Base URL": "Base URL",
  "Default model": "默认模型",
  "Save": "保存",
  "Saving": "正在保存",
  "Done": "完成",
  "Session setup": "会话设置",
  "Choose participants and a discussion mode, then start a new shared session.": "选择参与者和讨论模式，然后启动新的共享会话。",
  "Session id": "会话 id",
  "Title": "标题",
  "Workspace path": "工作路径",
  "Optional absolute path for this session": "当前会话可选的绝对路径",
  "Mode": "模式",
  "Open discussion": "自由讨论",
  "Agents can take turns through bids; best for exploration.": "智能体通过抢麦轮流发言，适合探索。",
  "Raise hand": "举手/抢麦",
  "Agents request the floor and must wait for the active speaker to finish.": "智能体申请发言权，并等待当前发言者结束。",
  "Round robin": "按序陈述",
  "Agents speak once each in the selected participant order.": "智能体按所选参与者顺序各发言一次。",
  "current room": "当前房间",
  "available": "可用",
  "Close": "关闭",
  "Start session": "启动会话",
  "Close session setup": "关闭会话设置",
  "Shared Session": "共享会话",
  "active": "活跃",
  "selected": "已选择",
  "Score components": "评分组成",
  "Bid queue": "抢麦队列",
  "No pending bids": "没有待处理抢麦",
  "Debug events": "调试事件",
  "No debug events": "没有调试事件",
  "Replay": "重放",
  "after seq": "起始 seq",
  "Run": "运行",
  "events": "事件",
  "head": "head",
  "phase": "阶段",
  "speaker": "发言者",
  "bids": "抢麦",
  "last": "最后",
  "Memory": "记忆",
  "from": "从",
  "to": "到",
  "Compact": "压缩",
  "No memory summaries": "没有记忆摘要",
  "Still waiting": "仍在等待",
  "Queued": "已排队",
  "Contacting agent": "正在联系智能体",
  "Agent thinking": "智能体思考中",
  "Tool running": "工具运行中",
  "Waiting approval": "等待审批",
  "Completed without reply": "已完成但无回复",
  "Message accepted by the daemon; waiting for the scheduler.": "daemon 已接收消息，等待调度器处理。",
  "Agent turn granted; waiting for the first output.": "智能体已获得发言权，等待首个输出。",
  "Agent is producing intermediate output.": "智能体正在产生中间输出。",
  "Tool call is running:": "工具调用正在运行：",
  "Approve or deny the requested tool call:": "请批准或拒绝工具调用：",
  "The last turn completed, but no agent message was added after your prompt.": "上一轮已完成，但你的 prompt 之后没有新增智能体消息。",
  "agent bid(s) received so far.": "个智能体抢麦已收到。",
  "selected.": "已选择。",
  "is responding.": "正在回复。",
  "Last turn completed:": "上一轮完成：",
  "Offline": "离线",
  "Connect to a room before sending.": "连接到房间后才能发送。",
  "Submitted": "已提交",
  "Message sent locally; waiting for daemon acknowledgement.": "消息已在本地提交，等待 daemon 确认。",
  "Turn failed": "发言失败",
  "The latest agent turn failed. Check diagnostics for details.": "最近一次智能体发言失败。请查看诊断信息。",
  "Collecting bids": "收集抢麦",
  "Selecting speaker": "选择发言者",
  "Choosing who speaks next.": "正在选择下一位发言者。",
  "Speaking": "发言中",
  "An agent is responding.": "智能体正在回复。",
  "Settling": "结算中",
  "Finalizing the turn and checking for follow-up bids.": "正在结束本轮并检查后续抢麦。",
  "Completed": "已完成",
  "Waiting for agents": "等待智能体",
  "Human message is in the room; waiting for an agent to react.": "人工消息已进入房间，等待智能体响应。",
  "Idle": "空闲",
  "No active agent turn.": "当前没有活跃的智能体发言。",
  "live": "在线",
  "idle": "空闲",
  "thinking": "思考中",
  "offline": "离线",
  "connected": "已连接",
  "connecting": "连接中",
  "error": "错误",
  "open": "开放",
  "pending": "等待中",
  "preview": "预览",
  "reconnecting": "重连中",
  "none": "无",
  "room": "房间",
  "key": "key",
  "set": "已设置",
  "needs key": "需要 key",
  "adapter TBD": "adapter 待定",
  "local auth": "本地认证",
  "Custom API provider credential": "自定义 API provider 凭证",
  "Used by": "用于",
  "Credential source for API-model agents": "API 模型智能体的凭证来源",
  "Leave blank to keep existing key": "留空以保留现有 key",
  "Paste API key": "粘贴 API key",
  "Provider default": "Provider 默认值",
  "This removes its local transcript, memory summaries, tool/cache records, and native session ids from Quorum storage.": "这会从 Quorum 本地存储中删除该会话的 transcript、记忆摘要、工具/缓存记录和原生 session id。",
  "Session id is required": "必须填写会话 id",
  "Select at least one agent/model": "至少选择一个智能体/模型",
  "Provider id is required": "必须填写 provider id",
  "Roll the workspace back to": "将工作区回滚到",
  "This is a hard git reset — commits after it are discarded.": "这是 hard git reset，之后的提交会被丢弃。",
};

function translate(language: Language, text: string): string {
  return language === "zh" ? zhText[text] ?? text : text;
}

type ServerMessage =
  | { t: "snapshot"; room: Room; events: RoomEvent[]; summaries?: MemorySummary[] }
  | { t: "event"; event: RoomEvent }
  | { t: "sessions"; rooms: Room[] }
  | { t: "session_created"; room: Room; rooms: Room[] }
  | { t: "session_continued"; room: Room; rooms: Room[] }
  | { t: "session_deleted"; sessionId: string; rooms: Room[] }
  | { t: "replay_projection"; afterSeq: number; headSeq: number; eventCount: number; projection: SharedSessionProjectionResult }
  | { t: "memory_compacted"; summary?: MemorySummary; summaries: MemorySummary[] }
  | { t: "credentials"; providers: ProviderConfigView[] }
  | { t: "credential_saved"; provider: ProviderConfigView; providers: ProviderConfigView[] }
  | { t: "error"; text: string };

interface SharedSessionProjectionResult {
  phase: string;
  epoch: number;
  activeTurn?: { turnId: string; speakerId: string; generation: number };
  pendingBids: Bid[];
  selected?: { agentId?: string; score?: number; kind?: string };
  lastTurnId?: string;
}

interface ClientSettings {
  url: string;
  roomId: string;
}

interface DesktopSidecarConnection {
  url: string;
}

interface ProviderConfigView {
  providerId: string;
  envVar?: string;
  configured: boolean;
  apiKeyPreview?: string;
  baseUrl?: string;
  model?: string;
  updatedAt: number;
}

interface CredentialDraft {
  draftId: string;
  providerId: string;
  envVar: string;
  apiKey: string;
  baseUrl: string;
  model: string;
  locked?: boolean;
}

interface SessionDraft {
  roomId: string;
  title: string;
  mode: SessionMode;
  workspacePath: string;
  participantIds: string[];
}

const credentialPresets: CredentialDraft[] = [
  { draftId: "preset-openai", providerId: "openai", envVar: "OPENAI_API_KEY", apiKey: "", baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini", locked: true },
  { draftId: "preset-deepseek", providerId: "deepseek", envVar: "DEEPSEEK_API_KEY", apiKey: "", baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat", locked: true },
  { draftId: "preset-zhipu", providerId: "zhipu", envVar: "ZHIPU_API_KEY", apiKey: "", baseUrl: "https://open.bigmodel.cn/api/paas/v4", model: "glm-4.6", locked: true },
  { draftId: "preset-minimax", providerId: "minimax", envVar: "MINIMAX_API_KEY", apiKey: "", baseUrl: "https://api.minimax.io/v1", model: "MiniMax-M3", locked: true },
  { draftId: "preset-anthropic", providerId: "anthropic", envVar: "ANTHROPIC_API_KEY", apiKey: "", baseUrl: "", model: "claude-sonnet-4-20250514", locked: true },
];

interface AgentModelPreset {
  id: string;
  display: string;
  adapter: string;
  detail: string;
  credential: string;
  providerId?: string;
  vision?: boolean;
}

const agentModelPresets: AgentModelPreset[] = [
  { id: "codex", display: "Codex", adapter: "codex", detail: "CLI agent; uses the local Codex session/auth", credential: "Codex CLI" },
  { id: "claude-code", display: "Claude Code", adapter: "claude-code", detail: "CLI/SDK agent; uses Claude Code auth", credential: "Claude Code auth" },
  { id: "openclaw", display: "OpenClaw", adapter: "openclaw", detail: "Agent adapter placeholder; not installed in this build", credential: "Agent-specific auth" },
  { id: "deepseek-v4-pro", display: "DeepSeek V4 Pro", adapter: "api-model", detail: "Direct API model agent", credential: "DeepSeek API key", providerId: "deepseek" },
  { id: "deepseek-v4-flash", display: "DeepSeek V4 Flash", adapter: "api-model", detail: "Direct API model agent", credential: "DeepSeek API key", providerId: "deepseek" },
  { id: "glm-5.2", display: "GLM 5.2", adapter: "api-model", detail: "Direct API model agent", credential: "Zhipu API key", providerId: "zhipu" },
  { id: "minimax-m3", display: "MiniMax M3", adapter: "api-model", detail: "Direct API model agent", credential: "MiniMax API key", providerId: "minimax", vision: true },
];

const defaultSettings: ClientSettings = {
  url: "ws://127.0.0.1:8787",
  roomId: "main",
};

const defaultSessionDraft: SessionDraft = {
  roomId: "new-session",
  title: "New session",
  mode: "open-discussion",
  workspacePath: "",
  participantIds: ["codex", "claude-code"],
};

const previewRoom: Room = {
  id: "main",
  title: "Quorum",
  workspacePath: "/Users/matthew/Projects/quorum",
  branch: "main",
  primary: "claude-code",
  policy: { name: "free-for-all", maxTurnsPerTopic: 6, noConsecutive: true, turnDeadlineMs: 180_000 },
  participants: [
    { id: "matt", kind: "human", display: "You", status: "idle" },
    { id: "claude-code", kind: "agent", display: "Claude Code", adapter: "claude-code", status: "active" },
    { id: "codex", kind: "agent", display: "Codex", adapter: "codex", status: "idle" },
    { id: "echo", kind: "agent", display: "Echo", adapter: "echo", status: "idle" },
  ],
  createdAt: Date.now(),
};

const emptyRoom: Room = {
  id: "no-session",
  title: "No session selected",
  workspacePath: "",
  branch: "main",
  policy: { name: "free-for-all", maxTurnsPerTopic: 6, noConsecutive: true, turnDeadlineMs: 180_000 },
  participants: [{ id: "matt", kind: "human", display: "You", status: "idle" }],
  createdAt: Date.now(),
};

const previewEvents: RoomEvent[] = [
  event(1, "matt", "You", "human", "message", { text: "Review the daemon and make the UI easier to run." }),
  event(2, "conductor", "Conductor", "system", "floor_grant", { participantId: "claude-code", turnId: "turn-1", reason: "open floor" }),
  event(3, "claude-code", "Claude Code", "agent", "thinking", { text: "Checking workspace state and packaging path", partial: true }, "turn-1"),
  event(4, "claude-code", "Claude Code", "agent", "message", { text: "The current backend is healthy. I would add a desktop shell after the web client is usable." }, "turn-1"),
  event(5, "workspace", "Workspace", "system", "checkpoint", {
    preHead: "b41aef8",
    postHead: "ddd40f3",
    stat: { files: 11, insertions: 617, deletions: 20 },
    summary: "framework test hardening",
  }),
  event(6, "codex", "Codex", "agent", "floor_request", { intent: "rebut", reason: "Validate installer security before packaging" }),
  event(7, "conductor", "Conductor", "system", "floor_release", { turnId: "turn-1", reason: "done" }),
];

interface SharedSessionProjection {
  enabled: boolean;
  phase: string;
  activeSpeaker?: string;
  activeTurnId?: string;
  pendingBids: Bid[];
  selected?: { agentId?: string; score?: number; kind?: string; components?: Record<string, number> };
  lastCompleted?: string;
  debugEvents: RoomEvent[];
}

interface RunStatus {
  state:
    | "offline"
    | "queued"
    | "submitted"
    | "collecting"
    | "arbitrating"
    | "contacting"
    | "thinking"
    | "tool"
    | "approval"
    | "speaking"
    | "settling"
    | "completed"
    | "idle"
    | "error";
  label: string;
  detail: string;
  lastEvent?: string;
}

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

function upsertRoom(current: Room[], room: Room): Room[] {
  const next = current.filter((item) => item.id !== room.id);
  next.push(room);
  return next.sort((a, b) => a.createdAt - b.createdAt);
}

function participantFromPreset(id: string): ParticipantDescriptor | undefined {
  const preset = agentModelPresets.find((item) => item.id === id);
  if (!preset) return undefined;
  const credential = preset.providerId ? credentialPresets.find((item) => item.providerId === preset.providerId) : undefined;
  const adapterConfig: Record<string, unknown> = {};
  if (preset.id === "codex") adapterConfig.sandbox = "workspace-write";
  if (preset.id === "claude-code") adapterConfig.permissionMode = "bypassPermissions";
  if (preset.adapter === "api-model") {
    if (credential?.model) adapterConfig.model = credential.model;
    if (credential?.envVar) adapterConfig.apiKeyEnv = credential.envVar;
    if (credential?.baseUrl) adapterConfig.baseUrl = credential.baseUrl;
  }
  return {
    id,
    kind: "agent",
    display: preset.display,
    adapter: preset.adapter,
    adapterConfig,
    status: "idle",
  };
}

function buildSessionParticipants(draft: SessionDraft, currentRoom: Room): ParticipantDescriptor[] {
  const participants: ParticipantDescriptor[] = [{ id: "human", kind: "human", display: "You", status: "idle" }];
  for (const id of draft.participantIds) {
    const existing = currentRoom.participants.find((participant) => participant.id === id && participant.kind === "agent");
    const participant = existing ?? participantFromPreset(id);
    if (participant && !participants.some((item) => item.id === participant.id)) participants.push({ ...participant, status: "idle" });
  }
  return participants;
}

function readImageAttachment(file: File): Promise<ImageAttachment> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error(`Failed to read ${file.name}`));
    reader.onload = () => resolve({
      id: `img-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      name: file.name,
      mimeType: file.type || "application/octet-stream",
      dataUrl: String(reader.result ?? ""),
      sizeBytes: file.size,
    });
    reader.readAsDataURL(file);
  });
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

function latestHumanMessage(events: RoomEvent[]): RoomEvent | undefined {
  return [...events].reverse().find((item) => item.type === "message" && item.author.kind === "human");
}

function hasAgentMessageAfter(events: RoomEvent[], seq: number): boolean {
  return events.some((item) => item.seq > seq && item.type === "message" && item.author.kind === "agent");
}

function unresolvedToolCall(events: RoomEvent[], afterSeq: number): ToolCallBody | undefined {
  const calls = new Map<string, ToolCallBody>();
  for (const item of events) {
    if (item.seq <= afterSeq) continue;
    if (item.type === "tool_call") {
      const body = item.body as ToolCallBody;
      calls.set(body.callId, body);
    } else if (item.type === "tool_result") {
      const body = item.body as ToolResultBody;
      calls.delete(body.callId);
    }
  }
  return [...calls.values()].at(-1);
}

function latestTurnFailedAfter(events: RoomEvent[], seq: number): RoomEvent | undefined {
  return [...events].reverse().find((item) => item.seq > seq && item.type === "turn_failed");
}

function latestTurnCompletedAfter(events: RoomEvent[], seq: number): RoomEvent | undefined {
  return [...events].reverse().find((item) => item.seq > seq && item.type === "turn_completed");
}

function latestAgentOutputAfter(events: RoomEvent[], seq: number): RoomEvent | undefined {
  return [...events].reverse().find((item) =>
    item.seq > seq &&
    item.author.kind === "agent" &&
    (item.type === "thinking" || item.type === "turn_output_chunk" || item.type === "message")
  );
}

function projectSharedSession(events: RoomEvent[]): SharedSessionProjection {
  const pending = new Map<string, Bid>();
  let phase = "legacy";
  let activeSpeaker: string | undefined;
  let activeTurnId: string | undefined;
  let selected: SharedSessionProjection["selected"];
  let lastCompleted: string | undefined;
  let enabled = false;

  for (const item of events) {
    if (
      item.type === "phase_changed" ||
      item.type === "bid_submitted" ||
      item.type === "bid_settled" ||
      item.type === "speaker_selected" ||
      item.type === "turn_started" ||
      item.type === "turn_completed" ||
      item.type === "turn_cancelled" ||
      item.type === "turn_failed"
    ) {
      enabled = true;
    }

    if (item.type === "phase_changed") {
      const body = item.body as any;
      phase = String(body.to ?? phase);
    } else if (item.type === "bid_submitted") {
      const bid = (item.body as any).bid as Bid | undefined;
      if (bid) pending.set(bid.bidId, bid);
    } else if (item.type === "bid_settled") {
      const body = item.body as any;
      if (body.action === "withdrawn" && body.bidId) pending.delete(String(body.bidId));
    } else if (item.type === "speaker_selected") {
      const body = item.body as any;
      const winner = body.winner;
      const bid = winner?.bid as Bid | undefined;
      if (bid) {
        pending.delete(bid.bidId);
        selected = {
          agentId: bid.agentId,
          score: typeof winner.score === "number" ? winner.score : undefined,
          kind: bid.kind,
          components: winner.components,
        };
      }
    } else if (item.type === "turn_started") {
      const body = item.body as any;
      activeSpeaker = body.speakerId;
      activeTurnId = body.turnId;
    } else if (item.type === "turn_completed" || item.type === "turn_cancelled" || item.type === "turn_failed") {
      const body = item.body as any;
      if (body.turnId === activeTurnId) {
        activeSpeaker = undefined;
        activeTurnId = undefined;
      }
      lastCompleted = body.turnId;
    }
  }

  return {
    enabled,
    phase,
    activeSpeaker,
    activeTurnId,
    pendingBids: [...pending.values()],
    selected,
    lastCompleted,
    debugEvents: events.filter((item) => item.visibility === "debug" || item.visibility === "system").slice(-12).reverse(),
  };
}

function describeRunStatus({
  connected,
  events,
  shared,
  lastSubmittedAt,
  now,
  t,
}: {
  connected: boolean;
  events: RoomEvent[];
  shared: SharedSessionProjection;
  lastSubmittedAt?: number;
  now: number;
  t: Translate;
}): RunStatus {
  const latest = events[events.length - 1];
  const lastEvent = latest ? `#${latest.seq} ${latest.type} by ${latest.author.display}` : undefined;
  const waitMs = lastSubmittedAt ? Math.max(0, now - lastSubmittedAt) : 0;
  const waitSeconds = Math.floor(waitMs / 1000);
  const waitingPrefix = waitMs > 5_000 ? `${t("Still waiting")} (${waitSeconds}s). ` : "";
  if (!connected) return { state: "offline", label: t("Offline"), detail: t("Connect to a room before sending."), lastEvent };
  if (lastSubmittedAt && (!latest || latest.ts < lastSubmittedAt)) {
    return { state: "queued", label: t("Queued"), detail: `${waitingPrefix}${t("Message sent locally; waiting for daemon acknowledgement.")}`, lastEvent };
  }
  const humanMessage = latestHumanMessage(events);
  const afterPromptSeq = humanMessage?.seq ?? 0;
  const pendingApproval = pendingApprovals(events).at(-1);
  const toolCall = unresolvedToolCall(events, afterPromptSeq);
  const failed = latestTurnFailedAfter(events, afterPromptSeq);
  const completed = latestTurnCompletedAfter(events, afterPromptSeq);
  const agentOutput = latestAgentOutputAfter(events, afterPromptSeq);
  if (failed) return { state: "error", label: t("Turn failed"), detail: t("The latest agent turn failed. Check diagnostics for details."), lastEvent };
  if (pendingApproval) {
    return { state: "approval", label: t("Waiting approval"), detail: `${waitingPrefix}${t("Approve or deny the requested tool call:")} ${pendingApproval.tool}`, lastEvent };
  }
  if (toolCall) {
    return { state: "tool", label: t("Tool running"), detail: `${waitingPrefix}${t("Tool call is running:")} ${toolCall.tool}`, lastEvent };
  }
  if (shared.enabled) {
    if (shared.phase === "collecting_bids") {
      return { state: "collecting", label: t("Collecting bids"), detail: `${waitingPrefix}${shared.pendingBids.length} ${t("agent bid(s) received so far.")}`, lastEvent };
    }
    if (shared.phase === "arbitrating" || shared.phase === "speaker_granted") {
      return { state: "arbitrating", label: t("Selecting speaker"), detail: shared.selected?.agentId ? `${shared.selected.agentId} ${t("selected.")}` : t("Choosing who speaks next."), lastEvent };
    }
    if (shared.phase === "speaking") {
      if (!agentOutput) {
        return { state: "contacting", label: t("Contacting agent"), detail: `${waitingPrefix}${t("Agent turn granted; waiting for the first output.")}`, lastEvent };
      }
      if (agentOutput.type === "thinking" || agentOutput.type === "turn_output_chunk") {
        return { state: "thinking", label: t("Agent thinking"), detail: `${waitingPrefix}${t("Agent is producing intermediate output.")}`, lastEvent };
      }
      return { state: "speaking", label: t("Speaking"), detail: `${waitingPrefix}${shared.activeSpeaker ? `${shared.activeSpeaker} ${t("is responding.")}` : t("An agent is responding.")}`, lastEvent };
    }
    if (shared.phase === "settling") {
      return { state: "settling", label: t("Settling"), detail: t("Finalizing the turn and checking for follow-up bids."), lastEvent };
    }
    if (shared.phase === "idle" && shared.lastCompleted) {
      if (humanMessage && completed && !hasAgentMessageAfter(events, humanMessage.seq)) {
        return { state: "error", label: t("Completed without reply"), detail: t("The last turn completed, but no agent message was added after your prompt."), lastEvent };
      }
      return { state: "completed", label: t("Completed"), detail: `${t("Last turn completed:")} ${shared.lastCompleted}.`, lastEvent };
    }
  }
  if (latest?.type === "message" && latest.author.kind === "human") {
    return { state: "submitted", label: t("Waiting for agents"), detail: `${waitingPrefix}${t("Message accepted by the daemon; waiting for the scheduler.")}`, lastEvent };
  }
  return { state: "idle", label: t("Idle"), detail: latest ? t("No active agent turn.") : t("No messages in this session yet."), lastEvent };
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

function loadLanguage(): Language {
  const raw = localStorage.getItem("quorum.client.language");
  return raw === "zh" ? "zh" : "en";
}

function saveLanguage(language: Language): void {
  localStorage.setItem("quorum.client.language", language);
}

function isTauriRuntime(): boolean {
  return "__TAURI_INTERNALS__" in window;
}

async function resolveDesktopSettings(settings: ClientSettings): Promise<ClientSettings> {
  if (!isTauriRuntime()) return settings;
  const { invoke } = await import("@tauri-apps/api/core");
  const connection = await invoke<DesktopSidecarConnection>("get_sidecar_connection");
  return { ...settings, url: connection.url };
}

function App() {
  const [settings, setSettings] = useState<ClientSettings>(() => loadSettings());
  const [draftSettings, setDraftSettings] = useState<ClientSettings>(() => loadSettings());
  const [language, setLanguage] = useState<Language>(() => loadLanguage());
  const [status, setStatus] = useState<ConnectionState>("idle");
  const [error, setError] = useState<string>("");
  const [room, setRoom] = useState<Room | undefined>();
  const [rooms, setRooms] = useState<Room[]>([]);
  const [sessionsLoaded, setSessionsLoaded] = useState(false);
  const [deletingSessionIds, setDeletingSessionIds] = useState<Set<string>>(() => new Set());
  const [deletedSessionIds, setDeletedSessionIds] = useState<Set<string>>(() => new Set());
  const [events, setEvents] = useState<RoomEvent[]>([]);
  const [selectedTargets, setSelectedTargets] = useState<string[]>([]);
  const [composer, setComposer] = useState("");
  const [composerAttachments, setComposerAttachments] = useState<ImageAttachment[]>([]);
  const [lastSubmittedAt, setLastSubmittedAt] = useState<number | undefined>();
  const [now, setNow] = useState(Date.now());
  const [replayAfterSeq, setReplayAfterSeq] = useState("0");
  const [replayResult, setReplayResult] = useState<ServerMessage & { t: "replay_projection" }>();
  const [memoryFromSeq, setMemoryFromSeq] = useState("0");
  const [memoryToSeq, setMemoryToSeq] = useState("");
  const [memorySummaries, setMemorySummaries] = useState<MemorySummary[]>([]);
  const [credentialViews, setCredentialViews] = useState<ProviderConfigView[]>([]);
  const [credentialDrafts, setCredentialDrafts] = useState<CredentialDraft[]>(credentialPresets);
  const [credentialStatus, setCredentialStatus] = useState("");
  const [credentialsOpen, setCredentialsOpen] = useState(false);
  const [sessionSetupOpen, setSessionSetupOpen] = useState(false);
  const [sessionDraftSeed, setSessionDraftSeed] = useState<SessionDraft>(defaultSessionDraft);
  const wsRef = useRef<WebSocket | null>(null);
  const lastSeqRef = useRef(0);
  const deletedSessionIdsRef = useRef<Set<string>>(new Set());
  const attemptRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const teardownRef = useRef(false);
  const feedRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const stickRef = useRef(true); // keep pinned to newest unless the user scrolls up

  const displayRoom = room ?? (sessionsLoaded ? emptyRoom : previewRoom);
  const visibleRooms = (sessionsLoaded ? rooms : rooms.length ? rooms : [displayRoom])
    .filter((item) => !deletingSessionIds.has(item.id) && !deletedSessionIds.has(item.id));
  const isPreview = status !== "connected";
  const displayEvents = isPreview ? previewEvents : events;
  const chatEvents = displayEvents.filter((item) => item.type === "message");
  const activityEvents = displayEvents.filter((item) => item.type !== "message");
  const participants = displayRoom.participants;
  const agents = participants.filter((participant) => participant.kind === "agent");
  const checkpoints = displayEvents.filter((item) => item.type === "checkpoint");
  const activeTurn = [...displayEvents].reverse().find((item) => item.type === "floor_grant")?.body as FloorGrantBody | undefined;
  const latestRelease = [...displayEvents].reverse().find((item) => item.type === "floor_release")?.body as FloorReleaseBody | undefined;
  const policy = displayRoom.policy;
  const connected = status === "connected";
  const approvals = isPreview ? [] : pendingApprovals(events);
  const holdsWriteFloor = isPreview ? false : humanHoldsWriteFloor(events);
  const shared = useMemo(() => projectSharedSession(displayEvents), [displayEvents]);
  const t = useMemo<Translate>(() => (text) => translate(language, text), [language]);
  const runStatus = useMemo(
    () => describeRunStatus({ connected, events: displayEvents, shared, lastSubmittedAt, now, t }),
    [connected, displayEvents, shared, lastSubmittedAt, now, t],
  );

  useEffect(() => {
    saveSettings(settings);
  }, [settings]);

  useEffect(() => {
    saveLanguage(language);
  }, [language]);

  useEffect(() => {
    if (!lastSubmittedAt) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [lastSubmittedAt]);

  // Keep the transcript pinned to the newest event unless the user scrolled up.
  useEffect(() => {
    const el = feedRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [chatEvents.length]);

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
        socket.send(JSON.stringify({ t: "list_sessions", roomId: next.roomId }));
        socket.send(JSON.stringify({ t: "subscribe", roomId: next.roomId, sinceSeq: lastSeqRef.current }));
        socket.send(JSON.stringify({ t: "get_credentials", roomId: next.roomId }));
      });
      socket.addEventListener("message", (raw) => {
        const message = JSON.parse(String(raw.data)) as ServerMessage;
        if (message.t === "snapshot") {
          if (deletedSessionIdsRef.current.has(message.room.id)) return;
          setRoom(message.room);
          setRooms((current) => upsertRoom(current, message.room).filter((item) => !deletedSessionIdsRef.current.has(item.id)));
          setEvents((current) => ingest(mergeEvents(current, message.events)));
          if (message.summaries) setMemorySummaries(message.summaries);
        } else if (message.t === "event") {
          setEvents((current) => ingest(mergeEvents(current, [message.event])));
        } else if (message.t === "sessions") {
          setRooms(message.rooms.filter((item) => !deletedSessionIdsRef.current.has(item.id)));
          setSessionsLoaded(true);
        } else if (message.t === "session_created") {
          deletedSessionIdsRef.current.delete(message.room.id);
          setDeletedSessionIds((current) => {
            const nextDeleted = new Set(current);
            nextDeleted.delete(message.room.id);
            return nextDeleted;
          });
          setRooms(message.rooms.filter((item) => !deletedSessionIdsRef.current.has(item.id)));
          setSessionsLoaded(true);
          setRoom(message.room);
          setEvents([]);
          lastSeqRef.current = 0;
          const nextSettings = { ...next, roomId: message.room.id };
          setSettings(nextSettings);
          setDraftSettings(nextSettings);
          socket.send(JSON.stringify({ t: "subscribe", roomId: message.room.id, sinceSeq: 0 }));
        } else if (message.t === "session_continued") {
          deletedSessionIdsRef.current.delete(message.room.id);
          setDeletedSessionIds((current) => {
            const nextDeleted = new Set(current);
            nextDeleted.delete(message.room.id);
            return nextDeleted;
          });
          setRooms(message.rooms.filter((item) => !deletedSessionIdsRef.current.has(item.id)));
          setSessionsLoaded(true);
          setRoom(message.room);
          setEvents([]);
          lastSeqRef.current = 0;
          const nextSettings = { ...next, roomId: message.room.id };
          setSettings(nextSettings);
          setDraftSettings(nextSettings);
          socket.send(JSON.stringify({ t: "subscribe", roomId: message.room.id, sinceSeq: 0 }));
        } else if (message.t === "session_deleted") {
          deletedSessionIdsRef.current.add(message.sessionId);
          setDeletedSessionIds((current) => new Set(current).add(message.sessionId));
          setDeletingSessionIds((current) => {
            const next = new Set(current);
            next.delete(message.sessionId);
            return next;
          });
          setRooms(message.rooms.filter((item) => item.id !== message.sessionId && !deletedSessionIdsRef.current.has(item.id)));
          setSessionsLoaded(true);
          if (message.sessionId === settings.roomId || message.sessionId === displayRoom.id) {
            const fallback = message.rooms.find((item) => item.id !== message.sessionId && !deletedSessionIdsRef.current.has(item.id));
            if (fallback) {
              switchSession(fallback.id);
            } else {
              setRoom(undefined);
              setEvents([]);
              setMemorySummaries([]);
            }
          }
        } else if (message.t === "replay_projection") {
          setReplayResult(message);
        } else if (message.t === "memory_compacted") {
          setMemorySummaries(message.summaries);
        } else if (message.t === "credentials") {
          setCredentialViews(message.providers);
          mergeCredentialViews(message.providers);
        } else if (message.t === "credential_saved") {
          setCredentialStatus(`${message.provider.providerId} saved`);
          setCredentialViews(message.providers);
          mergeCredentialViews(message.providers);
        } else if (message.t === "error") {
          deletedSessionIdsRef.current.clear();
          setDeletedSessionIds(new Set());
          setDeletingSessionIds(new Set());
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
    let cancelled = false;
    async function boot() {
      try {
        const initial = await resolveDesktopSettings(settings);
        if (cancelled) return;
        setSettings(initial);
        setDraftSettings(initial);
        connect(initial, false);
      } catch (err) {
        if (cancelled) return;
        setStatus("error");
        setError(err instanceof Error ? err.message : "Failed to start desktop sidecar");
      }
    }
    void boot();
    return () => {
      cancelled = true;
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

  function switchSession(roomId: string) {
    const next = { ...settings, roomId };
    setSettings(next);
    setDraftSettings(next);
    setEvents([]);
    setSelectedTargets([]);
    setLastSubmittedAt(undefined);
    lastSeqRef.current = 0;
    send({ t: "continue_session", sessionId: roomId });
  }

  function deleteSession(room: Room) {
    if (!window.confirm(`${t("Delete session")} "${room.title}"?\n\n${t("This removes its local transcript, memory summaries, tool/cache records, and native session ids from Quorum storage.")}`)) return;
    if (send({ t: "delete_session", sessionId: room.id })) {
      deletedSessionIdsRef.current.add(room.id);
      setDeletedSessionIds((current) => new Set(current).add(room.id));
      setDeletingSessionIds((current) => new Set(current).add(room.id));
    }
  }

  function send(payload: Record<string, unknown>): boolean {
    if (status !== "connected" || !wsRef.current) return false;
    wsRef.current.send(JSON.stringify({ roomId: settings.roomId, ...payload }));
    return true;
  }

  function createSessionFromDraft(draft: SessionDraft) {
    const id = draft.roomId.trim();
    if (!id) {
      setError(t("Session id is required"));
      return;
    }
    const participants = buildSessionParticipants(draft, displayRoom);
    if (!participants.some((participant) => participant.kind === "agent")) {
      setError(t("Select at least one agent/model"));
      return;
    }
    if (send({
      t: "create_session",
      session: {
        id,
        title: draft.title.trim() || id,
        mode: draft.mode,
        workspacePath: draft.workspacePath.trim() || undefined,
        participants,
      },
    })) {
      setSessionSetupOpen(false);
    }
  }

  function sendMessage() {
    const text = composer.trim();
    if (!text && !composerAttachments.length) return;
    if (send({
      t: "post_message",
      text,
      attachments: composerAttachments.length ? composerAttachments : undefined,
      addressedTo: selectedTargets.length ? selectedTargets : undefined,
    })) {
      setLastSubmittedAt(Date.now());
      setComposer("");
      setComposerAttachments([]);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function attachImages(files: FileList | null) {
    if (!files?.length) return;
    const images = [...files].filter((file) => file.type.startsWith("image/"));
    const loaded = await Promise.all(images.map(readImageAttachment));
    setComposerAttachments((current) => [...current, ...loaded].slice(0, 6));
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function removeAttachment(id: string) {
    setComposerAttachments((current) => current.filter((item) => item.id !== id));
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

  function releaseWriteFloor() {
    send({ t: "release_write_floor" });
  }

  function replayProjection() {
    const afterSeq = Math.max(0, Number.parseInt(replayAfterSeq, 10) || 0);
    setReplayAfterSeq(String(afterSeq));
    send({ t: "replay_projection", afterSeq });
  }

  function compactMemory() {
    const fromSeq = Math.max(0, Number.parseInt(memoryFromSeq, 10) || 0);
    const parsedToSeq = Number.parseInt(memoryToSeq, 10);
    const toSeq = Number.isFinite(parsedToSeq) && parsedToSeq >= 0 ? parsedToSeq : undefined;
    setMemoryFromSeq(String(fromSeq));
    send({ t: "compact_memory", fromSeq, toSeq });
  }

  function mergeCredentialViews(providers: ProviderConfigView[]) {
    setCredentialDrafts((current) => {
      const merged = current.map((draft) => {
        const view = providers.find((provider) => provider.providerId === draft.providerId);
        if (!view) return draft;
        return {
          ...draft,
          envVar: view.envVar ?? draft.envVar,
          baseUrl: view.baseUrl ?? draft.baseUrl,
          model: view.model ?? draft.model,
          apiKey: "",
        };
      });
      const known = new Set(merged.map((draft) => draft.providerId).filter(Boolean));
      for (const provider of providers) {
        if (known.has(provider.providerId)) continue;
        merged.push({
          draftId: `saved-${provider.providerId}`,
          providerId: provider.providerId,
          envVar: provider.envVar ?? "",
          apiKey: "",
          baseUrl: provider.baseUrl ?? "",
          model: provider.model ?? "",
        });
        known.add(provider.providerId);
      }
      return merged;
    });
  }

  function updateCredentialDraft(draftId: string, patch: Partial<CredentialDraft>) {
    setCredentialStatus("");
    setCredentialDrafts((current) => current.map((draft) => draft.draftId === draftId ? { ...draft, ...patch } : draft));
  }

  function addCredentialDraft() {
    setCredentialStatus("");
    setCredentialDrafts((current) => [
      ...current,
      {
        draftId: `custom-${Date.now()}`,
        providerId: "",
        envVar: "",
        apiKey: "",
        baseUrl: "",
        model: "",
      },
    ]);
  }

  function saveCredential(draft: CredentialDraft) {
    const providerId = draft.providerId.trim();
    if (!providerId) {
      setCredentialStatus(t("Provider id is required"));
      return;
    }
    const payload: Record<string, unknown> = {
      t: "set_credential",
      providerId,
      envVar: draft.envVar.trim() || undefined,
      baseUrl: draft.baseUrl.trim() || undefined,
      model: draft.model.trim() || undefined,
    };
    if (draft.apiKey.trim()) payload.apiKey = draft.apiKey.trim();
    if (send(payload)) setCredentialStatus(`${t("Saving")} ${providerId}...`);
  }

  function rollback(toHead: string) {
    if (!window.confirm(`${t("Roll the workspace back to")} ${toHead.slice(0, 7)}?\n${t("This is a hard git reset — commits after it are discarded.")}`)) return;
    send({ t: "rollback", toHead });
  }

  function toggleTarget(id: string) {
    setSelectedTargets((current) => current.includes(id)
      ? current.filter((target) => target !== id)
      : [...current, id]);
  }

  function openSessionSetup() {
    const nextId = `session-${Date.now().toString(36)}`;
    setSessionDraftSeed({
      roomId: nextId,
      title: "New session",
      mode: "open-discussion",
      workspacePath: displayRoom.workspacePath ?? "",
      participantIds: agents.map((agent) => agent.id),
    });
    setSessionSetupOpen(true);
  }

  return (
    <main className="app-shell">
      <aside className="sidebar session-sidebar">
        <div className="brand-block">
          <div className="brand-mark"><CircleDot size={18} /></div>
          <div>
            <div className="brand-name">Quorum</div>
            <div className="brand-meta">{displayRoom.branch} / {displayRoom.id}</div>
          </div>
        </div>

        <section className="panel room-list-panel">
          <div className="panel-title">
            <MessageSquare size={16} />
            <span>{t("Sessions")}</span>
          </div>
          {visibleRooms.map((item) => (
            <div key={item.id} className={item.id === displayRoom.id ? "room-list-row active" : "room-list-row"}>
            <button
              key={item.id}
              className={item.id === displayRoom.id ? "room-list-item active" : "room-list-item"}
              type="button"
              disabled={item.id === displayRoom.id}
              onClick={() => switchSession(item.id)}
            >
              <span>{item.title}</span>
              <strong>{item.id}</strong>
            </button>
            <button
              className="icon-action room-delete-action"
              type="button"
              title={t("Delete session")}
              aria-label={`${t("Delete session")} ${item.title}`}
              onClick={() => deleteSession(item)}
            >
              <Trash2 size={15} />
            </button>
            </div>
          ))}
          <button className="secondary-action full-width-action" type="button" onClick={openSessionSetup}>
            <Plus size={15} />
            <span>{t("New session")}</span>
          </button>
        </section>

        <section className="panel connection-panel">
          <div className="panel-title">
            <Plug size={16} />
            <span>{t("Connection")}</span>
            <StatusPill status={status} preview={isPreview} t={t} />
          </div>
          <label>
            <span>{t("WebSocket")}</span>
            <input
              value={draftSettings.url}
              onChange={(input) => setDraftSettings((current) => ({ ...current, url: input.currentTarget.value }))}
            />
          </label>
          <label>
            <span>{t("Room")}</span>
            <input
              value={draftSettings.roomId}
              onChange={(input) => setDraftSettings((current) => ({ ...current, roomId: input.currentTarget.value }))}
            />
          </label>
          <button className="primary-action" type="button" onClick={applyConnection}>
            <Radio size={16} />
            <span>{status === "connecting" ? t("Connecting") : t("Connect")}</span>
          </button>
          {error ? <div className="inline-alert"><AlertTriangle size={14} />{error}</div> : null}
          <div className="language-toggle" aria-label={t("Language")}>
            <span>{t("Language")}</span>
            <button type="button" className={language === "en" ? "selected" : ""} onClick={() => setLanguage("en")}>EN</button>
            <button type="button" className={language === "zh" ? "selected" : ""} onClick={() => setLanguage("zh")}>中文</button>
          </div>
        </section>
      </aside>

      <section className="workspace chat-shell">
        <header className="topbar chat-topbar">
          <div>
            <h1>{displayRoom.title}</h1>
            <div className="workspace-path">{displayRoom.workspacePath ?? t("No workspace selected")}</div>
          </div>
          <div className="topbar-actions">
            <SegmentedControl current={policy.name} disabled={status !== "connected" || shared.enabled} onChange={setPolicy} />
            <button className="danger-action" type="button" disabled={status !== "connected"} onClick={sendInterrupt}>
              <Zap size={16} />
              <span>{t("Interrupt")}</span>
            </button>
          </div>
        </header>

        <section className="status-strip compact-status">
          <Metric icon={<Activity size={16} />} label={t("Events")} value={String(displayEvents.length)} />
          <Metric icon={<Hand size={16} />} label={shared.enabled ? t("Speaker") : t("Floor")} value={shared.activeSpeaker ?? activeTurn?.participantId ?? t("open")} />
          <Metric icon={<PauseCircle size={16} />} label={shared.enabled ? t("Phase") : t("Last turn")} value={shared.enabled ? shared.phase : latestRelease?.reason ?? t("pending")} />
          <Metric icon={<Radio size={16} />} label={t("Activity")} value={runStatus.label} />
          <Metric icon={<Settings2 size={16} />} label={t("Kernel")} value={shared.enabled ? "shared-session" : policy.name} />
        </section>

        <section className="transcript chat-transcript">
          <div className="section-heading">
            <MessageSquare size={17} />
            <span>{t("Chat")}</span>
            <small>{chatEvents.length} {t("messages")}</small>
          </div>
          <div className="event-feed" ref={feedRef} onScroll={onFeedScroll}>
            {chatEvents.length ? (
              chatEvents.map((item) => <ChatMessageRow key={item.id} event={item} />)
            ) : (
              <div className="empty-chat">
                <MessageSquare size={18} />
                <span>{t("No messages in this session yet.")}</span>
              </div>
            )}
          </div>
        </section>

        {approvals.length ? (
          <div className="approval-list chat-approvals">
            {approvals.map((signal) => (
              <div key={signal.callId} className="approval-card">
                <div className="approval-head">
                  <ShieldQuestion size={15} />
                  <strong>{signal.tool}</strong>
                  <span>{signal.callId}</span>
                </div>
                <div className="approval-actions">
                  <button type="button" className="approve" disabled={!connected} onClick={() => approveTool(signal.callId, true)}>
                    <Check size={14} /> {t("Approve")}
                  </button>
                  <button type="button" className="deny" disabled={!connected} onClick={() => approveTool(signal.callId, false)}>
                    <XCircle size={14} /> {t("Deny")}
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : null}

        <section className="chat-composer">
          <RunStatusBanner status={runStatus} />
          <div className="session-participant-summary">
            <Bot size={14} />
            <span>{agents.length ? `${t("This session includes")} ${agents.map((agent) => agent.display).join(", ")}` : t("No agents in this session")}</span>
          </div>
          <div className="agent-targets">
            {agents.map((agent) => (
              <button
                key={agent.id}
                className={selectedTargets.includes(agent.id) ? "target-chip selected" : "target-chip"}
                type="button"
                onClick={() => toggleTarget(agent.id)}
              >
                <Bot size={14} />
                <span>{agent.display}</span>
                <small>{agent.id}</small>
              </button>
            ))}
          </div>
          <textarea
            value={composer}
            onChange={(input) => setComposer(input.currentTarget.value)}
            onKeyDown={(key) => {
              if (key.key === "Enter" && (key.metaKey || key.ctrlKey)) sendMessage();
            }}
            placeholder={t("Message the session")}
          />
          {composerAttachments.length ? (
            <div className="composer-attachments">
              {composerAttachments.map((image) => (
                <div key={image.id} className="composer-attachment">
                  <img src={image.dataUrl} alt={image.name} />
                  <span>{image.name}</span>
                  <button type="button" aria-label={`Remove ${image.name}`} onClick={() => removeAttachment(image.id)}>
                    <XCircle size={14} />
                  </button>
                </div>
              ))}
            </div>
          ) : null}
          <div className="composer-actions">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden-file-input"
              onChange={(input) => void attachImages(input.currentTarget.files)}
            />
            <button className="secondary-action attach-action" type="button" disabled={!connected} onClick={() => fileInputRef.current?.click()}>
              <Plus size={16} />
              <span>{t("Image")}</span>
            </button>
            <button className="send-action" type="button" disabled={!connected || (!composer.trim() && !composerAttachments.length)} onClick={sendMessage}>
              <Send size={16} />
              <span>{t("Send")}</span>
            </button>
            <button
              className={holdsWriteFloor ? "write-floor-action holding" : "write-floor-action"}
              type="button"
              disabled={!connected}
              onClick={holdsWriteFloor ? releaseWriteFloor : takeWriteFloor}
              title={holdsWriteFloor ? t("Release the write floor so agents can edit files again.") : t("Pause agents and edit files directly. Sending a message hands the floor back.")}
            >
              <PenLine size={16} />
              <span>{holdsWriteFloor ? t("Release write floor") : t("Take write floor")}</span>
            </button>
          </div>
          {holdsWriteFloor ? <div className="write-floor-hint">{t("You hold the write floor. Release it or send a message to let agents continue editing.")}</div> : null}
        </section>
      </section>

      <aside className="config-sidebar">
        <section className="panel">
          <div className="panel-title"><Bot size={16} /><span>{t("Participants")}</span></div>
          <div className="participant-list">
            {participants.map((participant) => (
              <ParticipantRow key={participant.id} participant={participant} active={activeTurn?.participantId === participant.id} t={t} />
            ))}
          </div>
        </section>

        <AgentModelPanel
          connected={connected}
          participants={participants}
          views={credentialViews}
          onConfigure={() => setCredentialsOpen(true)}
          t={t}
        />

        <details className="debug-details">
          <summary><SquareTerminal size={16} /> {t("Session diagnostics")}</summary>
          <div className="diagnostics-stack">
            {shared.enabled ? <SharedSessionPanel shared={shared} t={t} /> : null}
            {shared.enabled ? (
              <ReplayPanel
                afterSeq={replayAfterSeq}
                result={replayResult}
                disabled={!connected}
                onAfterSeq={setReplayAfterSeq}
                onReplay={replayProjection}
                t={t}
              />
            ) : null}
            {shared.enabled ? (
              <MemoryPanel
                fromSeq={memoryFromSeq}
                toSeq={memoryToSeq}
                summaries={memorySummaries}
                disabled={!connected}
                onFromSeq={setMemoryFromSeq}
                onToSeq={setMemoryToSeq}
                onCompact={compactMemory}
                t={t}
              />
            ) : null}
            <div className="section-heading compact">
              <Wrench size={16} />
              <span>{t("Tool Activity")}</span>
              <ChevronDown size={15} />
            </div>
            <div className="tool-list">
              {displayEvents.filter((item) => item.type === "tool_call" || item.type === "tool_result" || item.type === "thinking").slice(-6).map((item) => (
                <ToolRow key={item.id} event={item} />
              ))}
            </div>
            <div className="section-heading compact">
              <Activity size={16} />
              <span>{t("Recent Activity")}</span>
              <ChevronDown size={15} />
            </div>
            <div className="activity-list">
              {activityEvents.slice(-10).map((item) => (
                <EventRow key={item.id} event={item} compact />
              ))}
            </div>
          </div>
        </details>

        <details className="debug-details">
          <summary><GitCommitHorizontal size={16} /> {t("Checkpoints")}</summary>
          <div className="checkpoint-list diagnostics-stack">
            {checkpoints.slice(-4).reverse().map((item) => (
              <CheckpointRow key={item.id} event={item} canRollback={connected} onRollback={rollback} />
            ))}
          </div>
        </details>
      </aside>

      {credentialsOpen ? (
        <CredentialsModal
          connected={connected}
          drafts={credentialDrafts}
          views={credentialViews}
          status={credentialStatus}
          onChange={updateCredentialDraft}
          onSave={saveCredential}
          onAddProvider={addCredentialDraft}
          onClose={() => setCredentialsOpen(false)}
          t={t}
        />
      ) : null}

      {sessionSetupOpen ? (
        <SessionSetupModal
          initialDraft={sessionDraftSeed}
          currentRoom={displayRoom}
          onStart={createSessionFromDraft}
          connected={connected}
          onClose={() => setSessionSetupOpen(false)}
          t={t}
        />
      ) : null}
    </main>
  );
}

function AgentModelPanel({
  connected,
  participants,
  views,
  onConfigure,
  t,
}: {
  connected: boolean;
  participants: ParticipantDescriptor[];
  views: ProviderConfigView[];
  onConfigure: () => void;
  t: Translate;
}) {
  const roomAgents = participants.filter((participant) => participant.kind === "agent");
  return (
    <section className="panel agent-model-panel">
      <div className="panel-title">
        <Settings2 size={16} />
        <span>{t("Agents & Models")}</span>
      </div>
      <div className="agent-model-section">
        <div className="mini-heading">{t("In this room")}</div>
        <div className="agent-model-list">
          {roomAgents.map((agent) => (
            <div key={agent.id} className="agent-model-row active">
              <Bot size={15} />
              <div>
                <strong>{agent.display}</strong>
                <span>{formatAgentDetail(agent)}</span>
                <CapabilityBadges labels={capabilityBadgesForAgent(agent)} t={t} />
              </div>
              <span className="credential-state configured">{t("room")}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="agent-model-section">
        <div className="mini-heading">{t("Available agent/model types")}</div>
        <div className="agent-model-list">
          {agentModelPresets.map((preset) => {
            const view = preset.providerId ? views.find((provider) => provider.providerId === preset.providerId) : undefined;
            const configured = preset.providerId ? view?.configured : preset.id !== "openclaw";
            const state = preset.providerId
              ? (configured ? `${t("key")} ${view?.apiKeyPreview ?? t("set")}` : t("needs key"))
              : preset.id === "openclaw" ? t("adapter TBD") : t("local auth");
            const statusClass = configured ? "credential-state configured" : "credential-state";
            return (
              <div key={preset.id} className="agent-model-row">
                <Bot size={15} />
                <div>
                  <strong>{preset.display}</strong>
                  <span>{t(preset.detail)}</span>
                  <CapabilityBadges labels={capabilityBadgesForPreset(preset, !!configured)} t={t} />
                </div>
                <span className={statusClass}>{state}</span>
              </div>
            );
          })}
        </div>
      </div>
      <button type="button" className="secondary-action provider-config-action" disabled={!connected} onClick={onConfigure}>
        <KeyRound size={15} />
        <span>{t("Configure API keys")}</span>
      </button>
      {!connected ? <div className="muted-note">{t("Connect to a room before editing API credentials.")}</div> : null}
      <div className="muted-note">{t("Agent/model selection is room-based; provider keys only unlock API-model agents.")}</div>
    </section>
  );
}

function formatAgentDetail(agent: ParticipantDescriptor): string {
  const adapter = agent.adapter ?? agent.kind;
  const model = typeof agent.adapterConfig?.model === "string" ? agent.adapterConfig.model : undefined;
  return model ? `${adapter} / ${model}` : adapter;
}

function capabilityBadgesForAgent(agent: ParticipantDescriptor): string[] {
  const adapter = agent.adapter ?? agent.kind;
  if (adapter === "codex" || adapter === "claude-code") return ["local CLI", "files", "commands"];
  if (adapter === "api-model") {
    const model = typeof agent.adapterConfig?.model === "string" ? agent.adapterConfig.model.toLowerCase() : "";
    return ["API model", model.includes("minimax") ? "vision" : "no files"];
  }
  if (adapter === "echo") return ["local CLI", "no files"];
  if (adapter === "openclaw") return ["placeholder"];
  return [adapter];
}

function capabilityBadgesForPreset(preset: AgentModelPreset, configured: boolean): string[] {
  if (preset.id === "openclaw") return ["placeholder"];
  if (preset.adapter === "api-model") return ["API model", preset.vision ? "vision" : "no files", configured ? "set" : "key required"];
  if (preset.adapter === "codex" || preset.adapter === "claude-code") return ["local CLI", "files", "commands"];
  return [preset.adapter];
}

function modelsUsingProvider(providerId: string, t: Translate): string {
  if (!providerId) return t("Custom API provider credential");
  const models = agentModelPresets
    .filter((preset) => preset.providerId === providerId)
    .map((preset) => preset.display);
  return models.length ? `${t("Used by")} ${models.join(", ")}` : t("Credential source for API-model agents");
}

function CredentialsModal({
  connected,
  drafts,
  views,
  status,
  onChange,
  onSave,
  onAddProvider,
  onClose,
  t,
}: {
  connected: boolean;
  drafts: CredentialDraft[];
  views: ProviderConfigView[];
  status: string;
  onChange: (draftId: string, patch: Partial<CredentialDraft>) => void;
  onSave: (draft: CredentialDraft) => void;
  onAddProvider: () => void;
  onClose: () => void;
  t: Translate;
}) {
  return (
    <div className="credential-modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="credential-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="credential-modal-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="credential-modal-head">
          <div>
            <div className="panel-title" id="credential-modal-title">
              <KeyRound size={16} />
              <span>{t("API model credentials")}</span>
            </div>
            <p>{t("These keys are credential sources for API-model agents. CLI agents such as Codex and Claude Code use their own local auth/session.")}</p>
          </div>
          <div className="credential-modal-head-actions">
            <button type="button" className="secondary-action compact-action" onClick={onAddProvider}>
              <Plus size={15} />
              <span>{t("Add provider")}</span>
            </button>
            <button type="button" className="icon-action" onClick={onClose} aria-label={t("Close credentials")}>
              <XCircle size={18} />
            </button>
          </div>
        </div>

        <div className="credentials-panel">
          {drafts.map((draft) => {
            const view = views.find((provider) => provider.providerId === draft.providerId);
            return (
              <div key={draft.draftId} className="credential-card">
                <div className="credential-card-head">
                  <div>
                    <strong>{draft.providerId || t("New provider")}</strong>
                    <span>{modelsUsingProvider(draft.providerId, t)}</span>
                  </div>
                  <span className={view?.configured ? "credential-state configured" : "credential-state"}>
                    {view?.configured ? `${t("set")} ${view.apiKeyPreview ?? ""}` : t("not set")}
                  </span>
                </div>
                <label>
                  <span>{t("Provider id")}</span>
                  <input
                    disabled={draft.locked}
                    placeholder="zhipu, moonshot, openrouter..."
                    value={draft.providerId}
                    onChange={(input) => onChange(draft.draftId, { providerId: input.currentTarget.value.trim().toLowerCase() })}
                  />
                </label>
                <label>
                  <span>{t("API key")}</span>
                  <input
                    type="password"
                    autoComplete="off"
                    placeholder={view?.configured ? t("Leave blank to keep existing key") : t("Paste API key")}
                    value={draft.apiKey}
                    onChange={(input) => onChange(draft.draftId, { apiKey: input.currentTarget.value })}
                  />
                </label>
                <label>
                  <span>{t("Env var")}</span>
                  <input
                    value={draft.envVar}
                    onChange={(input) => onChange(draft.draftId, { envVar: input.currentTarget.value })}
                  />
                </label>
                <label>
                  <span>{t("Base URL")}</span>
                  <input
                    placeholder={t("Provider default")}
                    value={draft.baseUrl}
                    onChange={(input) => onChange(draft.draftId, { baseUrl: input.currentTarget.value })}
                  />
                </label>
                <label>
                  <span>{t("Default model")}</span>
                  <input
                    value={draft.model}
                    onChange={(input) => onChange(draft.draftId, { model: input.currentTarget.value })}
                  />
                </label>
                <button type="button" className="secondary-action" disabled={!connected} onClick={() => onSave(draft)}>
                  <Check size={14} />
                  <span>{t("Save")}</span>
                </button>
              </div>
            );
          })}
        </div>
        {status ? <div className="credential-status">{status}</div> : null}
        <div className="credential-modal-actions">
          <button type="button" className="primary-action" onClick={onClose}>{t("Done")}</button>
        </div>
      </section>
    </div>
  );
}

function SessionSetupModal({
  initialDraft,
  currentRoom,
  connected,
  onStart,
  onClose,
  t,
}: {
  initialDraft: SessionDraft;
  currentRoom: Room;
  connected: boolean;
  onStart: (draft: SessionDraft) => void;
  onClose: () => void;
  t: Translate;
}) {
  const [draft, setDraft] = useState<SessionDraft>(initialDraft);
  const currentAgentIds = new Set(currentRoom.participants.filter((participant) => participant.kind === "agent").map((participant) => participant.id));
  const participantOptions = [
    ...currentRoom.participants.filter((participant) => participant.kind === "agent").map((participant) => ({
      id: participant.id,
      display: participant.display,
      detail: formatAgentDetail(participant),
      active: true,
    })),
    ...agentModelPresets.filter((preset) => !currentAgentIds.has(preset.id)).map((preset) => ({
      id: preset.id,
      display: preset.display,
      detail: t(preset.detail),
      active: false,
    })),
  ];
  const modes: Array<{ id: SessionMode; label: string; detail: string }> = [
    { id: "open-discussion", label: t("Open discussion"), detail: t("Agents can take turns through bids; best for exploration.") },
    { id: "raise-hand", label: t("Raise hand"), detail: t("Agents request the floor and must wait for the active speaker to finish.") },
    { id: "round-robin", label: t("Round robin"), detail: t("Agents speak once each in the selected participant order.") },
  ];

  function toggleParticipant(id: string) {
    setDraft((current) => ({
      ...current,
      participantIds: current.participantIds.includes(id)
        ? current.participantIds.filter((participantId) => participantId !== id)
        : [...current.participantIds, id],
    }));
  }

  return (
    <div className="credential-modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="credential-modal session-setup-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="session-setup-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="credential-modal-head">
          <div>
            <div className="panel-title" id="session-setup-title">
              <MessageSquare size={16} />
              <span>{t("Session setup")}</span>
            </div>
            <p>{t("Choose participants and a discussion mode, then start a new shared session.")}</p>
          </div>
          <button type="button" className="icon-action" onClick={onClose} aria-label={t("Close session setup")}>
            <XCircle size={18} />
          </button>
        </div>

        <div className="session-setup-grid">
          <section className="session-setup-section">
            <div className="mini-heading">{t("New session")}</div>
            <label>
              <span>{t("Session id")}</span>
              <input
                value={draft.roomId}
                onChange={(input) => {
                  const value = input.currentTarget.value;
                  setDraft((current) => ({ ...current, roomId: value }));
                }}
              />
            </label>
            <label>
              <span>{t("Title")}</span>
              <input
                value={draft.title}
                onChange={(input) => {
                  const value = input.currentTarget.value;
                  setDraft((current) => ({ ...current, title: value }));
                }}
              />
            </label>
            <label>
              <span>{t("Workspace path")}</span>
              <input
                value={draft.workspacePath}
                placeholder={currentRoom.workspacePath ?? t("Optional absolute path for this session")}
                onChange={(input) => {
                  const value = input.currentTarget.value;
                  setDraft((current) => ({ ...current, workspacePath: value }));
                }}
              />
            </label>
          </section>

          <section className="session-setup-section">
            <div className="mini-heading">{t("Mode")}</div>
            <div className="mode-list">
              {modes.map((mode) => (
                <button
                  key={mode.id}
                  className={draft.mode === mode.id ? "mode-option selected" : "mode-option"}
                  type="button"
                  onClick={() => setDraft((current) => ({ ...current, mode: mode.id }))}
                >
                  <strong>{mode.label}</strong>
                  <span>{mode.detail}</span>
                </button>
              ))}
            </div>
          </section>

          <section className="session-setup-section wide">
            <div className="mini-heading">{t("Participants")}</div>
            <div className="participant-picker-list">
              {participantOptions.map((participant) => (
                <label key={participant.id} className="participant-picker-row">
                  <input
                    type="checkbox"
                    checked={draft.participantIds.includes(participant.id)}
                    onChange={() => toggleParticipant(participant.id)}
                  />
                  <div>
                    <strong>{participant.display}</strong>
                    <span>{participant.detail}</span>
                  </div>
                  <i>{participant.active ? t("current room") : t("available")}</i>
                </label>
              ))}
            </div>
          </section>
        </div>

        <div className="credential-modal-actions">
          <button type="button" className="secondary-action" onClick={onClose}>{t("Close")}</button>
          <button type="button" className="primary-action" disabled={!connected} onClick={() => onStart(draft)}>{t("Start session")}</button>
        </div>
      </section>
    </div>
  );
}

function StatusPill({ status, preview, t }: { status: ConnectionState; preview: boolean; t: Translate }) {
  const reconnecting = status === "offline";
  const label = reconnecting ? "reconnecting" : preview ? "preview" : status;
  return (
    <span className={`status-pill ${status}`}>
      {reconnecting ? <RefreshCcw size={11} className="spin" /> : null}
      {t(label)}
    </span>
  );
}

function RunStatusBanner({ status }: { status: RunStatus }) {
  return (
    <div className={`run-status-banner ${status.state}`}>
      <span className="run-status-dot" />
      <div>
        <strong>{status.label}</strong>
        <span>{status.detail}</span>
      </div>
      {status.lastEvent ? <code>{status.lastEvent}</code> : null}
    </div>
  );
}

function ParticipantRow({ participant, active, t }: { participant: ParticipantDescriptor; active: boolean; t: Translate }) {
  const Icon = participant.kind === "human" ? UserRound : Bot;
  return (
    <div className={active ? "participant-row active" : "participant-row"}>
      <Icon size={16} />
      <div>
        <strong>{participant.display}</strong>
        <span>{participant.adapter ?? participant.kind}</span>
        {participant.kind === "agent" ? <CapabilityBadges labels={capabilityBadgesForAgent(participant)} t={t} /> : null}
      </div>
      <i>{active ? t("live") : t(participant.status)}</i>
    </div>
  );
}

function CapabilityBadges({ labels, t }: { labels: string[]; t: Translate }) {
  return (
    <div className="capability-badges">
      {labels.map((label) => <span key={label}>{t(label)}</span>)}
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

function SharedSessionPanel({ shared, t }: { shared: SharedSessionProjection; t: Translate }) {
  const scoreComponents = Object.entries(shared.selected?.components ?? {})
    .filter(([, value]) => Number.isFinite(value));
  return (
    <section className="shared-panel shared-session-panel">
      <div className="shared-panel-head">
        <Activity size={15} />
        <strong>{t("Shared Session")}</strong>
        <span>{shared.phase}</span>
      </div>
      <div className="shared-kv">
        <span>{t("active")}</span>
        <strong>{shared.activeSpeaker ?? t("open")}</strong>
      </div>
      <div className="shared-kv">
        <span>{t("selected")}</span>
        <strong>{shared.selected?.agentId ? `${shared.selected.agentId} · ${shared.selected.kind} · ${shared.selected.score?.toFixed(3) ?? "n/a"}` : t("none")}</strong>
      </div>
      {scoreComponents.length ? (
        <>
          <div className="mini-heading score-heading">{t("Score components")}</div>
          <div className="score-grid">
            {scoreComponents.map(([name, value]) => (
              <div key={name} className="score-row">
                <span>{name}</span>
                <strong>{value.toFixed(3)}</strong>
              </div>
            ))}
          </div>
        </>
      ) : null}
      <div className="mini-heading bid-heading">{t("Bid queue")}</div>
      <div className="bid-list">
        {shared.pendingBids.length ? shared.pendingBids.map((bid) => (
          <div key={bid.bidId} className="bid-row">
            <Hand size={14} />
            <div>
              <strong>{bid.agentId}</strong>
              <span>{bid.kind} · conf {bid.confidence.toFixed(2)}</span>
            </div>
          </div>
        )) : <div className="empty-row">{t("No pending bids")}</div>}
      </div>
      <div className="mini-heading debug-heading">{t("Debug events")}</div>
      <div className="debug-list">
        {shared.debugEvents.length ? shared.debugEvents.map((event) => (
          <div key={event.id} className="debug-row">
            <span>#{event.seq}</span>
            <strong>{event.type}</strong>
          </div>
        )) : <div className="empty-row">{t("No debug events")}</div>}
      </div>
    </section>
  );
}

function ReplayPanel({
  afterSeq,
  result,
  disabled,
  onAfterSeq,
  onReplay,
  t,
}: {
  afterSeq: string;
  result?: ServerMessage & { t: "replay_projection" };
  disabled: boolean;
  onAfterSeq: (value: string) => void;
  onReplay: () => void;
  t: Translate;
}) {
  return (
    <section className="replay-panel">
      <div className="replay-head">
        <RefreshCcw size={15} />
        <strong>{t("Replay")}</strong>
      </div>
      <div className="replay-controls">
        <label>
          <span>{t("after seq")}</span>
          <input
            inputMode="numeric"
            value={afterSeq}
            onChange={(input) => onAfterSeq(input.currentTarget.value)}
          />
        </label>
        <button type="button" disabled={disabled} onClick={onReplay}>
          <RefreshCcw size={14} />
          <span>{t("Run")}</span>
        </button>
      </div>
      {result ? (
        <div className="replay-result">
          <div><span>{t("events")}</span><strong>{result.eventCount}</strong></div>
          <div><span>{t("head")}</span><strong>{result.headSeq}</strong></div>
          <div><span>{t("phase")}</span><strong>{result.projection.phase}</strong></div>
          <div><span>{t("speaker")}</span><strong>{result.projection.activeTurn?.speakerId ?? t("open")}</strong></div>
          <div><span>{t("bids")}</span><strong>{result.projection.pendingBids.length}</strong></div>
          <div><span>{t("last")}</span><strong>{result.projection.lastTurnId?.slice(0, 8) ?? t("none")}</strong></div>
        </div>
      ) : null}
    </section>
  );
}

function MemoryPanel({
  fromSeq,
  toSeq,
  summaries,
  disabled,
  onFromSeq,
  onToSeq,
  onCompact,
  t,
}: {
  fromSeq: string;
  toSeq: string;
  summaries: MemorySummary[];
  disabled: boolean;
  onFromSeq: (value: string) => void;
  onToSeq: (value: string) => void;
  onCompact: () => void;
  t: Translate;
}) {
  const latest = summaries.at(-1);
  return (
    <section className="memory-panel">
      <div className="memory-head">
        <NotebookText size={15} />
        <strong>{t("Memory")}</strong>
        <span>{summaries.length}</span>
      </div>
      <div className="memory-controls">
        <label>
          <span>{t("from")}</span>
          <input inputMode="numeric" value={fromSeq} onChange={(input) => onFromSeq(input.currentTarget.value)} />
        </label>
        <label>
          <span>{t("to")}</span>
          <input inputMode="numeric" placeholder={t("head")} value={toSeq} onChange={(input) => onToSeq(input.currentTarget.value)} />
        </label>
        <button type="button" disabled={disabled} onClick={onCompact}>
          <NotebookText size={14} />
          <span>{t("Compact")}</span>
        </button>
      </div>
      {latest ? (
        <div className="memory-summary">
          <div className="memory-meta">
            <span>#{latest.sourceFromSeq}-#{latest.sourceToSeq}</span>
            <strong>{latest.sourceHash.slice(0, 8)}</strong>
          </div>
          <pre>{latest.content}</pre>
        </div>
      ) : <div className="empty-row">{t("No memory summaries")}</div>}
    </section>
  );
}

function ChatMessageRow({ event }: { event: RoomEvent }) {
  const body = event.body as MessageBody;
  return (
    <article className={`chat-message-row ${event.author.kind}`}>
      <div className="chat-message-meta">
        <strong>{event.author.display}</strong>
        <time>{new Date(event.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time>
      </div>
      {body.text ? <div className="chat-message-body">{body.text}</div> : null}
      {body.attachments?.length ? (
        <div className="chat-message-attachments">
          {body.attachments.map((image) => (
            <figure key={image.id}>
              <img src={image.dataUrl} alt={image.name} />
              <figcaption>{image.name}</figcaption>
            </figure>
          ))}
        </div>
      ) : null}
    </article>
  );
}

function EventRow({ event, compact = false }: { event: RoomEvent; compact?: boolean }) {
  const Icon = iconFor(event.type);
  return (
    <article className={`event-row ${event.author.kind} ${event.type}${compact ? " compact" : ""}`}>
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
    case "phase_changed": return Activity;
    case "bid_submitted": return Hand;
    case "bid_settled": return Check;
    case "speaker_selected": return Radio;
    case "turn_started": return Radio;
    case "turn_output_chunk": return MessageSquare;
    case "turn_completed": return CheckCircle2;
    case "turn_cancelled": return PauseCircle;
    case "turn_failed": return AlertTriangle;
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
    case "phase_changed": {
      const body = event.body as any;
      return `${body.from ?? "?"} -> ${body.to ?? "?"}`;
    }
    case "bid_submitted": {
      const bid = (event.body as any).bid as Bid | undefined;
      return bid ? `${bid.agentId} · ${bid.kind} · confidence ${bid.confidence.toFixed(2)}` : JSON.stringify(event.body);
    }
    case "bid_settled": {
      const body = event.body as any;
      return `${body.bidId ?? "bid"} · ${body.action ?? "settled"}`;
    }
    case "speaker_selected": {
      const body = event.body as any;
      const bid = body.winner?.bid as Bid | undefined;
      return bid ? `${bid.agentId} selected · ${bid.kind} · score ${Number(body.winner?.score ?? 0).toFixed(3)}` : "no speaker selected";
    }
    case "turn_started": {
      const body = event.body as any;
      return `${body.speakerId} started ${body.turnId}`;
    }
    case "turn_output_chunk": {
      const body = event.body as any;
      return body.text ?? JSON.stringify(body);
    }
    case "turn_completed":
    case "turn_cancelled":
    case "turn_failed": {
      const body = event.body as any;
      return `${event.type.replace("turn_", "")}: ${body.turnId ?? ""}`;
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

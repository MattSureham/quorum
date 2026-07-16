# Multi-Agent Group Chat — 实现规格 (SPEC)

> 一个让人类与多个异构编码 agent（Claude Code、Codex、原生 API 模型…）在同一个"群聊 + 共享工程"环境里协作的框架。人类是一等参与者，可随时插话/打断；agent 之间可自由抢麦、互相反驳；每个 agent 保留自己原生的工具调用能力；支持远程（手机/桌面/web）操控。
>
> **本文档面向构建它的线下 agent。** 按里程碑顺序实现，每个里程碑都有验收标准。遇到 CLI flag 不确定时，以 `claude --help` / `codex --help` 和官方文档（文末链接）为准——本文给出的是核实于 2026-06 的基线。

---

## 0. 锁定的设计决策

1. **从零搭建**，TypeScript + Node，pnpm monorepo。不 fork 现有项目。
2. **共享工作区 = 单工作目录 + 单分支 + 写锁（write-floor）**。人类和所有 agent 默认在同一分支。无 worktree（留作后续可选的并行子任务模式）。每回合自动 checkpoint 提交。
3. **Conductor 默认策略 = 自由抢麦（free-for-all + floor control）**，可运行时切换到 **定向 @（directed）** 和 **主持模式（moderated）**。
4. **保留原生工具调用**：每个 agent 以自己的 CLI/SDK 在各自的会话里跑，框架不改其行为，只做"输入投影 / 输出归一化"。
5. **远程**：daemon + 瘦客户端，WebSocket。v1 先做 localhost + 配对密钥；relay/隧道留到 M6。

---

## 1. 并发模型（务必先读）

### 1.1 为什么是单分支 + 写锁，而不是 worktree

- **worktree 并行**：每个 agent 独立目录/分支，过程互不可见，事后 merge。真并行但有合并冲突、彼此看不到对方未提交改动、心智模型偏离"一起干活"。
- **单分支 + 写锁（本项目采用）**：所有人共享一个工作目录、一个分支；任一时刻只有"写令牌"持有者能改文件，按回合交接，改动实时可见。契合群聊心智。

### 1.2 两种"令牌"必须分清

- **Speaking floor（发言权）**：由 Conductor 管。决定下一个谁能往群聊里发消息。抢麦模式下顺序是动态涌现的。
- **Write floor（写令牌）**：由 WorkspaceManager 的互斥锁管。决定谁能改文件。

抢麦模式下**回合仍是串行的**（同一时刻只有一个 agent 在跑它的 turn），所以文件写入被自然串行化，单分支不会乱。Write-floor 额外防：(a) agent 回合进行中人类带外手改文件；(b) 未来并行模式的接缝。

### 1.3 每回合 checkpoint

每个会修改文件的回合：
1. 取得 write-floor。
2. 记录 `preHead = git rev-parse HEAD` + 暂存当前 dirty 状态指纹。
3. agent 跑完它的 turn（在共享目录里调自己的工具改文件）。
4. 回合结束：在**同一分支**上做一个 checkpoint 提交，commit message 形如 `chore(room): turn <seq> by <participant> [<eventId>]`；记录 `postHead`、diff 摘要。
5. 释放 write-floor，发一条 `checkpoint` RoomEvent（含 diff stat）让所有人看到。

> 这些 micro-commit 可后续 `git rebase -i` / squash 合并到正式提交。提供 `compact` 指令把一段连续 checkpoint 压成一个提交。可选：通过 `WORKSPACE_CHECKPOINT_REF` 配置把 checkpoint 写到独立 ref（如 `refs/groupchat/checkpoints`）而非污染分支历史——v1 默认直接提交在工作分支。

### 1.4 带外修改检测

WorkspaceManager 起一个 file watcher（chokidar）。若在没有写令牌的情况下检测到工作区文件变化（即人类手改）：发 `checkpoint`(author=human) 事件并自动提交，把它当作"人类的一个回合"纳入历史，避免 agent 下次回合覆盖未知改动。

---

## 2. 系统总览

```
Clients (web / mobile / desktop / CLI)
        │  WebSocket
        ▼
┌──────────────────── Daemon（跑在工作区所在机器） ───────────────────┐
│  Gateway        WS server · 鉴权/配对 · 事件 fan-out                  │
│                                                                      │
│  Room core      EventLog(唯一真相源) · EventBus(pub/sub)             │
│                 Conductor(发言权: 抢麦/定向/主持) · MentionRouter     │
│                                                                      │
│  Participants   Human  │ ClaudeCodeAdapter │ CodexAdapter │ …(注册表) │
│                 每个 agent = 自己的 CLI/SDK 进程 + 自己的会话         │
│                                                                      │
│  Workspace      单分支 git 工作目录 · write-floor 锁 · checkpoint     │
│  & Tools        每 agent 原生工具(保留) + 共享 room 工具(MCP)         │
└──────────────────────────────────────────────────────────────────┘
```

核心抽象：**群聊有一份 append-only 事件日志作为唯一真相源；每个 agent 拿到的是这份日志的"投影/增量"，注入它自己的会话；它自己的工具调用与产出又归一化成事件写回日志。** 各 agent 的原生上下文不合并。

---

## 3. Monorepo 布局与技术栈

```
groupchat/
  package.json            # pnpm workspaces
  pnpm-workspace.yaml
  tsconfig.base.json
  packages/
    protocol/             # @gc/protocol  零依赖：事件 schema + WS 线协议类型 + zod 校验
    core/                 # @gc/core      房间引擎：EventLog/EventBus/Conductor/TurnLoop（纯逻辑，无 I/O）
    daemon/               # @gc/daemon    进程宿主：Gateway/WorkspaceManager/Persistence/适配器/装配
      src/
        gateway/
        workspace/
        persistence/
        adapters/
          base.ts
          claude-code.ts
          codex.ts
          api-model.ts
          registry.ts
        conductor-policies/   # 三种策略实现（实现 core 暴露的 ConductorPolicy 接口）
    client-web/           # @gc/client-web  React + Vite
    cli/                  # @gc/cli         启动 daemon / 连接（paseo 风格）
```

**栈选型**
- Runtime: Node ≥ 20, TypeScript（strict）。构建 tsup，测试 vitest，lint biome。
- 进程管理：`execa` 启动/管理子进程；`chokidar` 文件监听。
- 传输：`ws`。鉴权 libsodium（`@noble/...` 或 `tweetnacl`）做配对密钥。
- 持久化：`better-sqlite3`（同步、简单、单机够用）。事件日志 append-only 表。
- 客户端：React + Vite + Tailwind；状态用一个简单 store 订阅 WS 事件流。
- Claude 适配器：`@anthropic-ai/claude-agent-sdk`（TS Agent SDK）。
- Codex 适配器：spawn `codex exec --json`（无需 SDK）。

> 依赖版本一律以安装时最新为准；安装后 `claude --help`、`codex exec --help` 复核 flag。

---

## 4. 数据模型

### 4.1 RoomEvent（总线上的统一信封）

```ts
// @gc/protocol
export type ParticipantKind = "human" | "agent" | "system";

export type EventType =
  | "message"        // 一条聊天发言（最终文本）
  | "thinking"       // agent 的推理/思考流（可选展示）
  | "tool_call"      // 一次工具调用（含工具名 + 入参）
  | "tool_result"    // 工具结果（stdout/exit code/文件 diff 引用…）
  | "floor_request"  // “举手”：我想发言/反驳
  | "floor_grant"    // Conductor 授予发言权
  | "floor_release"  // 回合结束，交还发言权
  | "interrupt"      // 打断（通常来自人类，高优先级）
  | "checkpoint"     // 一次工作区快照（git diff stat）
  | "system";        // 系统/错误/状态变更

export interface RoomEvent {
  id: string;                 // ulid
  roomId: string;
  seq: number;                // 房间内单调递增
  ts: number;                 // epoch ms
  author: { kind: ParticipantKind; id: string; display: string };
  type: EventType;
  body: unknown;              // 按 type 区分，见下
  replyTo?: string;           // 线程化 / “反驳谁”（指向被回应的 event id）
  addressedTo?: string[];     // @ 的参与者 id 列表（空=对所有人）
  turnId?: string;            // 归属哪个回合
  visibility: "room" | "private"; // private 仅作者+人类可见（v1 仅 room）
}
```

各 `body` 形状（zod schema 定义在 protocol）：

| type | body |
|---|---|
| message | `{ text: string }` |
| thinking | `{ text: string; partial?: boolean }` |
| tool_call | `{ tool: string; name?: string; args: unknown; callId: string }` |
| tool_result | `{ callId: string; ok: boolean; stdout?: string; exitCode?: number; diffRef?: string }` |
| floor_request | `{ reason: string; intent: "reply" | "rebut" | "act"; targets?: string[] }` |
| floor_grant | `{ participantId: string; turnId: string; deadlineMs?: number }` |
| floor_release | `{ turnId: string; reason: "done" | "interrupted" | "timeout" | "error" }` |
| interrupt | `{ by: string; hard: boolean; note?: string }` |
| checkpoint | `{ preHead: string; postHead: string; stat: { files: number; insertions: number; deletions: number }; summary?: string }` |
| system | `{ level: "info" | "warn" | "error"; text: string }` |

### 4.2 其它实体

```ts
export interface Room {
  id: string;
  title: string;
  workspacePath: string;
  branch: string;                       // 单分支名
  policy: ConductorPolicyConfig;        // 当前发言权策略
  participants: ParticipantDescriptor[];
  createdAt: number;
}

export interface ParticipantDescriptor {
  id: string;                           // 房间内唯一，如 "codex" / "claude" / "matt"
  kind: ParticipantKind;
  display: string;
  adapter?: string;                     // agent 才有，如 "claude-code" | "codex" | "api-model"
  adapterConfig?: Record<string, unknown>; // 模型名、sandbox 等
  persona?: string;                     // 注入到该 agent 的角色/职责说明
  status: "idle" | "thinking" | "active" | "offline";
}

export interface Turn {
  id: string;
  roomId: string;
  participantId: string;
  startedAt: number;
  endedAt?: number;
  fromSeq: number;                      // 该回合开始时房间已有的 seq（用于算投影增量）
  outcome?: "done" | "interrupted" | "timeout" | "error";
}
```

### 4.3 SQLite 表

```sql
CREATE TABLE rooms        (id TEXT PRIMARY KEY, data JSON NOT NULL);
CREATE TABLE events       (id TEXT PRIMARY KEY, room_id TEXT, seq INTEGER, ts INTEGER, data JSON NOT NULL);
CREATE UNIQUE INDEX idx_events_room_seq ON events(room_id, seq);
CREATE TABLE turns        (id TEXT PRIMARY KEY, room_id TEXT, data JSON NOT NULL);
CREATE TABLE agent_sessions (room_id TEXT, participant_id TEXT, native_session_id TEXT,
                             PRIMARY KEY (room_id, participant_id));  -- 各 agent 的原生会话 id（resume 用）
```

事件 append-only：永不 UPDATE/DELETE。`seq` 由 EventLog 串行分配（单 writer），保证全序。

---

## 5. 核心接口

```ts
// @gc/core

// —— 参与者（人类与 agent 共用同一契约；人是一等公民的代码落点）——
export interface Participant {
  readonly descriptor: ParticipantDescriptor;
  capabilities(): Capabilities;
  // 喂入“自上次本参与者发言以来的投影增量”，流式吐回归一化事件
  takeTurn(input: TurnInput): AsyncIterable<PartialRoomEvent>;
  // 软打断当前回合（取消令牌 / 向子进程发 SIGINT）
  interrupt(reason: string): Promise<void>;
  dispose(): Promise<void>;
}

export interface Capabilities {
  canEditFiles: boolean;
  canRunCommands: boolean;
  supportsToolApproval: boolean;   // 是否支持回合内人类逐项批准工具
  nativeTools: string[];           // 仅展示用
}

export interface TurnInput {
  turnId: string;
  roomTitle: string;
  self: ParticipantDescriptor;
  participants: ParticipantDescriptor[];
  projection: RoomEvent[];          // 自上次本人发言以来的增量事件（首回合=开场）
  protocol: string;                 // 房间发言协议文本（见 §6.4）
  workspacePath: string;
}

// —— 发言权策略（可插拔；三种内置）——
export interface ConductorPolicy {
  readonly name: "free-for-all" | "directed" | "moderated";
  // 有新事件进入日志时调用，返回“接下来应授予谁发言权”（可空=等待）
  decide(ctx: ConductorContext): Promise<FloorDecision>;
}

export interface ConductorContext {
  recent: RoomEvent[];              // 最近 N 条
  participants: ParticipantDescriptor[];
  pendingFloorRequests: RoomEvent[]; // 未处理的举手
  lastSpeakerId?: string;
  turnsInCurrentTopic: number;      // 自最近一条 human message 以来的 agent 回合数
  config: ConductorPolicyConfig;
}

export type FloorDecision =
  | { grant: string; reason: string }      // 授予某参与者
  | { wait: true }                          // 无人发言，等待（通常等人类）
  | { askModerator: true };                 // 仅 moderated 用

export interface ConductorPolicyConfig {
  name: ConductorPolicy["name"];
  maxTurnsPerTopic: number;         // 抢麦/主持：一个话题最多多少 agent 回合后强制交还人类（默认 6）
  noConsecutive: boolean;           // 同一 agent 不可连说两次（默认 true）
  turnDeadlineMs: number;           // 单回合超时（默认 180000）
  moderatorModel?: string;          // moderated 用
}

// —— 工作区 ——
export interface WorkspaceManager {
  acquireWriteFloor(turnId: string, who: string): Promise<WriteLease>;
  snapshotPre(): Promise<string>;             // 返回 preHead
  checkpoint(turnId: string, who: string, eventId: string): Promise<CheckpointResult>;
  rollbackTo(head: string): Promise<void>;
  diff(fromHead: string, toHead?: string): Promise<DiffStat>;
  watchOutOfBand(cb: (stat: DiffStat) => void): () => void;
}

// —— 传输 ——
export interface Transport {
  start(): Promise<void>;
  broadcast(e: RoomEvent): void;
  onClientMessage(cb: (msg: ClientMessage, client: ClientConn) => void): void;
}
```

---

## 6. Conductor —— 发言权调度（核心）

Conductor 是个事件驱动的状态机，订阅 EventLog。它**不产生内容**，只决定"下一个谁说"，并据此调用对应 Participant 的 `takeTurn`。

### 6.1 状态

```
IDLE            ── 无人持有发言权，等待事件
GRANTING        ── 已决定授予某人，正在启动其回合
ACTIVE          ── 某参与者回合进行中
COLLECTING      ── 回合结束，收集 floor_request，决定下一个
HUMAN_INTERRUPT ── 收到人类 interrupt/message，抢占
```

### 6.2 主循环（伪码）

```ts
async function run() {
  for await (const e of eventLog.subscribe()) {
    // —— 人类永远最高优先级 ——
    if (e.author.kind === "human" && (e.type === "message" || e.type === "interrupt")) {
      if (state === "ACTIVE" && currentTurn) {
        await participants[currentTurn.participantId].interrupt("human spoke");
        await emitFloorRelease(currentTurn, "interrupted");
      }
      topicTurns = 0;                 // 人类发话 = 新话题，重置预算
      state = "COLLECTING";
    }

    // 回合自然结束
    if (e.type === "floor_release") { state = "COLLECTING"; }

    // 抢手登记
    if (e.type === "floor_request") pendingRequests.push(e);

    if (state === "COLLECTING" || state === "IDLE") {
      const decision = await policy.decide(buildCtx());
      if ("wait" in decision) { state = "IDLE"; continue; }
      if ("askModerator" in decision) { /* 见 6.3.3 */ continue; }
      await grantFloor(decision.grant);   // → 启动该参与者 takeTurn，state=ACTIVE
    }
  }
}

async function grantFloor(pid: string) {
  const turn = newTurn(pid, eventLog.headSeq());
  emit({ type: "floor_grant", body: { participantId: pid, turnId: turn.id,
         deadlineMs: policyCfg.turnDeadlineMs } });
  state = "ACTIVE"; currentTurn = turn; topicTurns++;
  pendingRequests = pendingRequests.filter(r => r.author.id !== pid);

  const input = buildTurnInput(turn);     // 投影增量 + 协议文本（§6.4, §7）
  const part = participants[pid];

  // 若会改文件，先拿写令牌
  let lease: WriteLease | undefined;
  if (part.capabilities().canEditFiles) lease = await workspace.acquireWriteFloor(turn.id, pid);
  const preHead = await workspace.snapshotPre();

  try {
    const deadline = setTimeout(() => part.interrupt("turn deadline"), policyCfg.turnDeadlineMs);
    for await (const partial of part.takeTurn(input)) {
      const ev = finalizeEvent(partial, turn);   // 补 id/seq/turnId
      eventLog.append(ev);                         // 写回日志 → 广播 → 其它 agent 下回合能看到
    }
    clearTimeout(deadline);
    if (lease) { const cp = await workspace.checkpoint(turn.id, pid, /*last msg id*/);
                 eventLog.append(checkpointEvent(cp)); }
    emit({ type: "floor_release", body: { turnId: turn.id, reason: "done" } });
  } catch (err) {
    emit({ type: "floor_release", body: { turnId: turn.id, reason: "error" } });
  } finally {
    lease?.release();
  }
}
```

### 6.3 三种策略的 `decide`

**6.3.1 free-for-all（默认）**

```ts
decide(ctx) {
  // 预算用尽 → 交还人类
  if (ctx.turnsInCurrentTopic >= ctx.config.maxTurnsPerTopic) return { wait: true };

  // 1) 优先处理“举手”，过滤掉刚说过的人（noConsecutive）
  const hands = ctx.pendingFloorRequests
    .filter(r => !(ctx.config.noConsecutive && r.author.id === ctx.lastSpeakerId))
    .sort(byIntentPriority);   // rebut/act > reply
  if (hands.length) return { grant: hands[0].author.id, reason: "raised hand" };

  // 2) 看最近一条 message 是否 @ 了某 agent 且其还没回应
  const last = lastMessage(ctx.recent);
  const tgt = last?.addressedTo?.find(id => isAgent(id, ctx) && id !== ctx.lastSpeakerId);
  if (tgt) return { grant: tgt, reason: "addressed" };

  // 3) 否则不主动开口（等人类）——避免无意义自动循环
  return { wait: true };
}
```

> "抢麦"的关键：agent 在它的回合里**不仅产出 message，还可以在回合末尾产出 `floor_request`** 来表达"我想继续/我想反驳 X"。这通过给每个 agent 注入的 room 工具 `raise_hand`（§9）实现。这样辩论是 agent 自驱的，但被 `noConsecutive` + `maxTurnsPerTopic` 约束，且人类一插话即重置。

**6.3.2 directed**

```ts
decide(ctx) {
  const last = lastMessage(ctx.recent);
  const tgts = (last?.addressedTo ?? []).filter(id => isAgent(id, ctx));
  // 只让被显式 @ 的 agent 依次回应；无 @ 则等待
  const next = tgts.find(id => !respondedSince(id, last!, ctx));
  return next ? { grant: next, reason: "directed @" } : { wait: true };
}
```

**6.3.3 moderated**

每条新 message 后，调用一个便宜模型（`moderatorModel`）当主持，输入最近若干条 + 参与者名单，要求返回 JSON `{ next: "<id>" | "human", reason }`。Conductor 据此授予或等待。主持 prompt 要求："若讨论收敛或需要人类决策，返回 `human`"。用 `--output-schema`/结构化输出强约束 JSON。

### 6.4 注入给每个 agent 的"房间协议"文本（`protocol`）

每回合随投影一起注入（措辞可调）：

```
You are "{self.id}" in a multi-party room "{roomTitle}".
Participants: {list with kinds}.
Rules:
- This is NOT a blocking prompt. There is nobody to answer follow-up questions mid-turn.
  Either act, or state your assumptions and proceed. Never end with "let me know if...".
- To address or rebut someone, begin your message with @their-id.
- If you want to continue or rebut after others respond, call the room tool `raise_hand`
  with a one-line reason. Do not monologue across many turns.
- Keep file edits minimal and explain them. Other participants and the human see your edits.
- End your turn when you've made your point or completed the step.
```

---

## 7. WorkspaceManager（单分支 + 写锁 + checkpoint）

### 7.1 初始化
- 若 `workspacePath` 不是 git 仓库：`git init` + 初始空提交（Codex 要求 git 仓库）。
- 切到/创建配置的 `branch`。整个房间生命周期都在这一个分支。

### 7.2 写锁
进程内一个 async mutex（如 `async-mutex`）。`acquireWriteFloor` 返回 `WriteLease`，`release()` 释放。由于回合本就串行，正常路径无竞争；锁主要兜底"带外人类修改"与未来并行模式。

### 7.3 投影里附带工作区状态
`buildTurnInput` 时附上 `git status --porcelain` 摘要与"上一回合 diff stat"，让 agent 知道当前文件态（它自己的会话不一定记得别的 agent 改了什么）。

### 7.4 Checkpoint（关键 git 序列）

```bash
# 回合开始前
preHead=$(git -C "$WS" rev-parse HEAD)

# 回合结束后（agent 已改完文件）
git -C "$WS" add -A
if ! git -C "$WS" diff --cached --quiet; then
  git -C "$WS" commit -q -m "chore(room): turn ${seq} by ${who} [${eventId}]"
fi
postHead=$(git -C "$WS" rev-parse HEAD)
stat=$(git -C "$WS" diff --shortstat "$preHead" "$postHead")   # files/insertions/deletions
```

`rollbackTo(head)`：`git reset --hard <head>`（破坏性，仅在用户显式要求回滚某回合时用），并发 `system` 事件说明。

### 7.5 带外修改 watcher
`chokidar.watch(WS, { ignored: /\.git/ })`。无写令牌期间若触发：
```bash
git -C "$WS" add -A && git -C "$WS" commit -q -m "chore(room): human edit [out-of-band]"
```
发 `checkpoint`(author=human) 事件。

---

## 8. 适配器（保留原生工具调用）

所有适配器实现 `Participant`。共同职责：把 `TurnInput.projection` 格式化成该 agent 的输入；驱动其原生 agentic loop（它调自己的工具）；把它的事件流归一化成 `PartialRoomEvent`；维护其原生会话 id 以便下回合 resume；`interrupt()` 取消。

### 8.1 投影格式化（两端通用）
把 `protocol` 文本 + 工作区状态摘要 + 增量事件渲染成一段 prompt：

```
{protocol}

--- workspace ---
branch {branch} · {git status summary}
last turn diff: {stat}

--- transcript since your last turn (turn {fromSeq}+) ---
[t{seq} {author}→{addressedTo|all}] {text}
[t{seq} {author} edited src/x.ts (+a -b)]
...
--- end ---

Your turn.
```
只发**增量**（自本 agent 上次发言以来）；该 agent 的原生会话已持有更早的上下文。首回合发开场消息。

### 8.2 ClaudeCodeAdapter（用 TS Agent SDK）

包：`@anthropic-ai/claude-agent-sdk`。用持久多轮 client 保留会话；`canUseTool` 回调做人类工具批准；`createSdkMcpServer` 暴露 room 工具（§9）。系统提示用 preset append 保留 Claude Code 内建行为：

```ts
import { ClaudeSDKClient } from "@anthropic-ai/claude-agent-sdk"; // 名称以包文档为准

const client = new ClaudeSDKClient({
  cwd: workspacePath,
  systemPrompt: { type: "preset", preset: "claude_code", append: persona },
  permissionMode: "acceptEdits",          // 受信房间；或用 canUseTool 逐项批准
  mcpServers: { room: roomMcpServer },     // 注入 room 工具
  canUseTool: async (tool, input) => {     // supportsToolApproval=true 时
    if (needsHumanApproval(tool)) return await requestApprovalViaRoom(tool, input);
    return { behavior: "allow" };
  },
});

async function* takeTurn(input) {
  for await (const msg of client.query(renderProjection(input))) {
    yield* normalizeClaude(msg);           // 见 §8.4 映射表
  }
}
```

**CLI 回退方案**（不想用 SDK 时）：长驻进程
`claude --input-format stream-json --output-format stream-json --verbose --append-system-prompt "<persona>" --permission-mode acceptEdits`，逐回合往 stdin 写一个 user message（stream-json 协议），从 stdout 逐行读 JSON。**不要加 `--bare`**（它会跳过 MCP/skills 自动发现，破坏原生工具）。会话延续：从 `result`/`system` 事件取 `session_id`，下次 `--resume <session_id>`。

### 8.3 CodexAdapter（spawn `codex exec --json`）

无需 SDK。首回合：
```bash
codex exec --json --sandbox workspace-write --cd "$WS" --skip-git-repo-check "<rendered projection>"
```
- `--json`：stdout 输出 JSONL 事件流（逐行解析）。
- `--sandbox workspace-write`：允许改文件（read-only 是默认，会让它不能写）。需要联网命令才用 `danger-full-access`，且仅限隔离环境。
- 从 `thread.started` 事件取 `thread_id` 存入 `agent_sessions`（注意历史上 `--json` 不在末尾单独打 session id，以 `thread.started.thread_id` 为准；兜底读 `~/.codex/sessions/`）。

后续回合 resume（保留它的原生上下文）：
```bash
codex exec resume <thread_id> --json --sandbox workspace-write --cd "$WS" "<delta projection>"
```
- 持久化进度：用 `-o <file>` 拿最终消息；或直接从 JSONL 的 `assistant_message` 取。
- 角色注入：Codex 用工作区的 `AGENTS.md`（相当于 Claude 的 CLAUDE.md）放角色/项目规则；动态 persona 也可前置进 projection。
- room 工具：`codex mcp add room <daemon 暴露的 stdio MCP server 命令>`（§9）。
- `interrupt()`：向该 `codex exec` 子进程发 `SIGINT`（Ctrl+C 取消当前 turn 的等价）。

### 8.4 事件归一化映射

**Claude（Agent SDK / stream-json）→ RoomEvent**

| Claude 消息 | RoomEvent |
|---|---|
| assistant text（流式） | `thinking{partial:true}`（中间）→ 收尾合成 `message` |
| assistant tool_use | `tool_call{tool, args, callId}` |
| tool_result / user(tool) | `tool_result{callId, ok, stdout, ...}` |
| 文件编辑类工具 | `tool_call`（name=Edit/Write）+ 完成后由 checkpoint 给 diffRef |
| result（终态，含 total_cost_usd, session_id） | 触发回合结束；记录 cost；存 session_id |

**Codex（`--json` JSONL）→ RoomEvent**

| Codex 事件 | RoomEvent |
|---|---|
| `thread.started{thread_id}` | 存 native session id（不进聊天） |
| `turn.started` | 回合已 active（内部状态） |
| `item.*` item_type=`reasoning` | `thinking` |
| item_type=`command_execution`（command/aggregated_output/exit_code） | `tool_call` + `tool_result` |
| item_type=文件变更 | `tool_call`(name=edit) |
| item_type=`mcp_tool_call` | `tool_call`(tool=mcp:<name>) |
| item_type=`assistant_message`{text} | `message` |
| `turn.completed` / `turn.failed` | 回合结束（done/error） |
| `error` | `system{level:"error"}` |

> 解析注意：JSONL 一行一对象；流可能被分块，按 `\n` 切并缓冲半行。两端的 turn 结束事件用来触发 `floor_release`。

### 8.5 APIModelAdapter
直接调模型 API（Anthropic/OpenAI 等）做"无文件能力的纯发言者/评审者"（`canEditFiles:false`）。把 projection 当 messages 发，流式回 `message`。用于轻量第二意见、主持模型等。

### 8.6 注册表（扩展点）
```ts
// adapters/registry.ts
const registry = new Map<string, AdapterFactory>();
export function registerAdapter(name: string, f: AdapterFactory) { registry.set(name, f); }
export function createParticipant(d: ParticipantDescriptor): Participant { /* by d.adapter */ }
```
加新 agent = 实现 `Participant` + `registerAdapter(...)`，房间配置里引用 `adapter` 名即可。

---

## 9. 共享 room 工具（MCP）

daemon 内置一个小型 **stdio MCP server**（`@modelcontextprotocol/sdk`），把房间能力作为工具暴露给每个 agent；agent 调用这些工具的动作再归一化进日志。这样 agent 能"主动参与协调"而不只是被调度。

工具集（v1）：
- `raise_hand(reason, intent)` — 产生 `floor_request`，实现抢麦/反驳的自驱。
- `read_room(sinceSeq?)` — 读取它视野外的近期事件（按需补全）。
- `request_review(target?, note)` — 请某 agent/人类评审当前改动。
- `hand_off(to, note)` — 把当前任务交给另一 agent（产生定向 message + 建议 Conductor 下个授予 `to`）。
- `post_note(text)` — 显式往群聊发一条（通常其最终 message 已自动入流，这是补充用）。

接入：
- Claude：`createSdkMcpServer` 注册为 `mcpServers.room`。
- Codex：daemon 暴露同一 MCP server 的 stdio 启动命令，房间初始化时 `codex mcp add room <cmd>`（或写进项目 `.codex/config.toml`）。

> 工具的入参里隐含 `participantId` 与 `turnId`（由 daemon 在 MCP 会话上下文注入），避免 agent 伪造身份。

---

## 10. 传输 / Gateway

### 10.1 WS 线协议

**Client → Server（`ClientMessage`）**
```ts
type MessageAttachment = {
  id: string;
  name: string;
  mimeType: "image/png" | "image/jpeg" | "image/gif" | "image/webp"
    | "application/pdf"
    | "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  dataUrl: string;
  sizeBytes?: number;
};

type ClientMessage =
  | { t: "subscribe"; roomId: string; sinceSeq?: number }   // 订阅 + 可选回放
  | { t: "post_message"; roomId: string; text: string; addressedTo?: string[]; attachments?: MessageAttachment[] }
  | { t: "interrupt"; roomId: string; hard?: boolean }       // 人类打断
  | { t: "set_policy"; roomId: string; policy: ConductorPolicyConfig } // 切换 抢麦/定向/主持
  | { t: "approve_tool"; roomId: string; callId: string; allow: boolean } // 工具批准
  | { t: "take_write_floor"; roomId: string }                // 人类要直接改文件
  | { t: "rollback"; roomId: string; toHead: string }
  | { t: "add_participant"; roomId: string; descriptor: ParticipantDescriptor }
  | { t: "remove_participant"; roomId: string; participantId: string };
```

附件只在 localhost gateway 内处理：位图可传给具有视觉能力的 API model；PDF/DOCX
由 sidecar 在本机提取有界纯文本并作为非可信参考内容注入当前 topic。event log 保留
原文件与提取结果，但后续历史 Context Bundle 只携带附件元数据，不重复 data URL 或全文。
扫描 PDF 暂不做 OCR。网络边界最多 6 个附件，图片每个 5 MB、文档每个 10 MB、
解码后总计 20 MB；单文档最多注入 120,000 字符，单 prompt 文档总计 160,000 字符。
DOCX 不信任 central-directory 声明的展开大小：sidecar 必须实际流式读取并累计每个
entry，对主 `word/document.xml` 另设 8 MB 实际展开上限。超时必须主动关闭 ZIP/stream，
不允许仅用 `Promise.race` 返回后让解压继续在后台执行。

**Server → Client**
```ts
type ServerMessage =
  | { t: "event"; event: RoomEvent }            // 实时事件流（核心）
  | { t: "snapshot"; room: Room; events: RoomEvent[] } // 订阅时的初始全量/增量
  | { t: "state"; participantId: string; status: ParticipantDescriptor["status"] }
  | { t: "error"; text: string };
```

所有客户端只是：渲染事件流 + 发上面这些消息。回放靠 `sinceSeq`（断线重连、新设备加入即恢复现场）。

### 10.2 鉴权（v1）
- daemon 默认 `bind 127.0.0.1`。
- 配对：daemon 生成密钥对，打印配对串/二维码（含公钥）；客户端用它建立会话。v1 可先用一个本地 token 简化；M6 再上 relay/隧道 + 端到端加密。
- **凭据边界（当前实现）**：Claude Code/Codex 继续使用各自 CLI 的本地登录，不由 Quorum 存储凭据。用户通过 Web UI 配置的 API-model provider key 会由 daemon 持久化到当前实例的本地 SQLite `provider_configs` 表，并仅向客户端返回掩码预览。当前没有接入 Windows Credential Manager、macOS Keychain，也没有数据库字段加密；机密性仅依赖操作系统账户隔离和数据库文件权限。portable artifact 不包含开发者凭据，凭据也不会跨机器或跨 SQLite 路径自动迁移。正式处理高价值生产凭据前，应迁移到系统凭据库或采用受系统密钥保护的加密存储。

---

## 11. 端到端一回合走查（抢麦 + 一次反驳 + 人类打断）

1. 人类发 `post_message{text:"用 JWT 还是 session？", addressedTo:[]}` → 入日志（seq 100）。Conductor：human 发话 → 重置 topicTurns，进入 COLLECTING。
2. `policy.decide`：无举手、最后消息未 @ 人 → free-for-all 第 2 步无目标 → 返回 wait？不——开场无 @ 时应让相关 agent 发言。实现上：首条无 @ 的 human message 视为"向所有 agent 开放"，授予一个默认 agent（如配置的 `primary`），或让多个 agent 各 `raise_hand`。**实现选择**：开场 human message 给 `primary` agent（房间配置）授予首发。授予 `claude`。
3. `claude` 回合：流式 `thinking…` → `message{"@all 倾向 JWT，因为无状态…"}`，回合末调用 `raise_hand` 否（它说完了）。`floor_release(done)`。无文件改动则无 checkpoint。
4. COLLECTING：`codex` 在读到 claude 的 message 后（它下个回合的投影会带上）……但它此刻还没回合。机制：Conductor 在 COLLECTING 时，对"未就最近 message 发言、且非 lastSpeaker"的 agent，给一次发言机会（或等它们 raise_hand）。**实现选择**：COLLECTING 时若 `pendingFloorRequests` 空，按"轮到尚未对该话题发言的 agent"授予一个（受 noConsecutive 限制），实现自然轮转；否则 wait。授予 `codex`。
5. `codex` 回合：`message{"@claude 不同意——本项目有强制登出需求，session 更合适"}` + `raise_hand(intent:"rebut")` 表示愿继续。`floor_release(done)`。
6. COLLECTING：有 `codex` 的举手，但 `noConsecutive` 不让它连说；`claude` 未连说且被 @，授予 `claude` 反驳。topicTurns=3。
7. `claude` 回合刚开始流式输出时——**人类发 `interrupt` + `post_message{"先按 session 做，给我加上刷新令牌"}`**。Conductor：HUMAN_INTERRUPT → `claude.interrupt()`（SDK 取消 / SIGINT），`floor_release(interrupted)`，topicTurns 重置。
8. 新话题：human message @ 无指定 → 授予 primary（claude）。`claude` 回合：取 write-floor → 编辑 `auth.ts`（`tool_call`/`tool_result` 入流）→ 回合末 `checkpoint`(files:2,+40,-7) 入流，所有客户端看到 diff。`floor_release(done)`。

---

## 12. 里程碑与验收

| M | 范围 | 验收标准 |
|---|---|---|
| M0 | monorepo 骨架、protocol 类型 + zod、SQLite 持久化、EventLog（append + 全序 seq）+ EventBus | 单测：并发 append 后 seq 连续无重复；订阅能收到全部事件；回放 `sinceSeq` 正确 |
| M1 | 单 agent + 人类在房间里（先接 Codex 或 Claude 之一）+ Gateway WS + 一个最小 CLI 客户端 | 人类发消息 → agent 回合流式入流 → CLI 实时看到 thinking/message；agent 原生工具能跑（如读文件） |
| M2 | Conductor free-for-all + 第二个 agent + raise_hand（room MCP）+ 人类打断 | 两 agent 能就一个问题来回 ≤maxTurnsPerTopic 轮后自动停；同一 agent 不连说；人类一发消息立即打断在跑的回合并重置话题 |
| M3 | WorkspaceManager：单分支 git、write-floor、每回合 checkpoint、带外修改检测、diff/rollback | agent 改文件后产生 checkpoint 事件含正确 diff stat；人类手改文件被捕获为 human checkpoint；rollback 能回到指定回合 |
| M4 | directed + moderated 策略 + 运行时 `set_policy` 切换 | 三种策略可热切换；directed 下仅被 @ 的 agent 回应；moderated 下主持模型决定下个发言者并能交还人类 |
| M5 | React web 客户端：群聊流、折叠的 tool 活动、diff 视图、策略切换、@ 选择、工具批准、回滚 | 完整可视化操作；多客户端同时连接看到一致流；断线重连恢复 |
| M6 | 远程：relay（daemon 外连 + E2E）/ 直连 / 自建隧道；配对二维码；多 provider（再接 OpenCode/api-model） | 手机端连上远程 daemon 全功能操控；新 adapter 仅靠注册接入 |

---

## 13. 行为验收测试（写成自动化/半自动用例）

1. **人类可插话**：agent 回合进行中 1s 内发 human message → 该回合在 ~Xs 内收到 `floor_release(interrupted)`，且后续授予按新话题走。（直接对应你之前"无法参与"的痛点）
2. **不连说**：free-for-all 下，连续两条 agent message 的 author 不相同（除非只有一个 agent）。
3. **辩论有界**：构造一个 agent 反复 raise_hand 的场景 → agent 回合数在一个话题内不超过 `maxTurnsPerTopic`，之后 `decide` 返回 wait（交还人类）。
4. **原生工具保留**：Claude 回合能调用其内建工具（Bash/Edit）并把结果归一化入流；Codex 回合能执行 command_execution 并带 exit_code。
5. **单分支一致性**：两 agent 各改一次文件后，`git log` 在同一分支上有两条 checkpoint 提交，工作区无冲突标记。
6. **会话延续**：同一 agent 第二回合能引用第一回合它自己产生的内容（证明 resume/会话保持生效）。
7. **回放一致**：客户端 A 全程在线、客户端 B 中途 `subscribe{sinceSeq:0}`，两者最终事件序列一致。

---

## 14. 风险与实现注意

- **Codex `--json` 的 session id**：以 `thread.started.thread_id` 为准；若版本有差异，兜底从 `~/.codex/sessions/<date>/rollout-*.jsonl` 取最近一个，但多 agent 高频并发时不可靠——优先用 thread_id。
- **工具批准的非对称**：Claude（SDK `canUseTool` / `--permission-prompt-tool`）支持回合内逐项人类批准；Codex `exec` 是非交互的，批准只能靠预设 `--sandbox`/approval policy。UI 上对不支持逐项批准的 agent 显式标注。所以 `Capabilities.supportsToolApproval` 要如实反映。
- **背景进程**：Claude `-p`/headless 在返回后约 5s 杀掉它起的背景 bash（dev server 等）。需要常驻服务的任务不要交给单回合 headless。
- **成本护栏**：每回合记录 cost（Claude `result.total_cost_usd`）；设每会话/每日预算上限，超限暂停授予并发 `system` 警告。SDK/CLI 都可设 `--max-turns` 兜底防失控。
- **超长上下文**：长会话 agent 会触发自身压缩；投影只发增量已大幅缓解。必要时在话题切换处提示 agent compact。
- **绝不无界自动循环**：`maxTurnsPerTopic` + 人类抢占是硬约束，任何策略都必须经过 Conductor，不允许 agent 直接互相触发回合。
- **身份不可伪造**：agent 产生的事件 author 一律由 daemon 按"当前回合持有者"盖戳，忽略 agent 自称的身份；room 工具入参里的 participantId 同样由 daemon 注入。

---

## 15. 参考（核实于 2026-06，构建时以官方为准）

- Claude Code headless / Agent SDK：https://code.claude.com/docs/en/headless ，https://docs.claude.com/en/docs/claude-code/overview ，npm `@anthropic-ai/claude-code` / Agent SDK
- Codex 非交互 `exec` / `--json` / resume：https://developers.openai.com/codex/noninteractive ，https://developers.openai.com/codex/cli/reference
- MCP SDK：`@modelcontextprotocol/sdk`
- 形态参考（client/daemon/relay 安全模型）：getpaseo/paseo 的 README / SECURITY.md

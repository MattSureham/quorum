# 交接文档（HANDOFF）

给接手 **Quorum** 的下一个 agent 的工作交接。截至 **2026-07-14**，以 `main` 当前 HEAD 为准。English version: [`HANDOFF.md`](./HANDOFF.md)。

## 2026-07-14 独立验收状态

- 安全与可靠性复核后的阻断项已继续修复：内置 adapter 配置采用严格的按类型 schema；CLI health check 与 adapter 共用 Windows shell 参数校验；Codex resume 参数层级已纠正；等待共享 workspace 写锁的排队时间不再计入 agent 执行超时。
- 前端发送改为读取当前 WebSocket `readyState` 与 refs，旧 room 不再在 render 时覆盖 active-room ref；审批超时/中断会写入终态；已有未提交改动的 workspace 会拒绝初始化。
- 本地 `pnpm typecheck` 与 `pnpm test` 通过，当前为 `98/98`。仍需重新跑完整 Web/smoke/desktop 验证与 Windows workflow，并在真实 Windows 上做 `.cmd` 注入、session 切换和 portable 人工验收。
- `local-sandbox-executor` 仍不是真正的 OS 沙箱，不能宣称可隔离用户目录、网络或其他解释器。这仍是强沙箱发布声明的阻断项。
- 最新三次旧 Windows workflow 仍因共享 workspace 测试超时而失败；其根因修复后尚未获得新的绿色 Windows run。详细清单与 run 链接见英文版顶部。

> 2026-07-07 架构更新：Quorum 正在迁移到 agent-framework 会议确定的共享 Session 架构。新的实施交接文档见 [`AGENT_FRAMEWORK_HANDOFF.md`](./AGENT_FRAMEWORK_HANDOFF.md)，完整复制材料在 [`docs/architecture/`](./docs/architecture/)。

## 2026-07-07 最新迁移状态

已完成：
- 共享 Session 协议、`SessionManager`、`CommandMailbox`、`Arbiter`、`LegacyAgentAdapter` 已接入。
- CLI 可用 `QUORUM_SESSION_KERNEL=shared` 切到新 kernel。
- Web UI 已能显示共享 Session 的 phase、当前发言者、bid 队列、选中发言者和 debug timeline。
- `packages/daemon/src/sidecar.ts` 可启动随机本地端口，输出 `{ port, token, bootId }`，WebSocket 需要 token。
- `pnpm sidecar:bun:build` 可把 sidecar 编译成 `dist-sidecar/bun/quorum-sidecar`。
- `pnpm sidecar:bun:smoke` 已验证 Bun 单文件 sidecar、SQLite、token WebSocket 和 echo 回合。
- `apps/desktop` 已新增 Tauri 2 桌面壳；Rust 层启动 Bun sidecar，读取 handshake，并通过 `get_sidecar_connection()` 把认证后的 WebSocket URL 交给 React。
- Web UI 在 Tauri 环境启动时会自动连接 sidecar URL，不需要手填端口。
- `pnpm packaging:env` 会把 Bun/Rust/Cargo 安装在项目本地 `.tools/`，不改全局 shell 配置。
- SQLite 现在会初始化共享 Session 需要的 sessions、turns、bids、snapshots、memory、agent/provider configs 和 schema_migrations 表，同时保留 append-only event log 作为唯一真相来源。
- `projectSessionState()` 已能从 replayed events 重建当前共享 Session 投影。
- 测试已覆盖 SQLite 派生表、旧 events 单表迁移、replay projection、三个 agent 通过 queued bids 进行开放讨论。
- shared-session 的 `AgentRuntime.callTool()` 已接入人工审批闭环：会发出 requested/granted/denied approval signal，并通过 WebSocket `approve_tool` 返回结果。审批通过后已支持安全 room tools（`read_room`、`post_note`、`request_review`、`hand_off`、`raise_hand`），并记录 `tool_call` / `tool_result` 事件；审批通过的 `Bash` 等外部命令工具现在会进入 daemon 提供的本地沙箱执行器，带 workspace cwd 限制、超时、输出截断、工具白名单和危险命令拦截。
- WebSocket 已提供 `replay_projection`，可从指定 `afterSeq` 重建 shared-session 投影；Web UI 已有 Replay 面板用于检查 phase/speaker/bid 状态。
- 已实现 deterministic working-memory summary，可通过 `SessionManager.compactWorkingMemory()` 写入 `SqliteStore`，可通过 WebSocket `compact_memory` 触发，可在 Web UI Memory 面板查看，并会在 turn 结束后达到配置阈值时自动压缩。

还没完成：
- 发布级“一键安装”还没完成：没有签名/公证、没有 Windows installer 验证、没有 updater。
- `pnpm desktop:build` 已能生成未签名的 macOS arm64 `.app` 和 `.dmg`；`.app` 内包含 `Contents/Resources/sidecars/quorum-sidecar`。
- 更完整的记忆策略调参 UI、adapter 原生工具桥接、完整 timeline replay UI、跨平台桌面验证仍是后续任务。

当前建议验证命令：

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm smoke:shared
pnpm smoke:sidecar
pnpm sidecar:bun:smoke
pnpm desktop:check
pnpm desktop:build
```

## 一句话概览（TL;DR）
Quorum 是一个 TypeScript/pnpm 的 monorepo：一个人类 + 多个异构的编码 agent（Claude Code、Codex、纯 API 模型）在**同一个共享群聊、同一条 git 分支**上协作。一个 **Conductor（指挥）**决定谁拿到发言权（floor）；一条只追加（append-only）的 **EventLog（事件日志）**是唯一真相来源；所有人编辑**同一个共享工作目录**，由一把写入锁（write-floor lock）串行化，并在每个回合（turn）做一次 checkpoint 提交。里程碑 **M0–M4 已就位，M5（web 客户端）已接通**；**M6（远程访问）尚未开始**。完整设计见 `SPEC.md`，项目介绍见 `README.md`。

## 如何运行
需要 Node ≥ 20、pnpm。
```bash
pnpm install
pnpm dev      # 一条命令：daemon（ws://127.0.0.1:8787）+ web 客户端（http://127.0.0.1:5173）
              # Ctrl-C 同时停掉两者。用 QUORUM_PORT=8799 pnpm dev 覆盖 daemon 端口
```
然后在浏览器打开 **http://127.0.0.1:5173**（不是 8787——那是 WebSocket 端口；用浏览器访问它会显示 “Upgrade Required”，这是正常的）。

其它脚本：`pnpm demo`（零依赖的双 agent echo 演示）、`pnpm test`、`pnpm typecheck`（tsc -b）、`pnpm smoke`（M0 EventLog 自检）、`pnpm desktop:check`（Tauri/Rust 桌面壳静态验证）。

**坑：** 只有一个进程能占用 8787 端口。如果已经有一个独立 daemon 在跑，你会得到 `EADDRINUSE`——先把它停掉（用 `lsof -nP -i :8787` 找到它）。

## 仓库结构
```
apps/
  desktop/    Tauri 2 桌面壳
packages/
  protocol/   零依赖的类型 + zod 线缆 schema（契约层）
  core/       EventLog、Conductor、三种 floor 策略、projection、room-tools —— 零依赖、已测试
  daemon/     adapters（claude-code/codex/api-model/echo）、GitWorkspace、SqliteStore、WS 网关、moderator、room-host 接线
  cli/        最小启动器：定义房间并调用 startRoom()
  client-web/ React/Vite 客户端（通过 WS 连 daemon）
scripts/      dev.ts（pnpm dev 启动器）· demo.ts · smoke.ts
SPEC.md       完整设计（中文）：数据模型、Conductor 状态机、adapter 契约、WS 协议 §10、里程碑 §12
```

## 心智模型（动手改之前先读）
- **EventLog**（`core/src/event-log.ts`）—— 只追加、单调递增的 `seq`，唯一真相来源。`append/on/replay/headSeq`。
- **Conductor**（`core/src/conductor.ts`）—— 状态机（`idle/active/collecting`），负责授予发言权并驱动回合。它会**把每个事件的 author 盖章为当前持有 floor 的人**（防伪/防冒名）。人类的消息/打断总是抢占（preempt）正在进行的回合。
- **Floor 策略**（`core/src/policies/`）：`free-for-all`（agent 自己举手）、`directed`（只有被 @ 点到的 agent）、`moderated`（由一个模型点名下一个发言者）。运行时可通过网关的 `set_policy` 切换。
- **GitWorkspace**（`daemon/src/workspace/git-workspace.ts`）—— 单分支、写入互斥锁（返回一个 `WriteLease`）、每回合 checkpoint 提交，外加一个**带外（out-of-band）监视器：当没有任何回合持有 floor 时，只要文件发生变化，它就 `git add -A` + 提交**。⚠️ 正因如此，**daemon 在跑的时候别在工作树里留下未提交的垃圾**——它可能被当成“人类 checkpoint”自动提交进去。
- **Adapters**（`daemon/src/adapters/`）—— 每个 agent 都保留自己**原生的工具调用（tool-calling）**；框架只把 transcript 的增量投影（project）进去，再把原生事件归一化（normalize）回日志上。重型 SDK（`@anthropic-ai/claude-agent-sdk`、`zod`）是**懒加载/动态导入**的，所以即便它们缺席，daemon 也能加载起来。
- **房间 MCP 工具**（`core/src/room-tools.ts`，SPEC §9）：`raise_hand`、`read_room`、`request_review`、`hand_off`、`post_note` —— 会被翻译成房间事件。已接入 Claude（进程内 MCP server）和 Codex 两个 adapter。
- **WS 网关**（`daemon/src/gateway/ws-server.ts`，SPEC §10）：客户端→服务端 `subscribe/post_message/interrupt/set_policy/approve_tool/take_write_floor/rollback`；服务端→客户端 `snapshot/event/error`。绑定在 127.0.0.1:8787。

## 常见改动改哪里
- **房间（agents、策略、workspace）**：默认读 `quorum.config.json`；也可用 `QUORUM_CONFIG=<path>` 指向其它配置。找不到配置时 `packages/cli/src/index.ts` 会使用内置默认值。
- **加一个 agent**：往 `participants[]` 里加一个 `ParticipantDescriptor`，带上 `adapter` + `adapterConfig`。`claude-code` 需要 Agent SDK + Claude Code 鉴权；`codex` 需要 PATH 上有 `codex` CLI；`api-model` 是任意 OpenAI 兼容端点；`echo` 是内置的假实现。
- **Moderator 模型**：`packages/daemon/src/moderator.ts`。通过 `policy.moderatorModel` / `QUORUM_MODERATOR_MODEL`（默认 `gpt-4o-mini`）/ `QUORUM_MODERATOR_BASE_URL` 配置，key 取自 `OPENAI_API_KEY`。任何失败都会降级为“让位给人类”。

## 里程碑状态（SPEC §12）
- **M0** 骨架、protocol+zod、SQLite、EventLog —— 完成。
- **M1** 单 agent + 人类 + WS 网关 + 最小客户端 —— 完成。
- **M2** Conductor free-for-all + 第二个 agent + `raise_hand` + 人类打断 —— 完成。
- **M3** GitWorkspace 写入锁 + 每回合 checkpoint + 带外检测 + diff/rollback（网关 `rollback`/`approve_tool`/`take_write_floor`）—— 完成。
- **M4** `directed` + `moderated` 策略 + 运行时 `set_policy`；模型驱动的 moderator —— 完成。
- **M5** React web 客户端 —— **已就位、能连上**；最近的提交（`2cc772e`/`28fccf9`/`384c311`）接通了工具审批（approve）/ 回滚（rollback）/ 抢写入权（take-write-floor）/ 重连（reconnect）这些交互（在宣布完成前，请对照 SPEC §12 端到端验证它们，外加 inline diff 视图 + 多客户端一致性）。
- **M6** 远程（relay/E2E/配对二维码、更多 provider）—— **尚未开始**。

## 建议的下一步
1. 对生成的 `.app` 做启动 smoke，确认真实桌面窗口能拿到 sidecar handshake 并连上 WebSocket。
2. 完成 Windows installer、签名、公证、updater。
3. 扩展共享 Session UI：仲裁得分、settling window、事件 JSON 展开、replay controls、memory inspector。
4. 决定什么时候把默认 kernel 从 legacy conductor 切到 shared-session。

## 约定 / 注意事项
- `@quorum/core` 保持**零依赖**；任何需要网络/环境变量/SDK 的东西都放进 `@quorum/daemon`。
- 先验证再下结论：当前迁移分支上 `pnpm typecheck`、`pnpm test`、`pnpm sidecar:bun:smoke`、`pnpm desktop:check`、`pnpm desktop:build` 通过。
- 调试产物（仓库根目录的 `*.png`、`.playwright-mcp/`）已被 gitignore —— 别把它们提交进去。
- **Git worktree：** `main` 检出在 `/Users/matthew/Projects/quorum`；还有第二个 worktree（`test-framework-debug`）。一条分支同一时间只能在一个 worktree 里被检出，所以别在第二个 worktree 里 `git checkout main`。

## 近期历史
```
384c311 feat: auto-scroll transcript + run Claude with bypassPermissions
28fccf9 fix: clear stale "Connection failed" banner once the socket connects
2cc772e feat: wire M5 web interactions (approve/rollback/write-floor + reconnect)
d5ac91c docs: add HANDOFF.md for agents picking up the project
e8172c1 feat: add `pnpm dev` to launch daemon + web client together
56b75bd chore: ignore browser/playwright debug artifacts
824830e feat: wire model-backed moderator for the moderated policy (M4)
1ca2b6c feat: wire gateway rollback / take_write_floor / approve_tool (M3)
c92f387 feat: add React web client (M5)
3db9ed9 feat: add §9 room MCP tools and wire Claude/Codex adapters
```

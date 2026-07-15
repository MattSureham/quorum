# 交接文档（HANDOFF）

给接手 **Quorum** 的下一个 agent 的工作交接。截至 **2026-07-15**，以 `main` 当前 HEAD 为准。English version: [`HANDOFF.md`](./HANDOFF.md)。

## 2026-07-15 无回复与断线可靠性跟进

- 已从 `.quorum/webui-smoke.sqlite` 还原用户截图中的 `session-mrlhfbcu`：Claude Code、Codex、DeepSeek 均成功提交 bid，随后三个 turn 都在继承的 30 秒期限内零输出超时。旧逻辑把它们记为取消，并重新开启 follow-up 抢麦，最终事件 `#39` 停在 `collecting_bids`，因此 UI 看起来既没有回答又一直卡住。旧开发进程稍后确实重启过，但旧 stdout 已不可得，所以不声称已经证明具体的进程退出原因。
- shared-session 对新建及持久化房间均设置至少 180 秒的 agent 执行期限。超时会写入 category 为 `timeout` 的结构化 `turn_failed`；所有候选都失败后回到 `idle`，不再静默循环收集 bid。Web 运行横幅会直接显示实际失败原因。
- daemon 重启恢复会把悬空 turn 结算为 `daemon_restart` 失败、释放 floor、记录警告，并把瞬态 phase 收敛到 `idle`。不会自动重放中断的 agent turn，因为其中的工具或工作区写入可能已经产生副作用；持久化的 `paused`/`ended` 状态保持不变。
- WebSocket 断开时会显示 close code/reason。Tauri 客户端重连前会重新调用 `get_sidecar_connection`，由 Rust 在需要时拉起新的 sidecar。`pnpm dev` 现在会保留 Vite，并在 daemon 意外退出后一秒自动重启 daemon。
- 先使用保存的 DeepSeek credential、`deepseek-v4-pro` profile 和同一个问题做了独立真实调用，约 5.1 秒得到回答；随后通过 live gateway 的 `create_session -> subscribe -> post_message` 完整路径再次收到 DeepSeek 完整回复，并删除临时 Session。过程中没有输出或提交原始 key。这证明当前 provider/key/model 与 shared-session 消息链路可用，但不能反推此前三个 30 秒窗口为何都没有输出。
- daemon 自动恢复已人工通过：只终止 daemon 进程组后，Vite 仍监听 `5173`；`scripts/dev.ts` 一秒后拉起新 daemon，`8787` 由新进程恢复监听，新 WebSocket 客户端可继续列出持久化房间。
- 本地已通过 `pnpm typecheck`、`104/104`、Web production build、shared/source/Node/Bun sidecar smokes 和 Rust `cargo check`。Node fallback smoke 只在与全套测试并发时超过一次 5 秒握手窗口，单独重跑 2.8 秒通过。当前 in-app browser runtime 没有可连接浏览器，因此本轮有真实 gateway/集成验证，但尚无新的点击式浏览器验收。Windows Packages run [29385964268](https://github.com/MattSureham/quorum/actions/runs/29385964268) 已在 `3c144ba` 上全绿：104 项测试、Bun/Web、未签名 NSIS、portable 组装/布局验证和所有 artifact 上传均通过；真实 Windows portable 体验仍属于人工发布验收。

## 2026-07-15 Windows credential 保存跟进

- 用户反馈最新 Windows portable 中 DeepSeek 保存仍表现为无响应。此前本地浏览器与绿色 Windows build 没有在真实 Windows 上交互验证打包后的 desktop/sidecar 组合，因此不能视为充分验收。
- 使用 compiled Bun sidecar 的完整链路已复现成功：认证 WebSocket、`set_credential`、掩码 `credential_saved`、SQLite 落盘和真实 Web UI 点击均通过，DeepSeek 更新为 `set ...2468`。另用故意不返回消息的 sidecar 验证，8 秒后 provider 卡片会直接显示超时错误。
- 每次凭据保存现在必须带 request id，成功与 `credential_error` 会按请求关联；每张 provider 卡片直接显示保存中、成功或错误。Bun compiled smoke 也会实际保存临时凭据、验证掩码并禁止原 key 泄露。
- desktop/sidecar 握手升级到协议版本 2。混用不同 portable 构建中的 `Quorum.exe` 与 `sidecars\\quorum-sidecar.exe` 会被明确拒绝；portable README 要求完整替换解压目录，不能只覆盖主 exe。
- 截图最可能的解释是新版 `Quorum.exe` 搭配旧 sidecar，但在拿到 Windows `%LOCALAPPDATA%\\dev.quorum.desktop\\sidecar.log` 和两个二进制 hash 前仍不能当作已证实根因。
- 本地 typecheck、`102/102`、Web build、source/Bun/Node sidecar smoke、Rust check、compiled-sidecar SQLite 保存、UI 成功回执和 UI 超时错误路径均通过。Windows Packages run [29384116932](https://github.com/MattSureham/quorum/actions/runs/29384116932) 已在代码提交 `8d62e0e` 上全绿：测试、compiled Bun sidecar、Web UI、NSIS、portable 组装/布局验证和所有 artifact 上传均通过。仍需在全新空目录解压后进行真实 Windows 复测。

## 2026-07-14 独立验收状态

### 最新 credential 与 portable 验收目标

- credential 路径修复位于 `efa11e1`、`8538ec3`、`ae87db3`，文档更新位于 `bdd726c`。legacy gateway 已能持久化 provider credentials，保存错误会显示在弹窗内，`QUORUM_DB_PATH` 在 legacy/shared 两种 kernel 下均生效。
- 本地已通过 typecheck、`100/100` 测试和 Web production build；使用全新临时 SQLite 的真实浏览器验证中，DeepSeek 点击保存后由 `not set` 变为掩码状态 `set ...5678`，原始测试 key 未返回浏览器。
- **Windows portable 验收者不需要 clone 或 pull 仓库。** 等待当前 `main` 的 Windows Packages workflow 完成，下载 `quorum-windows-x64-portable` artifact，完整解压内层 ZIP 后直接运行 `Quorum.exe`。只有从源码自行构建时才需要 pull。
- 不要用旧 portable artifact 验收本轮修复；下载前确认 workflow 对应提交包含 `bdd726c` 或其后继提交。
- portable artifact 不包含开发者的 API keys。新 Windows 机器需要在 **API keys** 中配置一次；数据保存在 `%LOCALAPPDATA%\\dev.quorum.desktop\\quorum.sqlite`，不会从 macOS、其他 Windows 机器或其他 SQLite 路径自动迁移。
- Windows 人工验收：保存临时 DeepSeek key 后卡片应显示 `set ...xxxx`；关闭弹窗后 DeepSeek provider 不再显示“需要 key”；New session 中 DeepSeek 模型可选择；重启 `Quorum.exe` 后配置仍存在。保存失败必须在弹窗内明确显示，不能表现为按钮无响应。
- 安全契约与 profile 后续修复：`SPEC.md` 已改为与实现一致，明确 API-model keys 以明文 JSON 存于本地 SQLite，目前没有 Keychain、Windows Credential Manager 或字段加密，只依赖系统账户与文件权限。自定义 API profile 现在必须填写 provider；旧版无 provider 的 profile 会迁移到 `openai` 并受凭据 gating。新增 2 项纯 UI 状态测试覆盖迁移、必填 provider 和重复 id；本地 typecheck、Web build、`102/102` 测试通过。
- Windows Packages run [29323512564](https://github.com/MattSureham/quorum/actions/runs/29323512564) 已针对修复提交 `8a21cbe` 全绿：102 项测试、Bun/Web、未签名 NSIS、portable 组装与布局验证、全部 artifact 上传均通过。唯一 annotation 是 GitHub Actions 的 Node 20 action-runtime 弃用警告，不影响本次构建。真实 Windows portable 体验与 `.cmd` 对抗测试仍是人工发布验收项。

- 安全与可靠性复核后的阻断项已继续修复：内置 adapter 配置采用严格的按类型 schema；CLI health check 与 adapter 共用 Windows shell 参数校验；Codex resume 参数层级已纠正；等待共享 workspace 写锁的排队时间不再计入 agent 执行超时。
- 前端发送改为读取当前 WebSocket `readyState` 与 refs，旧 room 不再在 render 时覆盖 active-room ref；审批超时/中断会写入终态；已有未提交改动的 workspace 会拒绝初始化。
- 本地 typecheck/test/Web/smoke/desktop 验证与 Windows workflow 均已通过；仍需在真实 Windows 上做 `.cmd` 注入、session 切换和 portable 人工验收。
- `local-sandbox-executor` 仍不是真正的 OS 沙箱，不能宣称可隔离用户目录、网络或其他解释器。这仍是强沙箱发布声明的阻断项。
- Windows run [29314485107](https://github.com/MattSureham/quorum/actions/runs/29314485107) 已全绿：99 项测试、Bun/Web、NSIS、portable 组装、布局校验和所有 artifact 上传均通过。代码级验收完成；真实机器人工体验与 `.cmd` 对抗验收仍保留。
- Agents & Models 侧栏现在固定显示顶部 `API keys` 配置入口；本地 CLI agents 保持可见，API 模型按 provider 折叠，避免模型卡片长期占满侧栏。
- 五个内置 provider 的模型目录始终显示，不再因当前 SQLite 没有 credential row 而整组消失。New session 中未配置 key 的模型会显示“需要 key”并禁用；配置成功后立即可选。
- legacy room host 与 shared-session host 现在都接入 SQLite credential 读写和启动时环境变量恢复；CLI 在两种 kernel 下都会传递 `QUORUM_DB_PATH`。保存失败会直接显示在配置弹窗中，不再被弹窗遮住。WebSocket 回归测试确认只返回 key 掩码；本地验证为 100/100、typecheck 和 Web production build 全通过。凭据只属于当前选中的 SQLite，不会跨机器自动迁移，也不会打进 portable artifact。

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

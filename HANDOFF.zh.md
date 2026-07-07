# 交接文档（HANDOFF）

给接手 **Quorum** 的下一个 agent 的工作交接。截至 **2026-06-23**，`main` 在提交 `384c311`。English version: [`HANDOFF.md`](./HANDOFF.md)。

> 2026-07-07 架构更新：Quorum 正在迁移到 agent-framework 会议确定的共享 Session 架构。新的实施交接文档见 [`AGENT_FRAMEWORK_HANDOFF.md`](./AGENT_FRAMEWORK_HANDOFF.md)，完整复制材料在 [`docs/architecture/`](./docs/architecture/)。

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

其它脚本：`pnpm demo`（零依赖的双 agent echo 演示）、`pnpm test`（vitest，30 个测试）、`pnpm typecheck`（tsc -b）、`pnpm smoke`（M0 EventLog 自检）。

**坑：** 只有一个进程能占用 8787 端口。如果已经有一个独立 daemon 在跑，你会得到 `EADDRINUSE`——先把它停掉（用 `lsof -nP -i :8787` 找到它）。

## 仓库结构
```
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
- **房间（agents、策略、workspace）**：目前**硬编码**在 `packages/cli/src/index.ts`。（README 里的 TODO：改成读 `quorum.config.json`。）
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
1. 把 `cli/src/index.ts` 里硬编码的房间换成一个 `quorum.config.json` 加载器。
2. 审计/收尾 M5 web 客户端功能（diff 视图、approve-tool + rollback UI、重连）。
3. 启动 M6（远程传输 + 配对）。
4. 刷新 `README.md`——它的 “Status” 段落已过期（仍把 web 客户端说成占位符，还引用了并不存在的 `pnpm --filter @quorum/cli start` 脚本；启动 daemon 用 `npx tsx packages/cli/src/index.ts`）。

## 约定 / 注意事项
- `@quorum/core` 保持**零依赖**；任何需要网络/环境变量/SDK 的东西都放进 `@quorum/daemon`。
- 先验证再下结论：在 `384c311` 上 `pnpm typecheck` 干净、`pnpm test` 30/30 全绿。
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

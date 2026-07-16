# 交接文档（HANDOFF）

给接手 **Quorum** 的下一个 agent 的工作交接。截至 **2026-07-16**，以 `main` 当前 HEAD 为准。English version: [`HANDOFF.md`](./HANDOFF.md)。

## 2026-07-16 同步检查点

- 交接检查点时，仓库工作树干净且已与 `origin/main` 同步。Windows 文档打包在实现基线 `0ba5255` 上完成验收；之后的评审整改记录在原功能历史上方的新日期章节中。
- [Windows Packages run 29407135897](https://github.com/MattSureham/quorum/actions/runs/29407135897) 是当前打包验收基线：133 项测试全部通过，编译后的 Windows sidecar 实际解析了真实 PDF 与 DOCX，Web UI、未签名 NSIS、portable 布局校验和四类 artifact 上传均成功。测试者可直接下载 portable artifact，运行它不需要 clone 或 pull 仓库。
- 文档支持的主要实现位于 `packages/protocol/src/schema.ts`、`packages/daemon/src/attachments/document-extractor.ts`、WebSocket gateway、`packages/core/src/session-manager.ts` 与 `packages/client-web/src/main.tsx`。`scripts/bun-sidecar-smoke.ts` 是打包回归路径，Windows workflow 中必须继续用真实 PDF/DOCX 执行它。
- 剩余发布边界已明确：扫描 PDF 仍需 OCR，旧 `.doc` 不支持，本环境无法做浏览器点击/截图验收，真实 Windows 机器的 portable 交互仍属于人工验收。请勿将这些描述为已实现或已验证。本机也没有完整 Xcode，因此本功能未触发新的 macOS bundle 构建。

## 2026-07-16 显式 workspace 边界整改

- `create_session` 在省略 `workspacePath` 时不再回退到启动房间的 workspace。New Session 留空 workspace 现在在服务端和 UI 两端都保持中性；文件夹选择器也不再把当前房间路径当作隐式起点。
- 中性 CLI 工作目录现使用有界可读 slug 加基于完整 Session id 的 SHA-256 指纹。`..` 无法落到临时根目录，`room/a` 与 `room?a` 等归一化后相同的 id 也不会共用目录。新的网络创建 Session id 最长 128 个路径安全字符，并拒绝相对路径片段。
- 回归覆盖：已显式绑定仓库的启动房间不会将路径泄漏给新建中性 Session，并验证了路径逃逸/碰撞防护。定向 schema、CLI safety 与 shared-host 测试共 22 项全部通过。

## 2026-07-16 重启幂等性与失败 turn 调度

- Round-robin 现在会在选择首位发言者前，持久化与 bid 模式相同的 `phase_changed.promptSeq` 恢复锚点。已正常完成的排队 round-robin prompt 因而会在启动恢复中被排除，不会再次执行工具或文件修改。
- 软目标轮数 wrap-up 现在会在调度器检查“上一个唯一候选者已失败且没有剩余 bid”之后才评估。单 agent 失败会只返回人类控制一次，不再立即把同一 agent 当作总结者再运行一次。
- Core 回归在同一 event store 上重建 SessionManager，确认两条 round-robin prompt 完成后的 turn 数不会在重启后增加；另一测试确认唯一失败候选者只产生一条 `turn_failed` 且没有 wrap-up 请求。SessionManager 27 项测试全部通过。

## 2026-07-16 DOCX 实际展开量加固

- DOCX 校验不再把 `Entry.uncompressedSize` 当作强制上限的真相来源。Central-directory 数值仍用于早期拒绝，但每个非目录 entry 现在都会串行流式读取，并按实际展开字节强制单 entry 25 MB、总计 50 MB 上限。`word/document.xml` 在任何 XML 解析前还有独立 8 MB 实际大小上限。
- DOCX 超时现在会中止 `AbortController`、销毁活动解压 stream 并关闭 ZIP。原来的 `Promise.race` 可能已报失败但 Mammoth 仍在解析；Mammoth 已从 daemon 依赖中移除。校验后的主文档 OOXML 改由 `@xmldom/xmldom` 解析，拒绝 DTD/entity 声明，并提取段落、tab 和换行，不会再次打开压缩包。
- 构造回归将 810 万个文本字符压缩到 100 KB 以下，同时伪报 entry 仅 1 KB；它会被实际字节上限拒绝，不会进入 XML 解析。文档/gateway 定向测试 19 项、typecheck 及 compiled Bun sidecar 真实 PDF/DOCX smoke 均通过。

## 2026-07-15 PDF 与 DOCX 聊天附件

- Chat 的“文件”选择器现在支持 PNG/JPEG/GIF/WebP 图片以及 PDF、DOCX 文档。图片保留缩略图与粘贴能力；文档卡片会显示提取状态、可用时的页数、警告，并保留本机原文件下载入口。
- daemon 会先验证 MIME 与 data URL 一致、解码后的实际字节数和 PDF/DOCX 文件签名。DOCX 先预检元数据，再实际流式累计展开量，最后进行有界 OOXML 段落提取；PDF 使用 `unpdf` 提取内嵌文本。解析失败会直接显示在文档卡片；没有内嵌文本的扫描 PDF 会明确提示需要 OCR，不会伪装成已经读懂。OCR 与旧版 `.doc` 暂未实现。
- 提取文本会作为“非可信参考内容”注入当前 topic 中每个 agent 的 Context Bundle，因此 API 与 CLI agent 得到相同文档内容。后续历史 projection 只保留元数据与提取状态，不携带 data URL 或全文；单文档最多注入 120,000 字符，单次 prompt 的文档总量最多 160,000 字符。
- 网络边界最多接受 6 个附件：图片每个 5 MB，PDF/DOCX 每个 10 MB，解码后总计 20 MB。只允许多模态链路支持的安全位图格式，SVG 上传会被拒绝。异步解析期间按房间串行处理消息，连续快速发送两个文档也不会打乱 event seq。
- 真实解析回归覆盖 PDF 文本/页数、DOCX 段落、空白扫描式 PDF、损坏容器、伪造编码/展开大小、schema MIME 门、拒绝客户端伪造的提取文本、当前 topic 上下文注入与 gateway enrichment。本地 typecheck、`133/133` 测试、Web production build 以及同时携带真实 PDF/DOCX 的 compiled Bun sidecar smoke 已通过。Windows Packages 现在也会运行同一条 compiled 文档 smoke，而不再只编译 sidecar。当前 in-app browser 没有浏览器实例，因此仍无法进行点击/截图验收。
- Windows run `29406982270` 在增强 smoke 处正确阻止了打包，但根因是 smoke harness 在 Windows 使用裸 `spawn tsx` 导致 `ENOENT`，并非解析器失败。Bun 与 Node fallback smoke 现改为在进程内导入 TypeScript 构建脚本，不再依赖平台相关的 pnpm shim 查找。后续 [Windows run 29407135897](https://github.com/MattSureham/quorum/actions/runs/29407135897) 已在 `0ba5255` 上全绿：133 项测试、编译后的 Windows sidecar 真实 PDF/DOCX smoke、Web build、未签名 NSIS、portable 组装/布局校验以及全部 artifact 上传均通过。Windows portable 的文档支持已完成打包级验收，真实机器交互仍属于人工发布验收。

## 2026-07-15 富文本聊天与图表输出

- Chat 不再把消息当作单纯的 `pre-wrap` 文本，而是渲染经过清洗的 GitHub-flavored Markdown。支持紧凑标题、列表/任务列表、表格、引用、安全链接、代码块、Markdown 图片，以及原有的上传/粘贴图片附件；附件与 Markdown 图片均可从预览打开原图。
- fenced `mermaid` 代码块会按需渲染流程图、时序图、饼图、XY 图及 Mermaid 的其他图形。普通消息不会加载 Mermaid；无效图表会保留可读源码，不会留下空白聊天。
- 安全边界保持严格：禁用原始 HTML，Markdown AST 经过 `rehype-sanitize`，拒绝可执行协议和 `file:` 图片，禁止 Mermaid 单图配置与主动内容 hook，Mermaid 使用 `securityLevel: strict` 并关闭 HTML label，最终 SVG 在插入前还会经过 DOMPurify。
- `SessionManager` 会向每个 agent 声明 GFM/Mermaid 展示能力，并要求视觉内容旁保留文字结论。CLI 与 API agent 因而都能主动使用富文本，但权威事件格式不变，event log 仍保存原始 Markdown 文本。
- 新回归会在服务端渲染代表性的 GFM/Mermaid 消息，并检查图片/图表安全门。typecheck、`123/123` 测试、Web production build、EventLog/shared/source/Node/Bun sidecar smoke 与 Rust `cargo check` 已通过。Windows Packages run [29404444923](https://github.com/MattSureham/quorum/actions/runs/29404444923) 已在 `3c4ed5e` 上全绿：123 项测试、Web/Bun 构建、未签名 NSIS 打包、portable 组装/布局验证及全部 artifact 上传均通过。Mermaid 被拆成按需 chunks，普通主 bundle 不会执行它；Vite 会对几个超过 500 kB 的按需 Mermaid 图形 chunk 给出预期警告，虽然不影响普通聊天加载，仍需关注安装包/下载体积。当前 in-app browser 仍没有可连接实例，因此本环境无法完成截图/点击验收。`pnpm audit --prod` 因 npm 已停用当前 pnpm 9 使用的 audit endpoint 而返回 HTTP 410，不能把这次命令误报成“无漏洞”。

## 2026-07-15 自定义顺序与参考讨论轮数

- New Session 新增可用图标上下移动的参与者顺序，以及 1-12 的“目标讨论轮数”。参与者数组顺序仍是持久化顺序的唯一来源：按序陈述每轮严格遵循，自由讨论和举手模式则用它处理同分 bid。
- `targetDiscussionRounds` 会写入 `Room`、在 WebSocket 边界校验并传给 `SessionManager`。它与 `maxTurnsPerTopic` 明确分离；后者只保留为防止失控循环的内部硬安全上限。
- 一轮表示每位被选中或定向的智能体各有一次发言机会。达到目标时不会中断正在进行的 turn；Quorum 会记录 wrap-up 请求，再按设定顺序给所有 eligible 参与者各一次最终总结发言，要求收敛到具体答案、保留分歧，并把未完成工作留给 Continue Session。
- 按序陈述会先按自定义顺序重复指定轮数，再进入同顺序的总结轮。诊断区显示轮数进度与“正在总结”，设置和状态文案均支持中英双语。
- 回归覆盖轮数 schema 边界、同分时的自定义顺序、软目标不截断、按序多轮、完整总结轮和 host 持久化。typecheck、`119/119` 测试、Web production build、EventLog/shared/source/Node/Bun sidecar smoke 与 Rust `cargo check` 已通过。Windows Packages run [29402010332](https://github.com/MattSureham/quorum/actions/runs/29402010332) 已在 `b5f97f1` 上全绿：测试、Web/Bun、未签名 NSIS、portable 组装/布局验证与全部 artifact 上传均通过。首次本地全量测试中 3 个既有 CLI 子进程测试在并发负载下超过 5 秒，随后单独重跑全部通过；host 集成测试缩回原执行时长后，完整测试套件已干净通过。当前 in-app browser 没有可连接实例，因而无法做点击/截图验收；也未安装完整 Xcode，因此未重跑 macOS bundle。

## 2026-07-15 Codex 临时重连与话题上下文隔离

- 最近一次用户会议是 `.quorum/webui-smoke.sqlite` 中的 `session-mrlor4em`，参与者确实包含 Codex、Claude Code 和 DeepSeek V4 Pro。Codex 两次 bid 并在 `#21`、`#101` 赢得发言权，但两个 turn 都在约 50 秒后以零输出和 `Reconnecting... 2/5 (request timed out)` 结束。调度没有漏掉 Codex，只是聊天区没有可显示的 Codex message。
- 直接运行本机 `codex exec` 复现了同一个 JSONL `error`，但 CLI 随后继续重试、发出 WebSocket 降级 HTTPS 的通知，并最终正常返回 `OK`。Quorum 过去把第一个可恢复 `error` 错当成终局失败；现在它会被记录为非聊天 transport notice，并继续等待 assistant message。只有 `turn.failed`、进程非零退出、deadline 或最终空输出才判失败；fake CLI 回归覆盖“重连后成功”。
- 模型把问题理解成 Quorum 相关，是 host 主动注入造成的，不是跨 Session 记忆恢复。该房间的 workspace 是 `/Users/matthew/Projects/quorum`；每个 turn 都收到标题为 `Quorum Context Bundle` 的 bundle，里面重复产品名与路径；Claude Code 还以该仓库为 `cwd`。DeepSeek 随后又在同一 Session transcript 中看到了 Claude 已经 Quorum 化的首轮回答。该房间没有 shared memory，也没有 long-term memory；唯一 working summary 到 `#96` 才生成。
- continuity bundle 现改为中性的 shared Session metadata，并明确 host/application 名称、participant id、Session metadata 和 workspace path 都不是用户话题；除非 human prompt 明说，否则禁止推断问题与 host 或 workspace 项目有关。未选择 workspace 时，Codex/Claude Code 会在 OS 临时目录中的独立 Session 目录运行，不再偷偷继承 daemon 的 Quorum 仓库 cwd。
- New Session 不再自动填入当前房间的 workspace path；项目目录必须由用户显式选择，避免从 Quorum 项目房间发起通用讨论时继续继承该仓库上下文。Windows Packages run [29398330270](https://github.com/MattSureham/quorum/actions/runs/29398330270) 已在 `d20acce` 上全绿，包括 115 项测试、Web/Bun、NSIS、portable 布局验证和全部 artifact 上传。
- 真实端到端验证创建了一个无 workspace 的临时 Codex-only Session，并询问通用的 agent 熵增问题。Codex 经历 transport 重试后成功返回一句通用回答、写入 `turn_completed`，没有提到 Quorum 或代码库；临时 Session 随后已删除。
- 本地已通过 typecheck、`115/115`、Web production build、shared/source/Node/Bun sidecar smokes 和 Rust `cargo check`。Windows Packages run [29397682665](https://github.com/MattSureham/quorum/actions/runs/29397682665) 已在 `605ea77` 上全绿：115 项测试、Bun/Web、未签名 NSIS、portable 组装/布局验证和全部 artifact 上传均通过。当前机器没有完整 Xcode，因此未重跑 macOS bundle。

## 2026-07-15 零 Session 时的 credential 可用性

- 删除最后一个 Session 后，DeepSeek 再次显示“需要 key”的问题已复现。key 实际没有丢失：`.quorum/credentials.sqlite` 中 DeepSeek 仍是已配置状态，掩码尾号也正确。根因是 gateway 先按 room 查找 Session，之后才处理 `get_credentials` / `set_credential`；当房间为零时，两条命令都会错误返回 `unknown session`。
- provider credential 现在是 daemon 全局命令，在 Session 查找之前处理；协议中的 `roomId` 改为可选。新增 gateway 回归会先删除最后一个房间，再验证 credential 的掩码读取与保存，响应不会包含原始 key。
- Web 启动时会独立请求 credential，等待 `list_sessions` 后才决定 continue/subscribe。Session 列表为空时会清除过期 room 状态，但 API key 配置与 New Session 仍可使用；只有实际加载了房间才会刷新 agent health。
- 使用固定 credential store 做了真实验证：删除唯一 smoke Session 后，gateway 返回零个房间，同时 DeepSeek 仍为已配置并返回原有掩码。本地已通过 typecheck、`112/112`、Web production build、shared/source/Node/Bun sidecar smokes 和 Rust `cargo check`。Windows Packages run [29391070418](https://github.com/MattSureham/quorum/actions/runs/29391070418) 已在 `7301fc0` 上全绿：112 项测试、Bun/Web、未签名 NSIS、portable 组装/布局验证和全部 artifact 上传均通过。当前 in-app browser 没有可连接实例，因此本环境无法补做点击式验收。

## 2026-07-15 Codex 超时与 follow-up bid 恢复

- 用户判断正确：`session-mrlkcmvc` 中失败的是 Codex，不是 Claude Code。Claude Code 用时约 43.1 秒并输出一条消息；Codex 随后运行约 50.7 秒，以 `Reconnecting... 2/5 (request timed out)` 失败且零输出；DeepSeek 之后约 29.9 秒成功输出一条消息。
- 两个 Quorum 问题掩盖了真实顺序。运行横幅过去会让任意较早的 `turn_failed` 压过之后的 `turn_completed`，且不显示失败者。现在只依据当前 human prompt 之后最新的 turn 终态，并在失败原因前显示参与者名称。
- DeepSeek 完成后，开放讨论调度器在同一 epoch 收到 Codex 的新 bid；SQLite 派生表的唯一 `(session_id, epoch, agent_id)` 索引却拒绝新 bid id，导致房间停在 `collecting_bids`。现在同 agent/epoch 的新 revision 会原子替换旧派生行并清除 settled 状态；append-only event log 仍保留全部 bid 事件。
- Codex JSONL `turn.failed` 现在经过 CLI failure classifier，这次错误会归类为 `timeout`，不再是笼统的 `adapter_error`。新增回归覆盖终态先后顺序、同 epoch 重复 bid 和 Codex 超时分类。
- 本地已通过 typecheck、`110/110`、Web production build、shared/source/Node/Bun sidecar smokes 和 Rust `cargo check`。当前 in-app browser 没有可用实例，因此 UI 行为通过纯状态测试与受影响持久化房间的真实 WebSocket replay 验证。Windows Packages run [29389046867](https://github.com/MattSureham/quorum/actions/runs/29389046867) 已在 `1da49e8` 上全绿：110 项测试、Bun/Web、未签名 NSIS、portable 组装/布局校验和全部 artifact 上传均通过。

## 2026-07-15 开发环境固定 credential 存储

- DeepSeek 反复要求配置的根因是数据库身份，而不是 provider 鉴权：仓库中实际存在七份本地 Session/测试 SQLite。当前 daemon 使用 `.quorum/webui-smoke.sqlite`，其中配置了 DeepSeek/OpenAI/智谱；正常默认 `.quorum/quorum.sqlite` 却没有 provider row。切换启动命令后便看起来像 key 被清空。
- `pnpm dev` 现在固定把绝对路径 `.quorum/credentials.sqlite` 设为 `QUORUM_CREDENTIAL_DB_PATH`，与 `QUORUM_DB_PATH` 的 Session/event 数据分离。shared 与 legacy host 均通过固定库读写 provider credentials；sidecar/直接启动也可显式使用同一环境变量。Tauri 原本就固定使用 OS app-data 中的一份数据库，所以 desktop/portable 行为不变。
- 第一次启用独立 credential store 时，会从当前 Session DB 复制固定库中尚不存在的 provider；固定库已有配置优先，旧测试库不能覆盖。用户现有 DeepSeek/OpenAI/智谱配置已在本机完成迁移，过程中没有输出原始值；credential DB 被 Git 忽略，也不会进入 artifact。
- 新增 shared-host 回归测试：从第一份 Session DB 迁移 credential 后切到全新第二份 Session DB，DeepSeek 掩码配置仍存在，而第二份 Session DB 本身没有 provider row。启动日志现在同时显示 Session DB 与 credential DB 路径。
- 本地已通过 typecheck、`105/105`、Web production build、shared/source/Node/Bun sidecar smokes 和 Rust `cargo check`。Windows Packages run [29387544014](https://github.com/MattSureham/quorum/actions/runs/29387544014) 已在 `f6407b6` 上全绿：105 项测试、Bun/Web、未签名 NSIS、portable 组装/布局验证和所有 artifact 上传均通过。

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

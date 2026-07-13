# HANDOFF

Working handoff for an agent picking up **Quorum**. Current as of **2026-07-09** on `main`. 中文版见 [`HANDOFF.zh.md`](./HANDOFF.zh.md)。

> 2026-07-07 architecture update: Quorum is being migrated to the shared-session architecture from the agent-framework meeting. New implementation handoff: [`AGENT_FRAMEWORK_HANDOFF.md`](./AGENT_FRAMEWORK_HANDOFF.md). Full copied docs live in [`docs/architecture/`](./docs/architecture/).

## Current State For The Next Agent

Latest migration commits:

- `7d303b8 feat: add shared session architecture kernel`
- The follow-up handoff/UI commit adds shared-session Web UI projection and `pnpm smoke:shared`.
- The sidecar spike commit adds `packages/daemon/src/sidecar.ts` and `pnpm smoke:sidecar`.
- The Node fallback spike adds `pnpm sidecar:node:build` and `pnpm sidecar:node:smoke`.
- The packaging env commit adds project-local Bun/Rust setup under `.tools/` and validates Bun single-file sidecar compile with `pnpm sidecar:bun:smoke`.
- The desktop shell spike adds `apps/desktop`, `pnpm desktop:check`, `pnpm desktop:dev`, `pnpm desktop:build`, and a Tauri command that starts the compiled Bun sidecar and returns its authenticated WebSocket URL to the React client.

## This Session Implementation Log

The following is the implementation trail from this session. It is written for the next agent to continue without reconstructing context from chat history.

1. `7d303b8 feat: add shared session architecture kernel`
   - Files: `packages/protocol/src/types.ts`, `packages/protocol/src/schema.ts`, `packages/core/src/session-manager.ts`, `packages/core/src/command-mailbox.ts`, `packages/core/src/arbiter.ts`, `packages/core/src/session-state.ts`, `packages/core/src/legacy-agent-adapter.ts`, `packages/daemon/src/shared-session-host.ts`, `packages/cli/src/index.ts`, tests and docs.
   - Work: introduced the shared-session contract and kernel: explicit phases, append-only event commands, bid collection, arbitration, turn ownership, queued bids during speaking, legacy adapter wrapping, and `QUORUM_SESSION_KERNEL=shared` boot path.

2. `2e15f2a docs: clarify shared session handoff status`
   - Files: `README.md`, `HANDOFF.md`, `HANDOFF.zh.md`.
   - Work: copied the meeting conclusions into handoff docs and clarified what had been implemented versus what remained open for the new shared-session architecture.

3. `eaf18b2 feat: surface shared session state in web UI`
   - Files: `packages/client-web/src/main.tsx`, `packages/client-web/src/styles.css`, daemon/gateway wiring as needed, docs.
   - Work: exposed shared-session phase, active speaker, pending bids, selected speaker, and debug events in the Web UI so the new kernel could be inspected from the browser.

4. `1d7f27c feat: add authenticated sidecar entry`
   - Files: `packages/daemon/src/sidecar.ts`, WebSocket gateway auth path, smoke scripts, package scripts, docs.
   - Work: added a local sidecar entrypoint that binds an ephemeral loopback port, prints `{ port, token, bootId }`, and requires the token for WebSocket connections.

5. `81aef87 feat: add node sidecar fallback smoke`
   - Files: `scripts/build-sidecar-node.ts`, `scripts/node-sidecar-smoke.ts`, package scripts, docs.
   - Work: added a Node-runtime sidecar fallback build/smoke path for platforms where Bun single-file packaging is unsuitable.

6. `de2ff9b feat: verify bun sidecar in local packaging env`
   - Files: `.tools/` setup scripts, `scripts/bun-sidecar-smoke.ts`, packaging scripts, SQLite sidecar compatibility code, docs.
   - Work: added project-local Bun/Rust tooling setup and verified Bun single-file sidecar execution with SQLite, authenticated WebSocket, and shared-session echo turn.

7. `ff6825f feat: add tauri desktop sidecar shell`
   - Files: `apps/desktop/**`, Tauri Rust layer, Web UI Tauri connection detection, package scripts, docs.
   - Work: scaffolded the desktop shell. The Rust layer starts the compiled Bun sidecar, parses the stdout handshake, and exposes the authenticated WebSocket URL to React.

8. `827efdb fix: validate desktop bundle build`
   - Files: `apps/desktop/src-tauri/**`, desktop build config/resources, scripts/docs.
   - Work: fixed and validated macOS arm64 desktop bundling so `pnpm desktop:build` produces an unsigned `.app`/`.dmg` containing the Bun sidecar under `Contents/Resources/sidecars/quorum-sidecar`.

9. `773bdee fix: improve shared session mobile web ui`
   - Files: `packages/client-web/src/main.tsx`, `packages/client-web/src/styles.css`.
   - Work: improved mobile usability for the shared-session Web UI: operations are easier to reach, debug surfaces are less intrusive, and the composer remains usable on small screens.

10. `64d0a42 feat: persist shared session projections`
    - Files: `packages/core/src/session-state.ts`, `packages/core/src/session-manager.ts`, `packages/daemon/src/persistence/sqlite-store.ts`, `packages/daemon/src/shared-session-host.test.ts`, tests/docs.
    - Work: added replay projection persistence and SQLite-derived tables for sessions, turns, bids, and snapshots while keeping the append-only event log as the source of truth. Also handled legacy event-table migration.

11. `9a56849 feat: show arbitration score components`
    - Files: `packages/client-web/src/main.tsx`, `packages/client-web/src/styles.css`.
    - Work: surfaced arbitration score components in the Web UI so speaker selection can be debugged rather than treated as a black box.

12. `5260a1f feat: wire shared session tool approvals`
    - Files: `packages/core/src/session-manager.ts`, `packages/core/src/session-manager.test.ts`, `packages/daemon/src/gateway/ws-server.ts`, `packages/daemon/src/shared-session-host.ts`, docs.
    - Work: wired `AgentRuntime.callTool()` to the human approval loop. The WebSocket `approve_tool` command now resolves requested/granted/denied approval state for shared-session turns.

13. `e09977b feat: execute approved shared room tools`
    - Files: `packages/core/src/session-manager.ts`, `packages/core/src/session-manager.test.ts`, docs.
    - Work: after approval, safe room tools (`read_room`, `post_note`, `request_review`, `hand_off`, `raise_hand`) execute through `runRoomTool()` and emit `tool_call` / `tool_result` plus any room events.

14. `6dd1fe8 feat: add shared session replay projection`
    - Files: `packages/daemon/src/gateway/ws-server.ts`, `packages/daemon/src/gateway/ws-server.test.ts`, `packages/client-web/src/main.tsx`, `packages/client-web/src/styles.css`, `packages/protocol/src/schema.ts`, docs.
    - Work: added WebSocket `replay_projection` and a Web UI Replay panel to rebuild phase/speaker/bid state from an arbitrary event sequence.

15. `0603b32 feat: add working memory compaction`
    - Files: `packages/core/src/memory.ts`, `packages/core/src/memory.test.ts`, `packages/core/src/event-log.ts`, `packages/core/src/in-memory-store.ts`, `packages/core/src/session-manager.ts`, `packages/daemon/src/persistence/sqlite-store.ts`, `packages/daemon/src/gateway/ws-server.ts`, `packages/client-web/src/main.tsx`, `packages/client-web/src/styles.css`, protocol schema, tests/docs.
    - Work: implemented deterministic working-memory summaries, persistence in memory/SQLite stores, `SessionManager.compactWorkingMemory()`, WebSocket `compact_memory`, and a Web UI Memory panel.

16. `7abb9f3 feat: auto compact working memory`
    - Files: `packages/core/src/session-manager.ts`, `packages/core/src/session-manager.test.ts`, `README.md`, `HANDOFF.md`, `HANDOFF.zh.md`.
    - Work: added automatic working-memory compaction after turns once configured thresholds are reached (`minSeqGap`, `minEvents`, `keepRecentEvents`, `autoCompact`). Auto summaries are persisted and marked with `auto: true`.

17. `ac788aa feat: execute approved external tools in sandbox`
    - Files: `packages/core/src/tool-executor.ts`, `packages/core/src/session-manager.ts`, `packages/core/src/session-manager.test.ts`, `packages/daemon/src/tools/local-sandbox-executor.ts`, `packages/daemon/src/tools/local-sandbox-executor.test.ts`, `packages/daemon/src/shared-session-host.ts`, `packages/daemon/src/index.ts`, `README.md`, `HANDOFF.md`, `HANDOFF.zh.md`.
    - Work: added a core `ToolExecutor` injection point and a daemon local sandbox executor for approved external command tools such as `Bash`. Current safeguards: workspace cwd containment, timeout, stdout/stderr truncation, tool allowlist, and common dangerous-command blocking. Remaining gap: adapter-native Claude/Codex tool events still need bridging so every native tool call goes through the same approval/sandbox path.

18. `cf765f2 docs: add session implementation handoff log`
    - Files: `HANDOFF.md`.
    - Work: recorded the implementation trail so another agent can continue without reconstructing the session from chat history.

19. `b4f0494 fix: keep web ui composer visible` and `a260cdd fix: make shared session interrupts usable`
    - Files: `packages/client-web/src/main.tsx`, `packages/client-web/src/styles.css`, shared-session/gateway files as needed.
    - Work: made the primary chat composer usable in the Web UI and fixed interruption handling so humans can regain control during shared-session runs.

20. `bd76368 feat: configure provider credentials in web ui`
    - Files: `packages/daemon/src/persistence/sqlite-store.ts`, `packages/daemon/src/gateway/ws-server.ts`, `packages/daemon/src/shared-session-host.ts`, `packages/daemon/src/adapters/api-model.ts`, `packages/client-web/src/main.tsx`, `packages/client-web/src/styles.css`, docs/tests.
    - Work: added WebSocket `get_credentials` / `set_credential`, persisted provider API keys/base URLs/models in local SQLite, applied them to daemon `process.env`, and returned only masked previews to the browser.

21. `394da4f fix: simplify web ui information architecture`
    - Files: `packages/client-web/src/main.tsx`, `packages/client-web/src/styles.css`, `README.md`, `HANDOFF.md`.
    - Work: reorganized the Web UI around the main workflow: rooms/sessions on the left, chat/session stream in the center, participants/providers on the right, with diagnostics collapsed.

22. this change `fix: hide credential forms behind modal`
    - Files: `packages/client-web/src/main.tsx`, `packages/client-web/src/styles.css`, `README.md`, `HANDOFF.md`.
    - Work: moved provider API key inputs out of the persistent right sidebar. The main workspace now shows only provider status and a Configure button; actual credential editing happens in a modal that can be closed after setup.

23. this change `fix: present agent model config instead of providers`
    - Files: `packages/client-web/src/main.tsx`, `packages/client-web/src/styles.css`, `README.md`, `HANDOFF.md`.
    - Work: corrected the Web UI concept model. The right sidebar now presents room agents and available agent/model types (Codex, Claude Code, OpenClaw placeholder, DeepSeek V4 Pro/Flash, GLM 5.2) instead of treating raw providers as selectable participants. Provider credentials remain hidden in a modal and are described as API-model credential sources, not webchat sessions.

24. this change `feat: allow custom api credential providers`
    - Files: `packages/client-web/src/main.tsx`, `packages/client-web/src/styles.css`, `README.md`, `HANDOFF.md`.
    - Work: the API credential modal is no longer limited to the built-in OpenAI/DeepSeek/Anthropic preset rows. Users can add a custom provider id, env var, base URL, default model, and API key; saved non-preset providers returned by the daemon are merged back into the modal.

25. this change `feat: add zhipu and minimax credential presets`
    - Files: `packages/client-web/src/main.tsx`, `README.md`, `HANDOFF.md`.
    - Work: added Zhipu and MiniMax to the built-in API credential presets, kept DeepSeek as an explicit preset, mapped GLM model agents to the Zhipu provider, and added MiniMax M3 as an available direct API model agent.

26. this change `feat: surface session setup flow`
    - Files: `packages/client-web/src/main.tsx`, `packages/client-web/src/styles.css`, `README.md`, `HANDOFF.md`.
    - Work: added a left-sidebar New session entry and Session setup modal. The modal exposes participant selection, session id/title fields, and three intended modes: Open discussion, Raise hand, and Round robin. In the initial UI-only step Start was disabled; the next entry wires it to the backend.

27. this change `feat: create sessions from web ui`
    - Files: `packages/protocol/src/types.ts`, `packages/protocol/src/schema.ts`, `packages/daemon/src/gateway/ws-server.ts`, `packages/daemon/src/shared-session-host.ts`, `packages/daemon/src/shared-session-host.test.ts`, `packages/client-web/src/main.tsx`, docs.
    - Work: added `list_sessions` and `create_session`, changed the gateway to register and route multiple session deps by room id, added an in-memory shared-session registry that creates a new `SessionManager` per requested room, and wired the Web UI Start session button to create and subscribe to the new session.

28. this change `feat: show session run status`
    - Files: `packages/client-web/src/main.tsx`, `packages/client-web/src/styles.css`, `README.md`, `HANDOFF.md`.
    - Work: added a run-status derivation from the current event stream plus local send timestamp. The Web UI now shows an Activity metric and composer banner for submitted, collecting bids, selecting speaker, speaking, settling, completed, failed, and stalled-wait states.

29. this change `fix: show api model config failures`
    - Files: `packages/daemon/src/adapters/api-model.ts`, `packages/daemon/src/room-host.test.ts`, `packages/client-web/src/main.tsx`, `packages/client-web/src/styles.css`, docs.
    - Work: API-model agents now emit visible chat messages for missing API keys, HTTP errors, and empty provider responses instead of completing silently. Composer target chips now show agent display names plus ids, and the composer shows a session participant summary so users can confirm DeepSeek/MiniMax/etc. are actually in the active session.

30. this change `fix: keep session setup form editable`
    - Files: `packages/client-web/src/main.tsx`, `README.md`, `HANDOFF.md`.
    - Work: moved Session setup edits into modal-local draft state and changed text field handlers to copy `currentTarget.value` before calling the state updater. This fixes the Start a new session modal blanking the app or losing focus while editing `Session id` / `Title`, and the modal now submits the completed draft to `create_session`.

31. this change `fix: disambiguate claude code agent naming`
    - Files: `packages/client-web/src/main.tsx`, `packages/cli/src/index.ts`, `quorum.config.json`, `README.md`, `HANDOFF.md`.
    - Work: renamed the built-in `claude-code` adapter participant from generic `Claude` to `Claude Code` in preview data, default config, and CLI fallback. This avoids presenting a local Claude Code agent as if it were an Anthropic API model. Future Anthropic API participants should use explicit model-facing names such as `Claude Sonnet` / `Claude Opus` and the `api-model` adapter.

32. this change `fix: keep chat transcript message-only`
    - Files: `packages/client-web/src/main.tsx`, `packages/client-web/src/styles.css`, `README.md`, `HANDOFF.md`.
    - Work: changed the central Chat transcript to render only `message` events as clean chat bubbles for human prompts and agent/model replies. Operational events such as thinking, floor grants, bids, tool calls/results, phases, and checkpoints now stay in diagnostics/recent activity/checkpoint panels instead of cluttering the conversation.

33. this change `fix: use local claude code cli by default`
    - Files: `packages/daemon/src/adapters/claude-code.ts`, `README.md`, `HANDOFF.md`.
    - Work: changed `claude-code` from default Agent SDK execution to default local `claude` CLI subprocess execution using `claude -p --output-format stream-json`. This reuses the user's existing Claude Code local auth/keychain/session behavior instead of asking for an API key. The subprocess also strips `ANTHROPIC_API_KEY` by default so provider/API-model credentials cannot override local Claude Code login. The old SDK path remains available only when `adapterConfig.transport` is explicitly set to `"sdk"`.

34. this change `fix: add verbose to claude code stream json`
    - Files: `packages/daemon/src/adapters/claude-code.ts`, `packages/daemon/src/room-host.test.ts`, `README.md`, `HANDOFF.md`.
    - Work: added `--verbose` to the default `claude -p --output-format stream-json` subprocess invocation because Claude CLI requires verbose mode for stream-json output in print mode. The fake CLI regression test now fails if `--verbose` is omitted.

35. this change `feat: configure workspace per session`
    - Files: `packages/protocol/src/types.ts`, `packages/protocol/src/schema.ts`, `packages/daemon/src/shared-session-host.ts`, `packages/daemon/src/shared-session-host.test.ts`, `packages/client-web/src/main.tsx`, `README.md`, `HANDOFF.md`.
    - Work: added optional `workspacePath` to `create_session` and the Web UI Session setup modal. Dynamically-created shared sessions now use the requested workspace path instead of always inheriting the initial room path. CLI/subprocess agents receive that path as cwd through `TurnInput.workspacePath`; the local sandbox tool executor is scoped to the same path.

36. this change `feat: send image attachments in chat`
    - Files: `packages/protocol/src/types.ts`, `packages/protocol/src/schema.ts`, `packages/core/src/session-manager.ts`, `packages/core/src/projection.ts`, `packages/daemon/src/gateway/ws-server.ts`, `packages/daemon/src/shared-session-host.ts`, `packages/daemon/src/adapters/api-model.ts`, `packages/daemon/src/gateway/ws-server.test.ts`, `packages/client-web/src/main.tsx`, `packages/client-web/src/styles.css`, `README.md`, `HANDOFF.md`.
    - Work: added image attachments to chat messages. The Web UI lets users attach images, previews them in the composer, sends them through `post_message`, and renders thumbnails in Chat. Message events persist `attachments`; projections include image metadata/data URLs; OpenAI-compatible `api-model` agents receive attached images as multimodal `image_url` content for vision-capable models.

37. this change `feat: add windows nsis installer workflow`
    - Files: `.github/workflows/windows-installer.yml`, `scripts/build-sidecar-bun.ts`, `scripts/bun-sidecar-smoke.ts`, `apps/desktop/src-tauri/src/lib.rs`, `apps/desktop/src-tauri/tauri.conf.json`, `package.json`, `README.md`, `HANDOFF.md`.
    - Work: added a manually-triggered Windows GitHub Actions workflow that builds an unsigned x64 NSIS `.exe` installer and uploads installer/bundle/sidecar artifacts. The Bun sidecar build is now cross-platform and emits both `quorum-sidecar` and `quorum-sidecar.exe` so Tauri resources resolve on macOS and Windows; the Rust desktop shell chooses the platform-appropriate sidecar filename at runtime.

38. this change `fix: make claude code cli test windows-compatible`
    - Files: `packages/daemon/src/room-host.test.ts`, `README.md`, `HANDOFF.md`.
    - Work: fixed the local Claude Code CLI subprocess regression test for Windows runners by using a `.cmd` fake CLI on Windows and the existing shell fake on Unix-like hosts. This keeps the Windows installer workflow blocked on meaningful failures instead of a Unix-only test helper.

39. this change `fix: launch local cli agents through windows shell`
    - Files: `packages/daemon/src/adapters/claude-code.ts`, `README.md`, `HANDOFF.md`.
    - Work: changed the Claude Code CLI adapter to spawn through the Windows shell on Windows. This is required for `.cmd` launchers such as npm-installed Claude Code shims and fixes the `spawn EINVAL` failure surfaced by the Windows installer workflow.

40. this change `fix: add windows desktop icon resource`
    - Files: `apps/desktop/src-tauri/icons/icon.ico`, `README.md`, `HANDOFF.md`.
    - Work: generated a Windows `.ico` resource from the existing 512px desktop PNG icon because Tauri's Windows resource build requires `icons/icon.ico` before NSIS bundling can proceed.

41. this change `feat: continue persisted shared sessions`
    - Files: `packages/protocol/src/types.ts`, `packages/protocol/src/schema.ts`, `packages/core/src/session-manager.ts`, `packages/core/src/types.ts`, `packages/core/src/legacy-agent-adapter.ts`, `packages/daemon/src/persistence/sqlite-store.ts`, `packages/daemon/src/gateway/ws-server.ts`, `packages/daemon/src/shared-session-host.ts`, `packages/daemon/src/adapters/claude-code.ts`, `packages/daemon/src/adapters/codex.ts`, `packages/daemon/src/adapters/base.ts`, `packages/client-web/src/main.tsx`, tests, `README.md`, `HANDOFF.md`.
    - Work: added lossless Quorum-layer session continuation. Shared-session room metadata now persists in SQLite; `list_sessions` includes persisted sessions; `continue_session` lazily rebuilds a session from stored room metadata and append-only events; subscribe snapshots include memory summaries; `SessionManager` restores epoch/last turn from replay so new events continue after the prior head. Agent prompts now include a deterministic Quorum context bundle. Claude Code and Codex persist native session/thread ids in agent-private memory, attempt best-effort resume, and fall back to Quorum context when native resume fails.

42. this change `feat: add context continuity anchors`
    - Files: `packages/core/src/session-manager.ts`, `packages/core/src/session-manager.test.ts`, `README.md`, `HANDOFF.md`.
    - Work: strengthened hidden-state error control by adding a context checksum, seq/hash continuity anchors, and explicit conflict/uncertainty rules to the Quorum context bundle. This does not export model hidden state; it reduces drift by making the authoritative event log and working memory the calibration layer for resumed native sessions.

43. this change `feat: delete persisted sessions from web ui`
    - Files: `packages/protocol/src/schema.ts`, `packages/daemon/src/persistence/sqlite-store.ts`, `packages/daemon/src/gateway/ws-server.ts`, `packages/daemon/src/shared-session-host.ts`, `packages/client-web/src/main.tsx`, `packages/client-web/src/styles.css`, tests, `README.md`, `HANDOFF.md`.
    - Work: added `delete_session` and a left-sidebar delete action. Deleting a session stops any in-memory manager, removes it from the registry/sidebar, and deletes session-scoped SQLite rows for events, snapshots, turns, bids, working memory, shared memory, agent-private native session ids, and the session metadata row. The `echo` adapter remains a deterministic local fake agent with no model/API call.

44. this change `fix: keep deleted final session out of sidebar`
    - Files: `packages/client-web/src/main.tsx`, `packages/daemon/src/gateway/ws-server.ts`, `packages/daemon/src/gateway/ws-server.test.ts`, `README.md`, `HANDOFF.md`.
    - Work: fixed the Web UI sidebar deletion state. The session list now tracks whether sessions have loaded, so an empty persisted list does not fall back to rendering the just-deleted current session. Delete clicks also add a local deleted-session marker so stale snapshots cannot reinsert the deleted room after the optimistic hide. The gateway now broadcasts `session_deleted` to all connected Web UI clients; a regression test covers that broadcast.

45. this change `feat: add strict round-robin scheduler`
    - Files: `packages/protocol/src/types.ts`, `packages/core/src/session-manager.ts`, `packages/core/src/session-manager.test.ts`, `packages/daemon/src/shared-session-host.ts`, `packages/daemon/src/shared-session-host.test.ts`, `packages/client-web/src/main.tsx`, `README.md`, `HANDOFF.md`.
    - Work: implemented real `Round robin` execution. Round-robin sessions persist `schedulerMode: "round-robin"` in room metadata, so continue/restart preserves the mode. `SessionManager` now skips routine bid collection in this mode and grants turns directly in selected participant order, one agent at a time, waiting for each floor release before selecting the next speaker. Tests cover core ordering and WebSocket-created shared sessions with no `bid_submitted` events.

46. this change `fix: use english mode labels in web ui`
    - Files: `packages/client-web/src/main.tsx`, `README.md`, `HANDOFF.md`.
    - Work: removed mixed Chinese/English labels from the Web UI Session setup modal. Mode choices now display as `Open discussion`, `Raise hand`, and `Round robin`; docs were updated to use the same English labels.

47. this change `feat: add web ui language switcher`
    - Files: `packages/client-web/src/main.tsx`, `packages/client-web/src/styles.css`, `README.md`, `HANDOFF.md`.
    - Work: added a lightweight English/Chinese language switcher in the left Connection panel. The selected language is persisted in `localStorage` under `quorum.client.language` and is applied immediately to the main session/chat controls, participants, agent/model panel, credentials modal, session setup modal, and diagnostics panels. The implementation uses a local dictionary and `t()` helper without adding an i18n dependency.

48. this change `feat: release write floor from web ui`
    - Files: `packages/protocol/src/schema.ts`, `packages/core/src/conductor.ts`, `packages/core/src/conductor.test.ts`, `packages/daemon/src/gateway/ws-server.ts`, `packages/daemon/src/gateway/ws-server.test.ts`, `packages/daemon/src/room-host.ts`, `packages/daemon/src/shared-session-host.ts`, `packages/client-web/src/main.tsx`, `packages/client-web/src/styles.css`, `README.md`, `HANDOFF.md`.
    - Work: added explicit `release_write_floor` support. When the human holds the write floor, the Web UI button now remains enabled and changes to `Release write floor`; clicking it releases the state without requiring a chat message. A visible hint explains that sending a message also releases the write floor. Legacy Conductor rooms release the actual workspace lease; shared-session rooms emit matching system events so UI state is explicit.

49. this change `feat: surface agent capabilities and serialize shared edits`
    - Files: `packages/protocol/src/types.ts`, `packages/core/src/legacy-agent-adapter.ts`, `packages/core/src/session-manager.ts`, `packages/core/src/session-manager.test.ts`, `packages/daemon/src/shared-session-host.ts`, `packages/client-web/src/main.tsx`, `packages/client-web/src/styles.css`, `README.md`, `HANDOFF.md`.
    - Work: added optional `ISpeakerAgent.capabilities()` and bridged legacy participant capabilities through `LegacyAgentAdapter`. Shared-session `SessionManager` now checks whether a speaker can edit files; editable turns acquire the daemon `GitWorkspace` write floor, snapshot before speaking, checkpoint dirty workspace changes afterward, emit checkpoint events, and release the lease on completion/cancel/failure. The shared-session host now passes a workspace manager into `SessionManager`, gates workspace operations on `GitWorkspace.init()`, and starts the out-of-band watcher only after init succeeds. The Web UI now displays compact agent/model capability badges for local CLI/API model, files, commands, vision, placeholder, key-required, and health-unknown states.
    - Verification: `pnpm typecheck`, `pnpm test`, and `pnpm --filter @quorum/client-web build` pass.

50. this change `feat: explain run status stages`
    - Files: `packages/client-web/src/main.tsx`, `packages/client-web/src/styles.css`, `README.md`, `HANDOFF.md`.
    - Work: expanded the Web UI run-status banner from coarse shared-session phases into user-facing execution stages: queued locally, daemon accepted, collecting bids, selecting speaker, contacting agent, agent thinking/output, tool running, waiting for tool approval, completed, failed, and completed-without-visible-reply. The status is derived from recent room events, pending approval signals, unresolved tool calls, and whether an agent message appeared after the latest human prompt. Chat remains message-only; these execution details stay in the banner/diagnostics area.
    - Verification: run `pnpm typecheck`, `pnpm test`, and `pnpm --filter @quorum/client-web build` after this change.

51. this change `feat: clarify session modes in web ui`
    - Files: `packages/client-web/src/main.tsx`, `packages/client-web/src/styles.css`, `README.md`, `HANDOFF.md`.
    - Work: added a shared-session mode summary to the diagnostics panel. Open discussion is described as free bidding, Raise hand as explicit floor requests that wait for the active speaker, and Round robin as ordered one-turn-per-agent speaking. For round-robin rooms the panel now shows the selected participant order plus current, completed, and remaining speakers derived from room participants and turn completion events.
    - Verification: run `pnpm typecheck`, `pnpm test`, and `pnpm --filter @quorum/client-web build` after this change.

52. this change `feat: add agent health checks`
    - Files: `packages/protocol/src/schema.ts`, `packages/daemon/src/gateway/ws-server.ts`, `packages/daemon/src/gateway/ws-server.test.ts`, `packages/daemon/src/shared-session-host.ts`, `packages/client-web/src/main.tsx`, `packages/client-web/src/styles.css`, `README.md`, `HANDOFF.md`.
    - Work: added a `check_agents` WebSocket command and `agent_health` response. Shared-session rooms now report first-pass health for agents: echo ready, placeholder adapters unavailable, Codex/Claude Code CLI binary availability, API-model key-env availability, and unknown adapter failures. The Web UI automatically checks health after snapshots and credential saves, exposes a manual check button in Agents & Models, and shows compact healthy/unavailable/unknown badges on participant and room-agent rows. This does not fully prove Claude/Codex native login; that remains verified by the first real CLI turn.
    - Verification: run `pnpm typecheck`, `pnpm test`, and `pnpm --filter @quorum/client-web build` after this change.

53. this change `feat: archive and export sessions`
    - Files: `packages/client-web/src/main.tsx`, `packages/client-web/src/styles.css`, `README.md`, `HANDOFF.md`.
    - Work: added safer session-list management in the Web UI. Archive/Unarchive hides or restores sessions locally via `localStorage` without deleting SQLite data; a sidebar toggle shows archived sessions. Export downloads a JSON bundle for the selected row with room metadata and, when exporting the currently loaded session, transcript events and memory summaries. Delete remains the confirmed hard delete path that clears Quorum's local session rows.
    - Verification: run `pnpm typecheck`, `pnpm test`, and `pnpm --filter @quorum/client-web build` after this change.

54. this change `feat: show context continuity status`
    - Files: `packages/client-web/src/main.tsx`, `packages/client-web/src/styles.css`, `README.md`, `HANDOFF.md`.
    - Work: added a Continuity card to shared-session diagnostics. It surfaces native resume failure warnings as fallback-context state, otherwise shows that the room is continuing from Quorum context without observed native-resume warnings. It also displays the latest memory-summary source seq range. Context checksums remain embedded inside the agent prompt bundle and are not yet exposed as a standalone UI field.
    - Verification: run `pnpm typecheck`, `pnpm test`, and `pnpm --filter @quorum/client-web build` after this change.

55. this change `feat: clarify agent profiles`
    - Files: `packages/client-web/src/main.tsx`, `README.md`, `HANDOFF.md`.
    - Work: upgraded the UI concept from raw agent/model presets to explicit agent profiles. Profiles now carry a role, adapter, provider id, model, and capability metadata; the Agents & Models panel and Session setup modal show those profile summaries instead of provider-like rows. Creating a session from an API-model profile writes `providerId`, `model`, and `role` into `adapterConfig` and stores the role as `persona`. This is the first profile UX slice; custom persisted profile creation/editing remains future work.
    - Verification: run `pnpm typecheck`, `pnpm test`, and `pnpm --filter @quorum/client-web build` after this change.

56. this change `feat: label session lifecycle`
    - Files: `packages/client-web/src/main.tsx`, `packages/client-web/src/styles.css`, `README.md`, `HANDOFF.md`.
    - Work: added first-pass session lifecycle visibility in the Web UI. Sidebar rows now show `active`, `completed`, or `archived` labels derived from local archive state and current shared-session events; exported JSON includes the same lifecycle label. This is UI-derived state only, not a persisted lifecycle schema.
    - Verification: run `pnpm typecheck`, `pnpm test`, and `pnpm --filter @quorum/client-web build` after this change.

57. this change `feat: add turn trace diagnostics`
    - Files: `packages/client-web/src/main.tsx`, `packages/client-web/src/styles.css`, `README.md`, `HANDOFF.md`.
    - Work: added a first-pass observable harness view in the Web UI diagnostics. `Turn Trace` groups existing event-log events by `turnId` and shows speaker, duration, tool-call count, output count, and outcome for recent turns. This is derived from existing room events; backend-native token counts, stdout/stderr, native session ids, and detailed failure categories remain future work.
    - Verification: run `pnpm typecheck`, `pnpm test`, and `pnpm --filter @quorum/client-web build` after this change.

58. this change `feat: configure session permission policy`
    - Files: `packages/client-web/src/main.tsx`, `README.md`, `HANDOFF.md`.
    - Work: added a permission-policy selector to Session setup with `read-only`, `workspace-write`, `approval-required`, and `full-auto`. New session participants receive `adapterConfig.permissionPolicy`; Codex maps it to `sandbox`, Claude Code maps it to `permissionMode`, and API-model participants remain read-only. This is the first UI/config slice; complete enforcement across every native tool path remains future work.
    - Verification: run `pnpm typecheck`, `pnpm test`, and `pnpm --filter @quorum/client-web build` after this change.

59. this change `feat: show image visibility by agent`
    - Files: `packages/client-web/src/main.tsx`, `packages/client-web/src/styles.css`, `README.md`, `HANDOFF.md`.
    - Work: added image-visibility feedback in the chat composer. When attachments are present, the UI lists agents that can inspect image content versus agents that only receive metadata/projection text. Current vision detection covers API-model MiniMax-style profiles; local CLI image file bridging remains future work.
    - Verification: run `pnpm typecheck`, `pnpm test`, and `pnpm --filter @quorum/client-web build` after this change.

60. this change `feat: persist custom agent profiles`
    - Files: `packages/client-web/src/main.tsx`, `packages/client-web/src/styles.css`, `README.md`, `HANDOFF.md`.
    - Work: added local custom API-model profiles in the Agents & Models panel. Users can define profile id, display name, provider, model, role, and vision flag; profiles persist in `localStorage` under `quorum.client.agentProfiles`, can be deleted from the profile list, and appear in Session setup alongside built-in profiles. Creating a session from a custom profile writes provider/model/role metadata into participant config the same way built-in API profiles do.
    - Verification: run `pnpm typecheck`, `pnpm test`, and `pnpm --filter @quorum/client-web build` after this change.

61. this change `feat: persist session lifecycle`
    - Files: `packages/protocol/src/types.ts`, `packages/protocol/src/schema.ts`, `packages/daemon/src/gateway/ws-server.ts`, `packages/daemon/src/gateway/ws-server.test.ts`, `packages/daemon/src/shared-session-host.ts`, `packages/client-web/src/main.tsx`, `README.md`, `HANDOFF.md`.
    - Work: added optional `Room.lifecycle` and a WebSocket `update_session_lifecycle` command. Shared-session rooms persist lifecycle changes by updating the stored room metadata; the gateway broadcasts refreshed session lists. The Web UI Archive/Unarchive action now uses the persisted lifecycle path when connected and keeps the previous local archive set as an offline/fallback compatibility layer. New Web-created rooms start as `active`.
    - Verification: run `pnpm typecheck`, `pnpm test`, and `pnpm --filter @quorum/client-web build` after this change.

62. this change `feat: emit turn trace events`
    - Files: `packages/protocol/src/types.ts`, `packages/core/src/session-manager.ts`, `packages/client-web/src/main.tsx`, `README.md`, `HANDOFF.md`.
    - Work: added `turn_trace` room events for shared-session turns. `SessionManager` records started/ended time, duration, outcome, tool-call count, output count, offset, speaker, and generation after each turn finishes. The Web UI Turn Trace panel now prefers these backend trace events and falls back to deriving traces from older event logs when they are missing. Token counts, native session id exposure, stdout/stderr aggregation, and structured failure categories are still future work.
    - Verification: run `pnpm typecheck`, `pnpm test`, and `pnpm --filter @quorum/client-web build` after this change.

63. this change `fix: make approval-required conservative`
    - Files: `packages/client-web/src/main.tsx`, `README.md`, `HANDOFF.md`.
    - Work: tightened permission-policy mapping for native CLI agents. Until Codex/Claude Code native tool calls are fully bridged through Quorum approval, `approval-required` maps Codex to `read-only` sandbox and Claude Code to default permissions rather than workspace-write/accept-edits. `full-auto` remains the explicit least-restrictive choice.
    - Verification: run `pnpm typecheck`, `pnpm test`, and `pnpm --filter @quorum/client-web build` after this change.

64. commit `b9d8fed` `fix: queue prompts during active turns`
    - Files: protocol agent deltas, legacy adapter bridge, `SessionManager` and tests, README/HANDOFF.
    - Work: added persisted FIFO prompt queueing and structured adapter failure propagation into `turn_failed`/`turn_trace`.

65. commit `ce25a04` `fix: surface codex cli failures`
    - Files: Codex adapter and adapter tests, README/HANDOFF.
    - Work: updated Codex JSONL parsing for current event shapes and made spawn, stderr, exit, auth, empty-output, and one-shot resume fallback observable.

66. commit `417476d` `feat: enforce shared session modes`
    - Files: protocol room scheduler, arbiter/session state and tests, shared host, README/HANDOFF.
    - Work: enforced addressed targets, no-consecutive speaking, raise-hand floor requests, bounded open follow-ups, strict round-robin, and mandatory final wrap-up.

67. commit `b7ea29e` `feat: restore shared memory and bound attachments`
    - Files: core event/memory/projection paths, SQLite, API model and gateway, protocol validation and tests, README/HANDOFF.
    - Work: restored compaction/shared memory across restart, persisted shared memory with versions, removed image data URLs from text context, limited attachment payloads, and sent vision models only current-epoch images.

68. this change `fix: align profiles lifecycle and docs`
    - Files: `packages/client-web/src/main.tsx`, `README.md`, `HANDOFF.md`.
    - Work: made built-in profile labels disclose their actual provider model ids, made persisted room lifecycle authoritative over legacy localStorage state, and removed stale placeholder/test-count documentation.
    - Verification: `pnpm typecheck`, the full test suite, and the Web production build pass.

69. this change `fix: verify cli adapter compatibility`
    - Files: `packages/daemon/src/shared-session-host.ts`, `README.md`, `HANDOFF.md`.
    - Work: health checks now inspect Codex and Claude Code help output for the non-interactive flags Quorum requires, without sending a model request. Native login remains verified by the first real turn.

70. this change `fix: restore queued prompts after restart`
    - Files: `packages/core/src/session-manager.ts`, its tests, `README.md`, `HANDOFF.md`.
    - Work: reconstructs queued-but-not-activated human prompts from event-log queued markers and resumes the FIFO automatically when a shared session manager starts. Also fixes a graceful-stop race where an aborted turn attempted to enqueue `finishTurn` after the command mailbox had stopped.

71. this change `feat: add native workspace folder picker`
    - Files: Tauri Rust command/dependency, Web Session setup and styles, `README.md`, `HANDOFF.md`.
    - Work: adds a system-native directory chooser in the desktop app, seeded from the current workspace path. Session setup keeps manual absolute-path entry and explains that browser-only mode cannot expose a local absolute directory path.

72. this change `feat: add provider model catalogs`
    - Files: Web credential/profile/session selection, API-model adapter/tests, `README.md`, `HANDOFF.md`.
    - Work: configured provider credentials now unlock multiple exact model ids as independent participants, with a flagship marker. The 2026-07 catalog includes DeepSeek V4 Pro/Flash, Zhipu GLM-5.1/5/4.7/5V, MiniMax M2.7/M2.5, current OpenAI defaults, and current Anthropic Claude models. Anthropic profiles use the native Messages API including base64 vision input; local CLI agents retain their own default model configuration.
    - Verification: `pnpm typecheck`, all 84 tests, the API-model adapter tests, and the Web production build pass. Automated browser screenshot inspection was unavailable in this session.

What is already implemented:

- The meeting handoff and guide were copied into this repo:
  - [`AGENT_FRAMEWORK_HANDOFF.md`](./AGENT_FRAMEWORK_HANDOFF.md)
  - [`AGENT_FRAMEWORK_GUIDE.html`](./AGENT_FRAMEWORK_GUIDE.html)
  - [`docs/architecture/`](./docs/architecture/)
- `@quorum/protocol` now has the shared-session contract: `SessionPhase`, `SessionEvent`, `SessionCommand`, `Bid`, `ISpeakerAgent`, `AgentRuntime`, `LLMAdapter.chatStream()`, and memory summary types.
- `@quorum/core` now has the first shared-session kernel:
  - `SessionManager`
  - `CommandMailbox`
  - `Arbiter`
  - `LegacyAgentAdapter`
  - explicit session phase transition validation
  - `projectSessionState()` replay projection
  - deterministic working-memory summary creation and `SessionManager.compactWorkingMemory()`
- `@quorum/daemon` now bootstraps shared-session SQLite tables for sessions, events,
  snapshots, turns, bids, memory, agent configs, provider configs, and migrations.
- `@quorum/daemon` now has `startSharedSessionRoom()`, which wraps existing adapters through `LegacyAgentAdapter` and routes human prompts through `SessionManager`.
- Shared-session room metadata is persisted, and `continue_session` can rebuild prior sessions from SQLite without copying events or changing session ids.
- Persisted sessions can be deleted from the Web UI; deletion clears Quorum's local session cache/transcript/memory/native-session rows for that session.
- The CLI can choose the new kernel with `QUORUM_SESSION_KERNEL=shared`; without that env var it keeps the legacy `Conductor` path.
- `quorum.webui-smoke.config.json` provides a no-credential echo-agent config for manual Web UI testing. Use `QUORUM_SESSION_KERNEL=shared QUORUM_CONFIG=quorum.webui-smoke.config.json QUORUM_DB_PATH=.quorum/webui-smoke.sqlite pnpm dev`.
- `@quorum/client-web` can now detect shared-session events and display phase, active speaker, bid queue, selected speaker, and debug events.
- `pnpm smoke:shared` starts a shared-session host, posts over WebSocket, and verifies bid/phase/echo response events.
- `packages/daemon/src/sidecar.ts` starts a shared-session sidecar on `127.0.0.1:0`, prints `{ port, token, bootId }`, and requires the token for WebSocket connections.
- `pnpm smoke:sidecar` starts the sidecar entry, validates the handshake, performs a token-authenticated WebSocket round trip, and exercises a subprocess check.
- `pnpm sidecar:node:build` creates a Node-runtime fallback artifact in `dist-sidecar/node`.
- `pnpm sidecar:node:smoke` builds that artifact, starts it, validates the same sidecar handshake and WebSocket round trip.
- `pnpm packaging:env` installs Bun and Rust/Cargo into `.tools/` without modifying global shell startup files.
- `pnpm sidecar:bun:build` compiles `packages/daemon/src/sidecar.ts` into `dist-sidecar/bun/quorum-sidecar` on Unix-like hosts and `dist-sidecar/bun/quorum-sidecar.exe` on Windows, plus a compatibility copy under the other filename for Tauri resource bundling.
- `pnpm sidecar:bun:smoke` validates the compiled Bun sidecar with SQLite, token-authenticated WebSocket, and a shared-session echo turn.
- `apps/desktop` is a Tauri 2 shell. Its Rust layer manages the sidecar process, parses the stdout handshake, and exposes `get_sidecar_connection()` to the Web UI.
- The Web UI detects Tauri at startup and replaces the default `ws://127.0.0.1:8787` connection with the sidecar URL returned by `get_sidecar_connection()`.
- The desktop bundle now includes `apps/desktop/src-tauri/icons/icon.ico` for Windows resource generation.
- Tests now cover SQLite projection tables, legacy event-table migration, replay projection, and a three-agent shared-session open discussion through queued bids.
- Shared-session `AgentRuntime.callTool()` now has a human approval loop wired through `approve_tool`; it emits requested/granted/denied approval signals, executes approved safe room tools (`read_room`, `post_note`, `request_review`, `hand_off`, `raise_hand`), and records `tool_call` / `tool_result` events. Approved external command tools such as `Bash` now route through a daemon-provided local sandbox executor with workspace cwd isolation, timeout, output truncation, allowlisted tool names, and dangerous-command blocking.
- WebSocket `replay_projection` returns a projected shared-session state from `afterSeq`, and the Web UI has a Replay panel for phase/speaker/bid-state checks.
- WebSocket `continue_session` returns `session_continued`; snapshots include memory summaries so restored sessions bring back chat history and working memory.
- WebSocket `get_credentials` / `set_credential` now back the Web UI provider credential modal. Provider API keys/base URLs/models are persisted in local SQLite `provider_configs`, immediately applied to `process.env`, and returned to the browser only as masked previews.
- The Web UI now prioritizes the primary workflow: session/room selection on the left, chat/session stream and composer in the center, participants plus agent/model configuration on the right. Provider keys are hidden behind an API credential modal and framed as credential sources for API-model agents, not as selectable webchat sessions. Diagnostics such as replay, memory, tool activity, and checkpoints are collapsed by default. In shared-session mode, the legacy policy segmented control is disabled because `set_policy` is not implemented for the new kernel yet.
- The Web UI surfaces compact agent/model capability badges so users can distinguish local CLI agents, API-model agents, file-editing agents, command/tool-capable agents, vision-capable agents, placeholder entries, key-required entries, and unknown health states. These are currently declared/preset capabilities, not a full runtime health probe.
- The run-status banner now explains the execution stage instead of only showing coarse phase labels. It can surface queueing, scheduler wait, agent contact, thinking/output, running tools, waiting approval, failure, and completed-without-visible-reply states.
- Shared-session diagnostics now explain mode semantics and show round-robin order/current/completed/remaining speakers.
- Agent health checks are available through WebSocket `check_agents` and the Web UI. Current checks cover CLI binary and required-flag compatibility, API key env availability, placeholders, echo readiness, and unknown adapters.
- The Web UI session sidebar supports persisted Archive/Unarchive, JSON Export, and confirmed hard Delete. A legacy localStorage archive set is used only for old rooms that do not yet have a persisted lifecycle field.
- Shared-session diagnostics include a Continuity card for native resume fallback warnings and latest memory-summary seq ranges.
- Agents & Models now presents agent profiles with role/provider/model/capability summaries. Provider credentials remain separate hidden credential sources for API-model profiles.
- Session rows and exports show the persisted lifecycle (`active`, `completed`, or `archived`) when present; UI derivation is only a compatibility fallback for old room records.
- Diagnostics include a derived Turn Trace panel that groups recent turns by `turnId` and shows speaker, duration, tool count, output count, and outcome.
- Session setup exposes a permission-policy selector and writes the selected policy into new participants' adapter config.
- Chat image attachments now show per-session visibility: vision-capable agents versus metadata-only agents.
- The Web UI supports locally persisted custom API-model profiles. They are available in Session setup and map to provider/model/role adapter config.
- Session lifecycle is persisted in room metadata via `Room.lifecycle` and `update_session_lifecycle`; Archive/Unarchive uses this path when connected.
- Shared-session turns emit `turn_trace` events; the Web UI Turn Trace panel prefers backend traces and falls back to event-derived traces.
- Permission policy mapping is conservative for native CLI agents: `approval-required` does not grant workspace-write while native approval bridging is incomplete.
- Prompts received during an active or settling turn are now appended immediately and placed in a FIFO pending queue. Each queued prompt receives its own epoch and bid collection after the active turn. `AgentDelta.error` carries adapter failures into structured `turn_failed` and `turn_trace` payloads instead of reporting an empty successful turn.
- The Codex adapter now parses current `item.type` JSONL records as well as the older `item.item_type` shape. It captures spawn errors, stderr, non-zero exits, auth/argument/timeout categories, and empty successful output; all become structured failed turns. Native resume receives one context-bundle fallback attempt and cannot recurse indefinitely.
- Shared-session mode semantics now reach the scheduler: addressed prompts filter eligible bidders, `noConsecutive` compares the actual last speaker id, Raise hand emits explicit `floor_request` events for bids and waits for the current turn, and Open discussion recollects follow-up bids within `maxTurnsPerTopic`. The final budgeted turn, and the final round-robin speaker, receive a mandatory concrete wrap-up prompt that preserves unresolved disagreement for Continue Session.
- Session restore now initializes the auto-compaction cursor from persisted summaries and reloads versioned shared memory from the event store; shared-memory writes use SQLite compare-and-set and appear in the Context Bundle. Text projections and context summaries contain image metadata only. API-model vision turns receive only current-epoch attachments, and the gateway enforces six images, 5 MB per image, and 12 MB total.
- Shared-session editable agent turns now use `GitWorkspace` write-floor serialization and per-turn checkpointing. `SessionManager` acquires/releases the workspace lease for agents with `canEditFiles`, records checkpoints when files changed, and waits for workspace initialization before git operations.
- Local CLI agents such as Claude Code use shell launching on Windows so `.cmd` shims work.
- Claude Code and Codex native session/thread ids are stored in agent-private memory and resumed best-effort. Resume failure records a diagnostic warning and falls back to the Quorum context bundle. The context bundle includes checksum/seq/hash anchors and error-control rules so native hidden memory is treated as advisory when it conflicts with Quorum state.
- Working-memory summaries can be created, persisted through `SqliteStore`, triggered through WebSocket `compact_memory`, inspected in the Web UI Memory panel, and automatically compacted after turns once configured event thresholds are reached.
- Verification: `pnpm typecheck`, `pnpm test`, `pnpm --filter @quorum/client-web build`, `pnpm smoke:shared`, `pnpm smoke:sidecar`, `pnpm sidecar:node:smoke`, `pnpm sidecar:bun:smoke`, `pnpm desktop:check`, and `pnpm desktop:build` pass on macOS arm64. The **Windows Installer** GitHub Actions workflow now exists for Windows x64 NSIS artifact validation.

What is not implemented yet:

- **Installer-grade signed release is not done.** There is no signing/notarization and no auto-update yet. An unsigned Windows x64 NSIS test installer can be produced by manually running the **Windows Installer** GitHub Actions workflow; artifact/manual install validation still needs to be performed on a Windows machine.
- **Desktop double-click launch shell is scaffolded and macOS arm64 bundles build.** `apps/desktop` can launch the Web UI inside Tauri and start the compiled Bun sidecar through the Rust layer. `pnpm desktop:build` produces an unsigned `.app` and `.dmg`; the `.app` contains `Contents/Resources/sidecars/quorum-sidecar`.
- **Developer one-command launch exists.** Use `pnpm dev` for the legacy kernel or `QUORUM_SESSION_KERNEL=shared pnpm dev` for the new shared-session kernel.
- **Local sidecar entry exists and Bun compile is verified.** The sidecar can be run through tsx with `pnpm smoke:sidecar`, compiled with Bun using `pnpm sidecar:bun:build`, and verified with `pnpm sidecar:bun:smoke`.
- **Node-runtime fallback exists.** It is not a single binary, but `pnpm sidecar:node:build` creates a smoke-tested fallback artifact. Keep it as the fallback route if Bun compile regresses on another platform.
- **Rust/Cargo exists only in the project-local toolchain.** Source `.tools/packaging-env.sh` before running direct Cargo/Tauri commands, or use `pnpm desktop:check`.
- The Web UI now exposes the new shared-session phase and bid queue, but it is still a minimal projection. It does not yet provide full replay controls, policy tuning, rich arbitration score inspection, or memory inspection.
- Richer memory policy tuning UI, adapter-level native tool bridging, full timeline replay UI, signed installer pipeline, updater, and full cross-platform desktop validation remain follow-up work.

Recommended next task for the new agent:

1. Keep `legacy-conductor` as a fallback while migrating.
2. Expand the shared-session UI from a minimal projection into a real debugging workflow:
   - richer arbitration score inspection
   - settling-window state
   - event payload JSON expansion
   - replay controls
   - memory inspector
3. Decide when to flip the default kernel from `legacy-conductor` to `shared-session`.
4. Run and test the new kernel with:

```bash
pnpm install
QUORUM_SESSION_KERNEL=shared pnpm dev
pnpm smoke:shared
pnpm smoke:sidecar
pnpm sidecar:node:smoke
pnpm sidecar:bun:smoke
pnpm desktop:check
pnpm desktop:build
pnpm typecheck
pnpm test
```

5. Start the packaging P0 spike from [`AGENT_FRAMEWORK_HANDOFF.md`](./AGENT_FRAMEWORK_HANDOFF.md):
   - Bun compile compatibility with SQLite. This is now verified on macOS arm64 with Bun 1.3.14 by using Bun's `bun:sqlite` path inside `SqliteStore`.
   - Playwright/browser-agent compatibility. This is still open.
   - Windows and macOS x64 build compatibility. Still open.
   - fallback decision: Bun single binary vs Node runtime + JS bundle/resources. Current default should be Bun single binary; Node fallback remains smoke-tested.
6. Next implementation target: app launch smoke against the generated `.app`, Windows installer validation, signing/notarization, updater, and platform-specific sidecar path tests.

## TL;DR
Quorum is a TypeScript/pnpm monorepo: a human + multiple heterogeneous coding agents (Claude Code, Codex, plain API models) collaborate in **one shared group chat on one git branch**. A **Conductor** decides who holds the speaking floor; an append-only **EventLog** is the source of truth; everyone edits **one shared working dir** serialized by a write-floor lock with per-turn checkpoint commits. Milestones **M0–M4 are in place and M5 (web client) is wired**; **M6 (remote access) is not started**. See `SPEC.md` for the full design and `README.md` for the pitch.

## Run it
Requires Node ≥ 20, pnpm.
```bash
pnpm install
pnpm dev      # ONE command: daemon (ws://127.0.0.1:8787) + web client (http://127.0.0.1:5173)
              # Ctrl-C stops both. Override the daemon port with QUORUM_PORT=8799 pnpm dev
```
Then open **http://127.0.0.1:5173** in a browser (NOT 8787 — that's the WebSocket port; hitting it with a browser shows "Upgrade Required", which is normal).

Other scripts: `pnpm demo` (dependency-free 2-agent echo demo), `pnpm test` (vitest), `pnpm typecheck` (tsc -b), `pnpm smoke` (M0 EventLog check).

**Gotcha:** only one process can hold port 8787. If a standalone daemon is already running you'll get `EADDRINUSE` — stop it first (`lsof -nP -i :8787` to find it).

## Repo map
```
apps/
  desktop/    Tauri 2 desktop shell
packages/
  protocol/   zero-dep types + zod wire schema (the contract)
  core/       EventLog, Conductor, the 3 floor policies, projection, room-tools — DEPENDENCY-FREE, tested
  daemon/     adapters (claude-code/codex/api-model/echo), GitWorkspace, SqliteStore, WS gateway, moderator, room-host wiring
  cli/        minimal launcher: defines the room and calls startRoom()
  client-web/ React/Vite client (WS to the daemon)
scripts/      dev.ts (pnpm dev launcher) · demo.ts · smoke.ts
SPEC.md       full design (Chinese): data model, Conductor state machine, adapter contracts, WS protocol §10, milestones §12
```

## Mental model (read before editing)
- **EventLog** (`core/src/event-log.ts`) — append-only, monotonic `seq`, single source of truth. `append/on/replay/headSeq`.
- **Conductor** (`core/src/conductor.ts`) — state machine (`idle/active/collecting`) that grants the speaking floor and runs turns. It **stamps each event's author = current floor holder** (anti-spoofing). A human message/interrupt always preempts the active turn.
- **Floor policies** (`core/src/policies/`): `free-for-all` (agents raise hands), `directed` (only @-addressed agents), `moderated` (a model names the next speaker). Switch at runtime via the gateway's `set_policy`.
- **GitWorkspace** (`daemon/src/workspace/git-workspace.ts`) — single branch, write-floor mutex (returns a `WriteLease`), per-turn checkpoint commit, and an **out-of-band watcher that runs `git add -A` + commit when files change while no turn holds the floor**. ⚠️ Because of this, **don't leave uncommitted junk in the tree while the daemon is running** — it can get auto-committed as a "human checkpoint."
- **Adapters** (`daemon/src/adapters/`) — each agent keeps its **native tool-calling**; the framework only projects the transcript delta in and normalizes native events back onto the log. Heavy SDKs (`@anthropic-ai/claude-agent-sdk`, `zod`) are **imported lazily/dynamically** so the daemon loads even when they're absent.
- **Room MCP tools** (`core/src/room-tools.ts`, SPEC §9): `raise_hand`, `read_room`, `request_review`, `hand_off`, `post_note` — translated into room events. Wired into Codex MCP calls and the optional Claude Code SDK transport's in-process MCP server; the default Claude Code CLI transport prioritizes local CLI auth/session reuse.
- **WS gateway** (`daemon/src/gateway/ws-server.ts`, SPEC §10): client→server `subscribe/post_message/interrupt/set_policy/approve_tool/take_write_floor/release_write_floor/rollback`; server→client `snapshot/event/error`. Binds 127.0.0.1:8787.

## Where to change common things
- **Agent/model config**: the Web UI right sidebar should be agent/model oriented. Users select or configure participants such as `codex`, `claude-code`, OpenClaw-style adapters, or direct API model agents such as DeepSeek/GLM/MiniMax. `claude-code` is the local Claude Code agent and should be displayed as `Claude Code`, not generic `Claude`; Anthropic API models should use explicit model names and the `api-model` adapter. Provider credentials are only hidden credential sources for API-model agents; do not put API key inputs directly in the persistent sidebar. The credential modal has built-in presets for OpenAI, DeepSeek, Zhipu, MiniMax, and Anthropic, and must support custom providers beyond presets. Credentials are persisted locally in SQLite and applied to daemon `process.env`; the browser only receives masked previews.
- **Session creation**: the Web UI Session setup modal calls `create_session`; the shared-session host keeps an in-memory multi-session registry and the gateway routes snapshots/events by room id. The modal can set a per-session `workspacePath`; CLI agents run from that path and sandboxed tool execution is scoped there. Dynamically-created sessions persist room metadata and can be continued after daemon restart. Round robin uses strict participant order, Raise hand persists explicit floor requests before arbitration, and Open discussion recollects follow-up bids within the room turn budget.
- **Session setup form state**: keep editable form state local to `SessionSetupModal`. Do not pass React event objects into function-style state updaters; copy `input.currentTarget.value` first, then update state with the plain value. Otherwise React can null `currentTarget` before the updater runs and the modal can crash while typing.
- **Run visibility**: message sends should never appear silent. `packages/client-web/src/main.tsx` derives `RunStatus` from local submit time and room events; keep this banner updated when adding new phases or schedulers.
- **Chat vs log**: the central Chat transcript should remain message-only. Keep non-message room/session events in diagnostics, recent activity, tool activity, memory, replay, or checkpoint panels; do not reintroduce raw event rows into the primary chat stream.
- **Web UI language**: `packages/client-web/src/main.tsx` has a lightweight local `zhText` dictionary and `t()` helper. The language switcher lives in the left Connection panel and persists `quorum.client.language` in `localStorage`. When adding user-visible Web UI text, route it through `t()` or add a dictionary entry.
- **Image chat**: `MessageBody.attachments` supports image data URLs. The Web UI handles upload/preview/display, `post_message` transports attachments, and `api-model` turns convert only current-epoch images to OpenAI-compatible `image_url` content. CLI agents see attachment metadata, not data URLs; add a safe file bridge before claiming local CLI vision support.
- **API-model failures**: `packages/daemon/src/adapters/api-model.ts` must never silently complete on missing keys, HTTP errors, or empty model responses. It should emit a visible message so the run-status banner and transcript explain what happened.
- **The room (agents, policy, workspace)**: the initial room is still defined in `quorum.config.json` at the repo root (or `QUORUM_CONFIG=<path>`). `packages/cli/src/index.ts` loads it via `loadConfig()` and falls back to built-in defaults if the file is missing. New Web UI sessions may override `workspacePath` per session.
- **Add an agent**: currently still add a `ParticipantDescriptor` to `participants[]` with an `adapter` + `adapterConfig`. `claude-code` runs the local `claude -p --verbose --output-format stream-json` CLI subprocess by default and should reuse Claude Code local auth; it strips `ANTHROPIC_API_KEY` unless `adapterConfig.inheritApiKeyEnv` is explicitly true. Set `adapterConfig.transport: "sdk"` only for the optional Agent SDK path. `codex` needs the `codex` CLI on PATH; `api-model` is any OpenAI-compatible endpoint; `echo` is the built-in fake.
- **Moderator model**: `packages/daemon/src/moderator.ts`. Configured via `policy.moderatorModel` / `QUORUM_MODERATOR_MODEL` (default `gpt-4o-mini`) / `QUORUM_MODERATOR_BASE_URL`, key from `OPENAI_API_KEY`. Degrades to "yield to human" on any failure.

## Milestone status (SPEC §12)
- **M0** skeleton, protocol+zod, SQLite, EventLog — done.
- **M1** single agent + human + WS gateway + minimal client — done.
- **M2** Conductor free-for-all + 2nd agent + `raise_hand` + human interrupt — done.
- **M3** GitWorkspace write-floor + per-turn checkpoint + out-of-band detection + diff/rollback (gateway `rollback`/`approve_tool`/`take_write_floor`) — done.
- **M4** `directed` + `moderated` policies + runtime `set_policy`; model-backed moderator — done.
- **M5** React web client — **in place and connects**; recent commits (`2cc772e`/`28fccf9`/`384c311`) wired the tool-approval / rollback / take-write-floor / reconnect interactions (verify them end-to-end, plus inline diff view + multi-client consistency, against SPEC §12 before calling it complete).
- **M6** remote (relay/E2E/pairing QR, more providers) — **not started**.

## Suggested next steps
1. Add a safe local-file bridge for CLI agents that have native vision support.
2. Persist custom agent profiles server-side instead of browser-only localStorage.
3. Validate the unsigned NSIS artifact on a real Windows x64 machine, then add signing/updater work.

## Conventions / gotchas
- `@quorum/core` stays **dependency-free**; anything needing network/env/SDKs lives in `@quorum/daemon`.
- Verify before claiming with `pnpm typecheck`, `pnpm test`, the Web build, and the relevant sidecar/desktop smoke commands. The 2026-07-13 provider-catalog pass ends with 84 passing tests; shared-session and source-sidecar smoke coverage passed immediately before it.
- Debug artifacts (root `*.png`, `.playwright-mcp/`) are gitignored — keep them out of commits.
- **Git worktrees:** `main` is checked out at `/Users/matthew/Projects/quorum`; a second worktree (`test-framework-debug`) also exists. A branch can only be checked out in one worktree at a time, so don't try to `git checkout main` in the second one.

## Recent history
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

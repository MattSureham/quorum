# HANDOFF

Working handoff for an agent picking up **Quorum**. Current as of **2026-07-16** on `main`. 中文版见 [`HANDOFF.zh.md`](./HANDOFF.zh.md)。

> 2026-07-07 architecture update: Quorum is being migrated to the shared-session architecture from the agent-framework meeting. New implementation handoff: [`AGENT_FRAMEWORK_HANDOFF.md`](./AGENT_FRAMEWORK_HANDOFF.md). Full copied docs live in [`docs/architecture/`](./docs/architecture/).

## Current State For The Next Agent

### 2026-07-16 synchronization checkpoint

- The repository was clean and synchronized with `origin/main` at the handoff checkpoint. Windows document packaging was accepted on implementation baseline `0ba5255`; later review remediation is recorded in newer dated sections above the original feature history.
- [Windows Packages run 29470431610](https://github.com/MattSureham/quorum/actions/runs/29470431610) is the current packaged acceptance baseline on `fabc213`. It passed all 150 tests, parsed a real PDF and DOCX through the compiled Windows sidecar, built the Web UI and unsigned NSIS installer, validated the portable layout, and uploaded the portable, sidecar, bundle-output, and NSIS artifact groups. A tester can download the portable artifact directly; cloning or pulling the repository is not required to run it.
- Document support is implemented across `packages/protocol/src/schema.ts`, `packages/daemon/src/attachments/document-extractor.ts`, the WebSocket gateway, `packages/core/src/session-manager.ts`, and `packages/client-web/src/main.tsx`. `scripts/bun-sidecar-smoke.ts` is the packaging regression path and must continue exercising real PDF and DOCX files on Windows.
- Remaining release boundaries are explicit: scanned PDFs need OCR, legacy `.doc` is unsupported, browser click/screenshot QA was unavailable in this environment, and real-machine portable interaction is still manual acceptance. Do not describe these as implemented or verified. Full Xcode is also unavailable locally, so this feature did not trigger a fresh macOS bundle build.

### 2026-07-16 review-remediation local acceptance

- The independent P1/P2/P3 findings reported on 2026-07-16 are implemented through `e335e1f..7f548c9`: explicit neutral workspaces, round-robin recovery idempotency, actual DOCX expansion limits, Codex process-tree termination ordering, detached attachment payloads, stale-socket filtering, passive Markdown/CSP rendering, concurrent composer limits, newest-turn run status, and Node fallback runtime packaging.
- Current local validation is green: `pnpm typecheck`; `pnpm test` with **150/150** tests across 24 files; Web production build; EventLog, shared-session, source-sidecar, Node fallback, and Bun compiled sidecar smokes; and `pnpm desktop:check` including Rust `cargo check`. Tauri reports the configured CSP. `git diff --check` passes.
- Windows Packages run [29470431610](https://github.com/MattSureham/quorum/actions/runs/29470431610) completed successfully on this exact `fabc213` checkpoint in 8m26s. It covered all 150 tests, the compiled Windows sidecar's real PDF/DOCX smoke, Web/CSP build, unsigned NSIS, portable assembly/layout validation, and all four uploads. The sole annotation is GitHub's deprecation notice for the Node 20 runtime inside current action versions. Real Windows portable interaction and adversarial `.cmd` testing remain manual release boundaries.

### 2026-07-16 Playwright UX remediation: Echo and sole-agent turns

- Session setup no longer adds `permissionPolicy` to Echo's strict adapter config. Echo payloads now pass the same network schema used by the gateway; Codex, Claude Code, API models, and OpenClaw retain their adapter-specific permission mappings.
- Bid-based open-discussion/raise-hand Sessions with one eligible agent now become idle after its first completed response. They no longer recollect the same sole bid until the six-turn safety ceiling or create a duplicate wrap-up response. Explicit round-robin remains the mechanism for intentional repeated single-agent passes.
- Frontend adapter mapping, protocol payload, and core scheduler regressions pass 42 focused tests; typecheck passes. Responsive/modal/attachment Playwright findings are tracked in the following work, so this checkpoint is not yet the final UX acceptance.

### 2026-07-16 explicit workspace boundary remediation

- `create_session` no longer falls back to the bootstrap room's workspace when `workspacePath` is omitted. A blank New Session workspace is now neutral on the server as well as in the UI; the folder picker also stops using the active room path as an implicit starting selection.
- Neutral CLI working directories now use a bounded readable slug plus a SHA-256-derived Session-id fingerprint. `..` cannot resolve to the temporary root, and ids such as `room/a` and `room?a` cannot collide after slug normalization. New network-created Session ids are bounded to 128 path-safe characters and reject relative path segments.
- Regression coverage verifies a bootstrap room with an explicit repository cannot leak it into a newly-created neutral Session, and verifies traversal/collision resistance. The targeted schema, CLI safety, and shared-host suites pass with 22 tests.

### 2026-07-16 restart idempotency and failed-turn scheduling

- Round-robin prompt activation now persists the same `phase_changed.promptSeq` recovery anchor as bid-based modes before selecting the first speaker. A queued round-robin prompt that completed normally is therefore excluded from startup recovery instead of executing again and potentially repeating tools or file edits.
- Soft target-round wrap-up is evaluated only after the scheduler checks whether the last sole candidate failed with no remaining bids. A one-agent failure now returns to human control once rather than immediately running the same agent again as wrap-up.
- Core regressions recreate a SessionManager over the same event store after two round-robin prompts and assert the completed-turn count remains unchanged; a separate test asserts a failing sole soft-round candidate produces exactly one `turn_failed` and no wrap-up request. All 27 SessionManager tests pass.

### 2026-07-16 DOCX actual-expansion hardening

- DOCX validation no longer trusts `Entry.uncompressedSize` as the enforcement source. Central-directory values remain an early rejection hint, but every non-directory entry is now streamed sequentially and counted against 25 MB per-entry and 50 MB total actual expansion limits. `word/document.xml` has an additional 8 MB actual-size ceiling before any XML parsing.
- DOCX timeout now aborts an `AbortController`, destroys the active decompression stream, and closes the ZIP. The prior `Promise.race` path could report failure while Mammoth continued parsing; Mammoth has been removed from the daemon dependency graph. Validated main-document OOXML is parsed with `@xmldom/xmldom`, rejects DTD/entity declarations, and extracts paragraphs, tabs, and line breaks without opening the archive a second time.
- A crafted regression compresses 8.1 million text characters below 100 KB while declaring the entry as 1 KB; it is rejected by the actual-byte limit without reaching XML parsing. The document/gateway suites pass 19 tests, typecheck passes, and the compiled Bun sidecar smoke still extracts a real PDF and DOCX.

### 2026-07-16 Codex terminal-process ordering

- A Codex `turn.failed` record now captures the structured failure and immediately starts process-tree termination, but does not yield the terminal adapter event until the child `close` event has been observed. SessionManager cannot finalize the turn, checkpoint, or release the shared workspace lease while the failed CLI may still run.
- Codex subprocesses use a dedicated process group on Unix-like systems; termination sends group `SIGINT`, escalates to `SIGKILL`, and then waits for actual closure. Windows uses `taskkill /PID ... /T`, escalates with `/F`, and likewise waits. Abort, explicit interrupt, native-resume failure, and early generator return share the same idempotent termination promise.
- A cross-platform fake CLI emits `turn.failed`, waits, and attempts to write a survival marker. The adapter yields failure in bounded time and the marker remains absent after its scheduled write point, proving the process tree was gone before control returned. All 9 Codex adapter tests and typecheck pass locally and in Windows run `29470431610`; real-machine adversarial `.cmd` interaction remains manual release acceptance.

### 2026-07-16 bounded attachment replay

- SQLite message events now retain attachment metadata and extraction status only. Original data URLs and extracted document bodies are transactionally stored in the Session-scoped `attachment_payloads` table, so `replay(0)`, WebSocket subscribe snapshots, memory compaction, and Context Bundle scans no longer parse or resend every historical base64 payload.
- Legacy databases are migrated once: event rows containing attachment `dataUrl` fields are detached into the payload table without changing event ids or sequence numbers. Session deletion removes the detached payload rows. An `EventLog.readAttachment()` lookup and bounded `get_attachment` WebSocket command retrieve one payload by room/event/attachment id; the Chat UI renders a load button for historical image/document cards and keeps newly posted live attachments immediate.
- Composer file reads are serialized against a ref-backed current attachment set. Two simultaneous paste/upload batches can no longer both validate against stale counts and exceed the six-file/20 MB request limits; a rejected batch leaves prior composer state intact.
- Regression coverage verifies new-event detachment, legacy migration, on-demand hydration, deletion, gateway success/error replies, and protocol bounds. The targeted persistence/gateway/schema suites pass 33 tests; this work is included in the 150-test local and Windows run `29470431610` passes above.

### 2026-07-16 passive chat rendering and stale-socket isolation

- Agent-authored Markdown images can no longer initiate HTTP(S), localhost, relative-path, protocol-relative, or `blob:` loads. Only bounded embedded PNG/JPEG/GIF/WebP data URLs pass both the React Markdown URL transform and sanitizer protocol gate; SVG and other active data formats remain blocked.
- Tauri now has an explicit CSP: images are limited to self/data/blob, object/frame/form surfaces are disabled, and connections are limited to self, Tauri IPC, and loopback HTTP/WebSocket for the sidecar and development server. `tauri info` recognizes the policy and Rust `cargo check` passes.
- The long-lived WebSocket listener now uses a tested source-socket/active-room filter. Messages from replaced sockets, late events for another room, and stale Continue/snapshot replies cannot enter the active transcript. Attachment responses remain request-correlated and room-checked separately.
- Nine targeted rich-message, socket-filter, and desktop-config tests pass; typecheck, Web production build, and `desktop:check` pass. Full Xcode is not installed, so no macOS bundle was produced at this checkpoint.

### 2026-07-16 latest-turn run status

- Run status now projects the lifecycle of the newest `turn_started` after the current human prompt and accepts only a matching terminal event. A failed earlier participant cannot mask a later agent that is contacting, thinking, speaking, or collecting bids.
- An interrupt associated with the active turn is shown as `Cancelling turn` while the adapter/process is still stopping. Its matching `turn_cancelled` terminal becomes `Interrupted`; it can no longer fall through the shared Session's generic last-terminal marker and appear as `Completed`.
- The lifecycle helper also supports legacy/malformed streams without phase events and has focused regressions for old-failure/new-running precedence and interrupt-to-cancel convergence. Five run-status tests pass and are included in the 150-test full-suite result above.

### 2026-07-16 Node fallback document dependencies

- Final smoke validation found that the optional Node sidecar layout had not been updated when DOCX parsing moved to `@xmldom/xmldom`; startup failed before handshake with `ERR_MODULE_NOT_FOUND`. The builder now includes `@xmldom/xmldom`, `unpdf`, and `yauzl` alongside the existing runtime links.
- `node-sidecar-smoke` asserts every declared runtime dependency exists in the assembled layout before launch, then completes the WebSocket echo round trip. Node fallback and Bun single-file sidecar smokes both pass with 12 events. Bun remains the default packaged Windows sidecar.

### 2026-07-15 PDF and DOCX chat attachments

- The chat File picker now accepts PNG/JPEG/GIF/WebP images plus PDF and DOCX documents. Images retain thumbnail/paste behavior; document cards expose extraction state, page count when available, warnings, and a download link to the locally persisted original.
- The daemon validates MIME/data-URL agreement, decoded byte size, and PDF/DOCX file signatures before parsing. DOCX metadata is preflighted, then actual streamed expansion is counted before bounded OOXML paragraph extraction. `unpdf` extracts embedded PDF text. Parser failure is visible on the document card; a PDF with no embedded text is explicitly marked as requiring OCR rather than treated as understood. OCR and legacy `.doc` are not implemented.
- Extracted document text is injected into every agent's Context Bundle as explicitly untrusted reference content for the active topic. API and CLI agents therefore use the same document text. Historical projections retain metadata and extraction state but omit data URLs and extracted bodies; per-document text is capped at 120,000 characters and the active prompt at 160,000 characters total.
- The network boundary permits at most six attachments, with 5 MB per image, 10 MB per PDF/DOCX, and 20 MB decoded total. Only raster image formats accepted by the multimodal path are allowed; SVG attachment uploads are rejected. Messages are serialized per room while async parsing runs so two quick document sends cannot reorder event sequence.
- Real parser tests cover PDF text/page count, DOCX paragraphs, empty/scanned-style PDFs, malformed containers, forged encoded/expanded sizes, schema MIME gating, rejection of client-forged extraction text, current-topic context injection, and gateway enrichment. Typecheck, `133/133` tests, Web production build, and a compiled Bun sidecar smoke with both a real PDF and DOCX pass locally. Windows Packages now runs that same compiled document smoke instead of only compiling the sidecar. The in-app browser runtime exposed no browser instance, so click/screenshot acceptance is still unavailable.
- Windows run `29406982270` correctly stopped at the strengthened smoke before packaging, but the failure was the smoke harness using bare `spawn tsx` on Windows (`ENOENT`), not a parser failure. Bun and Node fallback smoke harnesses now import their TypeScript build scripts in-process so pnpm shim discovery is not platform-dependent. The follow-up [Windows run 29407135897](https://github.com/MattSureham/quorum/actions/runs/29407135897) is green on `0ba5255`: all 133 tests, the compiled Windows sidecar smoke with real PDF and DOCX files, Web build, unsigned NSIS installer, portable assembly/layout validation, and every artifact upload passed. Windows portable document support is therefore signed off at the packaging level; real-machine interaction remains manual release acceptance.

### 2026-07-15 rich chat output and diagrams

- Chat messages now render sanitized GitHub-flavored Markdown instead of plain `pre-wrap` text. Supported presentation includes compact headings, lists/task lists, tables, blockquotes, safe links, fenced code, Markdown images, and the existing uploaded/pasted image attachments. Attachment and Markdown images open at full size from their preview.
- Fenced `mermaid` blocks are lazy-rendered for flowcharts, sequence diagrams, pie charts, XY charts, and Mermaid's other diagram types. Mermaid is not loaded for ordinary messages. Invalid diagrams show a readable source fallback instead of blank chat.
- The rendering boundary is intentionally strict: raw HTML is skipped, `rehype-sanitize` processes the Markdown tree, executable/file image protocols are rejected, per-diagram Mermaid configuration and active-content hooks are blocked, Mermaid uses `securityLevel: strict` with HTML labels disabled, and DOMPurify sanitizes the generated SVG before insertion.
- `SessionManager` tells every agent about the available GFM/Mermaid presentation surface and asks for a textual conclusion alongside visuals. This makes rich output discoverable to CLI and API agents without changing the authoritative event format; message text remains Markdown in the event log.
- New coverage server-renders representative GFM and Mermaid messages and checks image/diagram security gates. Typecheck, `123/123` tests, Web production build, EventLog/shared/source/Node/Bun sidecar smokes, and Rust `cargo check` pass. Windows Packages run [29404444923](https://github.com/MattSureham/quorum/actions/runs/29404444923) is green on `3c4ed5e`: all 123 tests, Web/Bun builds, unsigned NSIS packaging, portable assembly/layout validation, and all artifact uploads passed. Mermaid is dynamically split into on-demand chunks; the ordinary main bundle does not execute Mermaid. Vite reports its expected over-500 kB warning for several lazy Mermaid diagram chunks, so package/download size should be monitored even though normal chat does not load those chunks. The in-app browser still exposed no browser instance, so screenshot/click QA remains unavailable in this environment. `pnpm audit --prod` could not return a vulnerability result because npm retired the audit endpoint used by this pinned pnpm 9 client (HTTP 410); do not misreport that command as a clean audit.

### 2026-07-15 configurable order and advisory discussion rounds

- New Session now exposes an ordered participant list with icon controls plus a 1-12 `Target discussion rounds` input. The selected participant array remains the persisted source of order. Round robin follows it strictly in every round; open-discussion and raise-hand arbitration use it to break otherwise equal bids.
- `targetDiscussionRounds` is persisted in `Room`, validated at the WebSocket boundary, and passed into `SessionManager`. It is deliberately separate from `maxTurnsPerTopic`, which remains a hard runaway-loop safety ceiling.
- A target round means one speaking opportunity per selected/targeted agent. Reaching the target does not abort the current turn. Quorum records a wrap-up request and grants every eligible participant one final ordered turn with an explicit instruction to converge, state a concrete answer, preserve disagreement, and leave unfinished work for Continue Session.
- Round-robin schedules repeat the custom order for the requested number of rounds before that wrap-up pass. Diagnostics show round progress and `Wrapping up`; the setup and status text are bilingual.
- Regression coverage validates schema bounds, participant-order arbitration, soft-target behavior, repeated round-robin order, the complete wrap-up pass, and host persistence. Typecheck, all `119/119` tests, Web production build, EventLog/shared/source/Node/Bun sidecar smokes, and Rust `cargo check` pass. Windows Packages run [29402010332](https://github.com/MattSureham/quorum/actions/runs/29402010332) is green on `b5f97f1`: tests, Web/Bun, unsigned NSIS, portable assembly/layout validation, and all artifact uploads passed. The first local full-suite run had three pre-existing 5-second CLI subprocess tests time out under parallel load; all three passed in an immediate isolated rerun. The host integration was then shortened back to its original runtime and the complete suite passed cleanly. The in-app browser exposed no browser instance, so click/screenshot QA was unavailable. Full Xcode is not installed, so macOS bundle creation was not rerun.

### 2026-07-15 Codex transient reconnect and topic-context isolation

- The latest user room is `session-mrlor4em` in `.quorum/webui-smoke.sqlite`. Its configured participants are Codex, Claude Code, and DeepSeek V4 Pro. Codex bid twice and won the floor at seq `#21` and `#101`; both turns ended after about 50 seconds with zero output and `Reconnecting... 2/5 (request timed out)`. It was selected correctly, but the UI had no Codex chat message to show.
- A direct local `codex exec` probe reproduced the same JSONL `error` event, then continued through retries, emitted a WebSocket-to-HTTPS fallback notice, and ultimately returned `OK`. Quorum incorrectly treated the first recoverable `error` record as terminal. The adapter now persists it as a non-chat transport notice and waits for an assistant message; only `turn.failed`, non-zero exit, deadline, or final empty output fails the turn. A fake-CLI regression covers reconnect followed by successful recovery.
- The agents' Quorum framing was injected by the host, not recovered from cross-Session memory. The room workspace was `/Users/matthew/Projects/quorum`; every turn received a bundle headed `Quorum Context Bundle`, containing that path and rules that repeated the product name; Claude Code also ran with that repository as `cwd`. DeepSeek then received Claude's Quorum-framed first answer in the same Session transcript. The room had no shared-memory entries or long-term-memory rows, and its only working summary was created later at seq `#96`.
- The continuity bundle is now branded neutrally as shared Session metadata and explicitly says host/application names, participant ids, Session metadata, and workspace paths are not the user's subject. It forbids inferring that a prompt concerns the host or workspace unless the human says so. When no workspace is selected, Codex and Claude Code now run in a neutral per-Session temporary directory rather than silently inheriting the daemon's Quorum repository cwd.
- New Session no longer pre-fills the active room's workspace path. A project directory must be selected explicitly, preventing a generic discussion created from a Quorum project room from silently inheriting its repository context. Windows Packages run [29398330270](https://github.com/MattSureham/quorum/actions/runs/29398330270) is green on `d20acce`, including all 115 tests, Web/Bun, NSIS, portable layout validation, and artifact uploads.
- A real end-to-end Quorum probe created a temporary Codex-only Session without a workspace and asked a generic entropy question. Codex survived its transport retries, returned a one-sentence generic answer, emitted `turn_completed`, did not mention Quorum or a codebase, and the temporary Session was deleted.
- Local verification passes typecheck, `115/115` tests, Web production build, shared/source/Node/Bun sidecar smokes, and Rust `cargo check`. Windows Packages run [29397682665](https://github.com/MattSureham/quorum/actions/runs/29397682665) is green on `605ea77`: all 115 tests, Bun/Web, unsigned NSIS, portable assembly/layout validation, and every artifact upload passed. Full Xcode is not installed, so macOS bundle creation was not rerun.

### 2026-07-15 credentials with zero Sessions

- The repeated DeepSeek “needs key” state was reproduced after deleting the final Session. The key had not been erased: `.quorum/credentials.sqlite` still reported DeepSeek as configured with the expected masked preview. The gateway incorrectly resolved every credential command through a room first, so `get_credentials` and `set_credential` failed with `unknown session` when no room existed.
- Provider credential commands are now daemon-global and are handled before Session lookup. Their protocol `roomId` is optional, and a gateway regression deletes the final room before verifying both masked reads and writes. No raw key is returned by the test or runtime response.
- Web startup now requests credentials independently, waits for `list_sessions`, and only continues/subscribes when a persisted room exists. Empty Session lists clear stale room state while leaving API-key configuration and New Session available. Agent health refresh runs only when a room is actually loaded.
- Live verification against the stable credential store passed: after deleting the only smoke Session, the gateway returned zero rooms while DeepSeek remained configured with its existing masked preview. Local verification passes typecheck, `112/112` tests, Web production build, shared/source/Node/Bun sidecar smokes, and Rust `cargo check`. Windows Packages run [29391070418](https://github.com/MattSureham/quorum/actions/runs/29391070418) is green on `7301fc0`: all 112 tests, Bun/Web, unsigned NSIS, portable assembly/layout validation, and every artifact upload passed. The in-app browser runtime exposed no browser instance, so click-driven UI acceptance remains unavailable in this environment.

### 2026-07-15 Codex timeout and follow-up bid recovery

- The user was correct that Codex, not Claude Code, failed in `session-mrlkcmvc`. Claude Code completed in 43.1 seconds with one message; Codex then failed after 50.7 seconds with `Reconnecting... 2/5 (request timed out)` and zero outputs; DeepSeek completed afterward in 29.9 seconds with one message.
- Two Quorum bugs obscured that sequence. The run banner preferred any earlier `turn_failed` over a later `turn_completed`, and did not name the failed speaker. It now evaluates the newest terminal turn after the human prompt and prefixes failure detail with the participant display name.
- After DeepSeek completed, the open-discussion scheduler accepted another Codex bid in the same epoch, but the SQLite projection's unique `(session_id, epoch, agent_id)` index rejected the new bid id. The append-only event log was intact, but the projection error left the room in `collecting_bids`. The derived bid row now atomically replaces the prior revision and clears its settled state; all bid events remain authoritative in the event log.
- Codex JSONL `turn.failed` detail now passes through the CLI failure classifier, so this failure is category `timeout` instead of `adapter_error`. Regression coverage checks terminal-turn ordering, same-epoch rebids, and Codex timeout classification.
- Local verification passes typecheck, `110/110` tests, Web production build, shared/source/Node/Bun sidecar smokes, and Rust `cargo check`. The in-app browser had no available instance, so UI behavior was verified through pure state tests plus a live WebSocket replay of the affected persisted room. Windows Packages run [29389046867](https://github.com/MattSureham/quorum/actions/runs/29389046867) is green on `1da49e8`: all 110 tests, Bun/Web, unsigned NSIS, portable assembly/layout validation, and every artifact upload passed.

### 2026-07-15 stable development credential store

- Root cause of repeated DeepSeek setup was database identity, not provider authentication: the repository contained seven local Session/test SQLite files. The active daemon used `.quorum/webui-smoke.sqlite`, where DeepSeek/OpenAI/Zhipu were configured, while the normal `.quorum/quorum.sqlite` contained no provider rows. Switching launch commands therefore looked like credentials had been erased.
- `pnpm dev` now sets a stable absolute `QUORUM_CREDENTIAL_DB_PATH` at `.quorum/credentials.sqlite`, independently of `QUORUM_DB_PATH`. Both shared and legacy hosts read/write provider credentials through this store; sidecar/direct launches can opt in with the same environment variable. Desktop/portable behavior remains unchanged because Tauri already uses one stable OS app-data database.
- On first use of a dedicated credential store, missing provider rows are copied from the selected Session database. Existing canonical rows win, so an older test DB cannot overwrite a configured key. The user's existing DeepSeek/OpenAI/Zhipu rows were migrated locally without printing raw values; no credential database is tracked by Git or included in artifacts.
- A new shared-host regression starts with a credential in one Session DB, migrates it, switches to a fresh second Session DB, and confirms the masked DeepSeek credential remains available while the second Session DB has no provider rows. Startup logs now display both Session DB and credential DB paths.
- Local verification passes typecheck, `105/105` tests, Web production build, shared/source/Node/Bun sidecar smokes, and Rust `cargo check`. Windows Packages run [29387544014](https://github.com/MattSureham/quorum/actions/runs/29387544014) is green on `f6407b6`: all 105 tests, Bun/Web builds, unsigned NSIS, portable assembly/layout validation, and every artifact upload passed.

### 2026-07-15 no-reply/disconnect reliability follow-up

- The reported room (`session-mrlhfbcu`) was reconstructed from `.quorum/webui-smoke.sqlite`. Claude Code, Codex, and DeepSeek all bid successfully, then each turn hit the inherited 30-second deadline with zero output. Those deadlines were recorded as cancellations, and the scheduler reopened a follow-up bid round, leaving event `#39` at `collecting_bids`; this explains the no-reply/stuck UI. The old dev process restarted later, but its stdout was unavailable, so the exact process-exit trigger is not claimed as proven.
- Shared-session runtime now enforces a 180-second minimum agent execution deadline for both newly created and persisted rooms. A deadline emits structured `turn_failed` data with category `timeout`; if every candidate fails, the topic returns to `idle` instead of looping into another bid window. The Web run banner displays the actual failure message.
- Restart recovery now closes an orphaned active turn with category `daemon_restart`, releases its floor, records a warning, and normalizes any transient runtime phase to `idle`. Interrupted turns are not automatically replayed because tools or workspace edits may already have produced side effects. Persisted `paused` and `ended` phases remain stable.
- The Web client reconnect path now reports WebSocket close code/reason. In Tauri it re-invokes `get_sidecar_connection`, allowing Rust to replace a dead sidecar before reconnecting. `pnpm dev` now leaves Vite running and automatically restarts an unexpectedly exited daemon after one second.
- The saved DeepSeek credential and `deepseek-v4-pro` profile were first exercised directly with the same question, completing in about 5.1 seconds. A second end-to-end check used the live gateway's `create_session -> subscribe -> post_message` path, received a complete DeepSeek chat reply, and deleted its temporary session. No raw credential was printed or added to artifacts. This establishes that the current provider/key/model and shared-session message paths work, but does not prove why the earlier request spent all three 30-second windows without output.
- Manual daemon recovery passed: terminating only the daemon process group left Vite listening on `5173`; `scripts/dev.ts` restarted the daemon after one second, `8787` resumed listening with a new process, and a fresh WebSocket client listed the persisted rooms.
- Local verification: `pnpm typecheck`, `104/104` tests, Web production build, shared/source/Node/Bun sidecar smokes, and Rust `cargo check` pass. The Node fallback smoke exceeded its five-second handshake only while run concurrently with the complete suite, then passed alone in 2.8 seconds. The in-app browser runtime exposed no browser instance, so this follow-up has real gateway/integration coverage but no new click-driven browser pass. Windows Packages run [29385964268](https://github.com/MattSureham/quorum/actions/runs/29385964268) is green on `3c144ba`: all 104 tests, Bun/Web builds, unsigned NSIS, portable assembly/layout validation, and every artifact upload passed. Real-machine portable UX remains manual release acceptance.

### 2026-07-15 Windows credential-save follow-up

- The user reported that DeepSeek Save still appeared inert in the downloaded Windows portable even though the previous local browser test and Windows build were green. Treat the earlier acceptance as insufficient because it did not exercise the packaged desktop/sidecar pair interactively on Windows.
- Direct reproduction against the compiled Bun sidecar succeeded end to end: authenticated WebSocket `set_credential`, masked `credential_saved`, SQLite persistence, and the real Web UI click path all changed DeepSeek to `set ...2468`. A second browser test connected to a deliberately non-responsive sidecar and confirmed the provider card displays an explicit timeout after eight seconds.
- Credential saves now use a required request id. Success and `credential_error` responses are correlated, and each provider card visibly shows saving/saved/error. The compiled Bun smoke now writes a temporary credential, validates the masked response, and rejects any raw-key leak.
- Desktop/sidecar handshake protocol version 2 prevents mixed portable files. The desktop rejects a missing/wrong version with instructions to fully extract one ZIP. The generated portable README explicitly says never to copy only `Quorum.exe` into an older portable folder.
- A likely explanation for the user's screenshots is a new embedded Web UI (`Quorum.exe`) paired with an older `sidecars/quorum-sidecar.exe`; this is strongly suggested by the matching-pair success but is not proven without the Windows `%LOCALAPPDATA%\\dev.quorum.desktop\\sidecar.log` and hashes of both binaries.
- Local verification: typecheck, `102/102`, Web build, source/Bun/Node sidecar smokes, Rust `cargo check`, compiled-sidecar credential persistence, successful UI save, and UI no-response timeout all passed. Windows Packages run [29384116932](https://github.com/MattSureham/quorum/actions/runs/29384116932) is green on code commit `8d62e0e`: tests, compiled Bun sidecar, Web UI, NSIS, portable assembly/layout validation, and all artifact uploads passed. A fresh-directory real-machine retest is still required.

### 2026-07-14 independent validation handoff

This section is the entry point for the next agent. The security/reliability review was implemented, but it still needs an independent acceptance pass before release.

#### Latest credential and portable acceptance target

- The credential-path fixes are in `efa11e1`, `8538ec3`, and `ae87db3`; documentation is in `bdd726c`. The legacy gateway now persists provider credentials, save errors appear inside the modal, and `QUORUM_DB_PATH` reaches both legacy and shared-session kernels.
- Local acceptance passed `pnpm typecheck`, all `100/100` tests, and the Web production build. A real browser check against a fresh temporary SQLite database changed DeepSeek from `not set` to masked `set ...5678` after Save; the raw test key was not returned to the browser.
- **A Windows portable tester does not need to clone or pull the repository.** Wait for the Windows Packages workflow for current `main`, download the `quorum-windows-x64-portable` artifact, fully extract the nested ZIP, and run `Quorum.exe`. Pulling is only necessary when building from source.
- Do not test these fixes with an older portable artifact. Confirm the artifact workflow includes at least `bdd726c` (or a descendant) before downloading it.
- Portable artifacts never contain developer API keys. On a fresh Windows machine, configure DeepSeek/MiniMax/etc. once through **API keys**. The desktop/portable state is stored locally at `%LOCALAPPDATA%\\dev.quorum.desktop\\quorum.sqlite`; keys do not migrate automatically from macOS, another Windows machine, or another SQLite path.
- Windows manual acceptance: open **API keys**, save a temporary DeepSeek key, confirm the card shows a masked `set ...xxxx` state, close the modal, confirm the DeepSeek provider group no longer says `needs key`, and verify DeepSeek models are selectable in **New session**. Restart `Quorum.exe` and confirm the masked configured state persists. Any failure must be visible inside the credential modal rather than appearing as an inert Save button.
- Follow-up security-contract/profile remediation: `SPEC.md` now matches the implementation and explicitly states that API-model keys are plaintext JSON in local SQLite, protected only by OS account/file permissions; no Keychain, Credential Manager, or field encryption exists yet. Custom API profiles now require a provider id, and legacy provider-less profiles migrate to `openai` so credential gating applies. Two pure UI-state tests cover migration, required provider, and duplicate ids. Local verification passed typecheck, Web build, and `102/102` tests (one pre-existing Claude subprocess test initially hit its 5-second limit, then passed alone and in the complete rerun).
- Windows Packages run [29323512564](https://github.com/MattSureham/quorum/actions/runs/29323512564) passed against remediation commit `8a21cbe`: all 102 tests, Bun/Web, unsigned NSIS, portable assembly/layout validation, and every artifact upload succeeded. The only annotation is GitHub's Node 20 action-runtime deprecation warning; it did not affect this build. Real-machine portable UX and adversarial `.cmd` testing remain manual release acceptance.

**Follow-up after independent review:** the blocking findings were addressed in the changes after `41cb88e`. Network-supplied built-in adapter configs now use strict per-adapter schemas; health checks and adapters share shell-safe binary validation; Codex resume uses `codex exec --sandbox ... resume <id> --json -`; workspace-lease queue time is excluded from agent execution timeout; WebSocket sends use the live socket plus settings refs; approval timeout/interrupt emits a terminal signal; and dirty workspace baselines are rejected. Local verification is `99/99`; Windows run [29314485107](https://github.com/MattSureham/quorum/actions/runs/29314485107) passed all 99 tests, Bun/Web/NSIS/portable builds, layout validation, and artifact uploads. Code-level acceptance is complete; real-machine adversarial and UX checks remain release acceptance.

UI follow-up: provider model catalogs are no longer filtered out when the active SQLite database has no configured credential row. All five built-in provider groups remain visible and collapsed; New session lists their models as disabled `needs key` options until configuration succeeds. This prevents switching between dev/desktop/portable data paths from making the model catalog appear to vanish.

Credential follow-up: the legacy `startRoom` gateway now exposes the same SQLite-backed `get_credentials` / `set_credential` handlers as the shared-session host and restores provider environment variables at startup. The CLI now passes `QUORUM_DB_PATH` to either kernel. Credential-save failures are surfaced inside the modal, and a WebSocket regression test verifies that only a masked preview is returned. Local verification is now 100/100 tests plus typecheck and Web production build. Credentials remain local to the selected SQLite database and are never embedded in portable artifacts.

#### Review remediation status

- **P0 Windows CLI command injection: implemented, requires Windows adversarial validation.** Codex and Claude Code now send prompts/context through stdin rather than command-line arguments. Dynamic model/native-session values are validated, and unsafe custom Windows binary paths are rejected. Windows still uses a shell to launch npm `.cmd` shims, so verify that prompts containing `&`, `|`, `%VAR%`, `^`, redirects, quotes, and newlines cannot create files or execute a second command.
- **P0 Git branch reset: implemented and covered locally.** `GitWorkspace.init()` no longer uses `checkout -B`; it preserves an existing branch head, creates a missing branch normally, and refuses a dirty-tree branch switch instead of swallowing the failure.
- **P0 shared workspace write lock: implementation and deadline semantics corrected; Windows CI passed.** Sessions using the same canonical `realpath` share one workspace coordinator, write mutex/checkpoint queue, and watcher. Lease queue time no longer consumes the agent execution deadline. Conflicting active branches are rejected.
- **P1 bounded context: implemented.** Bids and turns use post-summary increments after compaction, or a capped recent-event window before compaction, instead of replaying the entire event log into every adapter call.
- **P1 shared rollback: implemented.** Rollback now runs through the shared workspace lease and emits an event; the gateway returns an explicit error when rollback is unavailable.
- **P1 frontend stale WebSocket state: implemented, test gap remains.** Current settings and active room are read through refs; sends use the live socket `readyState`; render no longer overwrites the active-room ref with stale room state. No dedicated browser state-machine regression test was added, so this needs manual rapid-switch/reconnect validation.
- **P1 deleted primary ghost session: implemented and tested.** The gateway no longer falls back to constructor-time deps, and the primary registry keeps one object identity.
- **P1 sandbox boundary: intentionally not resolved as OS isolation.** `local-sandbox-executor` is only a guarded local command runner. It limits cwd/environment/time/output and applies command patterns, but it can still read user files, access the network, or invoke another interpreter. Approval cards now show complete arguments and approvals abort/expire, but this must remain a documented release blocker if Quorum claims strong sandboxing.
- **Other review items: implemented.** Claude spawn/nonzero/empty-output failures become failed turns; `bidWindowMs` now bounds individual bids; room-configured human ids are used; open-discussion labels use `schedulerMode`; Tauri sidecar handshake has a timeout and kills failed children.

#### Current CI and local verification

- Windows run [29311886855](https://github.com/MattSureham/quorum/actions/runs/29311886855) is green: typecheck, all 98 tests, Bun sidecar, Web UI, NSIS, portable assembly/layout validation, and all artifact uploads passed. Earlier retries isolated the failures to mixed integration-test timing and missing Git identity; `GitWorkspace` now supplies repo-local Quorum defaults only for a new repository that lacks identity and never changes global Git config.
- Two earlier retries, [29303623917](https://github.com/MattSureham/quorum/actions/runs/29303623917) and [29303946101](https://github.com/MattSureham/quorum/actions/runs/29303946101), failed at the same test timing boundary. Windows did pass the new Codex/Claude stdin-injection regression tests in those runs.
- Local verification after the follow-up passed the full typecheck/test/Web/smoke/Tauri matrix; Windows run 29311886855 passed build and packaging. Real-machine adversarial `.cmd` and portable UX checks remain release acceptance items.
- A Bun temporary build file was briefly committed and then deleted by the room watcher. It is absent from the current tree; `.*.bun-build` is now ignored. It remains in Git history and may increase clone size until history is deliberately cleaned in a separately approved maintenance operation.

#### Independent acceptance checklist

1. Review the security/reliability changes from the pre-review baseline through current `HEAD`; pay particular attention to `codex.ts`, `claude-code.ts`, `git-workspace.ts`, `shared-session-host.ts`, `session-manager.ts`, `ws-server.ts`, `main.tsx`, `local-sandbox-executor.ts`, and Tauri `lib.rs`.
2. Run `pnpm typecheck`, `pnpm test`, the Web production build, `pnpm smoke:shared`, `pnpm sidecar:bun:smoke`, and `pnpm desktop:check`.
3. On Windows, exercise real Codex and Claude Code `.cmd` shims with adversarial prompts containing shell metacharacters. Confirm the prompt reaches the agent and no marker file, second command, variable expansion, or redirection side effect occurs.
4. Verify Git workspace initialization does not move an existing branch head, refuses dirty-tree switching, and reports checkout failures.
5. Start two sessions against the same workspace with editing agents. Confirm edits never overlap, only one watcher owns checkpoints, and both sessions complete. This now passes on Windows; investigate any future regression rather than merely increasing timeouts.
6. Verify shared rollback under the workspace lock and verify deleting the primary session cannot be followed by subscribe/continue/list returning a ghost room.
7. In the Web UI, rapidly switch sessions, disconnect/reconnect, receive agent health events, and delete the active session. Confirm reconnect and fallback always use the latest selected room.
8. Create a long session, trigger compaction, and inspect adapter input to confirm only summaries plus bounded recent increments are sent and event sequence lineage remains intact.
9. Exercise approval timeout, interrupt, full argument display, and denied tools. Do not approve a strong-sandbox security claim without adding real OS-level isolation.
10. Windows packaging run 29314485107 is green. Hands-on portable/installer testing is still required before calling the Windows release accepted.

### 2026-07-14 collaboration checkpoint

- `main` currently includes the Windows portable runtime fixes through `ba4a994`; the implementation was split into watcher-generated commits `ccbc1b5` and `ba4a994` after `dc0cffa` added clipboard image paste.
- The latest successful Windows build is [Windows Packages run 29299927270](https://github.com/MattSureham/quorum/actions/runs/29299927270). Download artifact `quorum-windows-x64-portable`, fully extract its nested `windows-x64.zip`, and keep `sidecars/quorum-sidecar.exe` beside `Quorum.exe`.
- A real Windows test of the previous portable artifact found two problems: Claude Code was falsely reported missing and new sessions could not be created. The current build fixes both suspected root causes, but **the user still needs to re-test this new artifact on the same Windows machine**.
- Desktop runtime state is now deterministic: `%LOCALAPPDATA%\\dev.quorum.desktop\\quorum.sqlite`, `%LOCALAPPDATA%\\dev.quorum.desktop\\workspace`, and `%LOCALAPPDATA%\\dev.quorum.desktop\\sidecar.log`.
- The Tauri launcher augments sidecar `PATH` with `%USERPROFILE%\\.local\\bin`, `%APPDATA%\\npm`, and `%LOCALAPPDATA%\\Programs\\Claude`. Health checks and both Claude Code/Codex adapters use Windows shell launching so `.cmd` shims work.
- If re-test still fails, collect `sidecar.log`, the participant health tooltip, and the exact path returned by `where claude` and `where codex`. Do not revert to storing data relative to Explorer's current working directory.
- Historical note: run 29299927270 passed the then-current Windows tests and packaging, but it predates the security follow-up. Use the independent-validation section above as current status.

Latest migration commits:

- `7d303b8 feat: add shared session architecture kernel`
- The follow-up handoff/UI commit adds shared-session Web UI projection and `pnpm smoke:shared`.
- The sidecar spike commit adds `packages/daemon/src/sidecar.ts` and `pnpm smoke:sidecar`.
- The Node fallback spike adds `pnpm sidecar:node:build` and `pnpm sidecar:node:smoke`.
- The packaging env commit adds project-local Bun/Rust setup under `.tools/` and validates Bun single-file sidecar compile with `pnpm sidecar:bun:smoke`.
- The desktop shell spike adds `apps/desktop`, `pnpm desktop:check`, `pnpm desktop:dev`, `pnpm desktop:build`, and a Tauri command that starts the compiled Bun sidecar and returns its authenticated WebSocket URL to the React client.
- The Windows packaging workflow also emits an unsigned portable x64 ZIP containing `Quorum.exe`, `sidecars/quorum-sidecar.exe`, usage notes, and a SHA-256 checksum.

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

73. this change `fix: update Zhipu and MiniMax flagships`
    - Files: provider model catalog/default credentials, `README.md`, `HANDOFF.md`.
    - Work: updates the flagship selections to exact API ids `glm-5.2` and `MiniMax-M3`, while retaining GLM-5.1 and MiniMax M2.7 as previous-generation choices.

74. this change `feat: browse daemon workspaces from web`
    - Files: protocol command, WebSocket gateway/test, shared host directory service, Web Session setup/styles, `README.md`, `HANDOFF.md`.
    - Work: adds read-only `list_workspace_directories` request/response handling and an inline Web folder navigator with parent/subfolder navigation and an explicit “Select this folder” action. Desktop continues to use the native OS picker; browser mode selects absolute paths on the connected daemon machine.
    - Verification: `pnpm typecheck`, all 85 tests, Web production build, and shared-session smoke pass.

75. this change `feat: package portable Windows build`
    - Files: Windows packaging workflow, PowerShell portable assembler, package scripts, `README.md`, `HANDOFF.md`.
    - Work: assembles the raw Tauri `quorum-desktop.exe` as `Quorum.exe` beside `sidecars/quorum-sidecar.exe`, adds usage notes, creates a ZIP and SHA-256 checksum, validates the artifact layout in CI, and uploads it as `quorum-windows-x64-portable` alongside the NSIS installer.
    - Verification: `pnpm typecheck`, all 85 tests, Web production build, shared-session smoke, compiled Bun sidecar smoke, desktop Tauri info, and Rust `cargo check` pass on macOS arm64. Portable assembly and launch remain enforced by the Windows workflow because PowerShell/Windows binaries cannot be run on this host.

76. this change `fix: run Codex CLI through Windows command shim`
    - Files: Codex adapter and its cross-platform tests, `HANDOFF.md`.
    - Work: launches Codex with the Windows shell so npm-installed `codex.cmd` shims work, and replaces Unix-only fake CLI fixtures with equivalent `.cmd` fixtures. This was discovered by the first portable-package workflow run before packaging began.

77. this change `feat: paste images into chat`
    - Files: Web chat composer, `README.md`, `HANDOFF.md`.
    - Work: accepts image files from the clipboard through `Ctrl/Cmd+V`, reuses the existing attachment preview/removal/send path and six-image queue, leaves ordinary text paste untouched, and reports image read failures instead of rejecting silently.
    - Verification: `pnpm typecheck`, all 85 tests, and the Web production build pass. Browser interaction inspection was attempted against the local Vite app, but no controllable browser was available in this session.

78. this change `fix: initialize Windows portable runtime environment`
    - Files: Tauri sidecar launcher, daemon sidecar/health checks, `README.md`, `HANDOFF.md`.
    - Work: moves desktop SQLite/default workspace/log output to the writable app-local data directory, gives the sidecar a deterministic working directory, adds common native/npm CLI install directories to its Windows `PATH`, and runs CLI health checks through the Windows command shell so `claude.cmd` and `codex.cmd` are detected. This addresses portable builds that could neither detect Claude Code nor create sessions when Explorer supplied an unsuitable working directory or stale PATH.

79. this change `fix: harden shared-session execution and workspace safety`
    - Files: Claude/Codex adapters and tests, Git workspace/tests, shared-session host/tests, SessionManager, gateway/tests, Web connection/mode/approval UI, protocol approval type, Tauri launcher, `README.md`, `HANDOFF.md`.
    - Work: removes user prompt/context/workspace paths from Windows shell argv by streaming both CLI prompts through stdin and using `spawn.cwd`; validates remaining dynamic CLI values and rejects binary paths with cmd metacharacters; turns Claude spawn/exit/empty-output failures into structured failed turns; replaces destructive `git checkout -B` with safe branch switching and dirty-tree refusal; shares one canonical workspace coordinator/lease/watcher across sessions; wires shared rollback through that lease; removes deleted-primary gateway fallback; bounds post-compaction transcript replay; makes bids time out; ties approvals to abort/timeout while showing full args; fixes stale WebSocket room/settings closures and Open discussion labeling; uses configured human ids; and adds a 10-second sidecar handshake timeout with child cleanup.
    - Security boundary: `local-sandbox-executor.ts` remains a guarded local command runner, not a true OS sandbox. It limits cwd/env/time/output and blocks a small pattern set, but can still access user files/network through allowed commands. Do not claim stronger isolation until a platform sandbox/container backend exists.
    - Verification: `pnpm typecheck`, all 93 tests, Web production build, shared-session smoke, compiled Bun sidecar smoke, Tauri info, and Rust `cargo check` pass on macOS arm64. New regression coverage includes prompt-via-stdin for both CLIs, structured Claude failures, branch-head preservation/dirty-tree refusal, deleted-primary behavior, explicit unavailable rollback, and cross-session workspace lease serialization.

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
- Chat attachments now distinguish image visibility from document extraction: vision-capable agents inspect raster images, other agents receive image metadata, and every agent receives bounded PDF/DOCX text for the active topic.
- The Web UI supports locally persisted custom API-model profiles. They are available in Session setup and map to provider/model/role adapter config.
- Session lifecycle is persisted in room metadata via `Room.lifecycle` and `update_session_lifecycle`; Archive/Unarchive uses this path when connected.
- Shared-session turns emit `turn_trace` events; the Web UI Turn Trace panel prefers backend traces and falls back to event-derived traces.
- Permission policy mapping is conservative for native CLI agents: `approval-required` does not grant workspace-write while native approval bridging is incomplete.
- Prompts received during an active or settling turn are now appended immediately and placed in a FIFO pending queue. Each queued prompt receives its own epoch and bid collection after the active turn. `AgentDelta.error` carries adapter failures into structured `turn_failed` and `turn_trace` payloads instead of reporting an empty successful turn.
- The Codex adapter now parses current `item.type` JSONL records as well as the older `item.item_type` shape. It captures spawn errors, stderr, non-zero exits, auth/argument/timeout categories, and empty successful output; all become structured failed turns. Native resume receives one context-bundle fallback attempt and cannot recurse indefinitely.
- Shared-session mode semantics now reach the scheduler: addressed prompts filter eligible bidders, `noConsecutive` compares the actual last speaker id, Raise hand emits explicit `floor_request` events for bids and waits for the current turn, and Open discussion recollects follow-up bids within `maxTurnsPerTopic`. The final budgeted turn, and the final round-robin speaker, receive a mandatory concrete wrap-up prompt that preserves unresolved disagreement for Continue Session.
- Session restore initializes the auto-compaction cursor from persisted summaries and reloads versioned shared memory from the event store; shared-memory writes use SQLite compare-and-set and appear in the Context Bundle. Historical text projections contain attachment metadata only. API-model vision turns receive only current-topic images; PDF/DOCX text is bounded and injected only for the active topic. The gateway enforces six attachments, 5 MB per image, 10 MB per document, and 20 MB total.
- Shared-session editable agent turns now use `GitWorkspace` write-floor serialization and per-turn checkpointing. `SessionManager` acquires/releases the workspace lease for agents with `canEditFiles`, records checkpoints when files changed, and waits for workspace initialization before git operations.
- Local CLI agents such as Claude Code use shell launching on Windows so `.cmd` shims work.
- Claude Code and Codex native session/thread ids are stored in agent-private memory and resumed best-effort. Resume failure records a diagnostic warning and falls back to the Quorum context bundle. The context bundle includes checksum/seq/hash anchors and error-control rules so native hidden memory is treated as advisory when it conflicts with Quorum state.
- Working-memory summaries can be created, persisted through `SqliteStore`, triggered through WebSocket `compact_memory`, inspected in the Web UI Memory panel, and automatically compacted after turns once configured event thresholds are reached.
- Verification: `pnpm typecheck`, `pnpm test`, `pnpm --filter @quorum/client-web build`, `pnpm smoke:shared`, `pnpm smoke:sidecar`, `pnpm sidecar:node:smoke`, `pnpm sidecar:bun:smoke`, `pnpm desktop:check`, and `pnpm desktop:build` pass on macOS arm64. The **Windows Packages** GitHub Actions workflow builds and validates Windows x64 NSIS and portable artifacts.

What is not implemented yet:

- **Installer-grade signed release is not done.** There is no signing/notarization and no auto-update yet. The **Windows Packages** workflow produces unsigned x64 NSIS and portable artifacts. The older portable build was manually tested and exposed runtime/PATH defects; the corrected run 29299927270 still needs manual re-validation on that Windows machine.
- **Desktop double-click launch shell is scaffolded and macOS arm64 bundles build.** `apps/desktop` can launch the Web UI inside Tauri and start the compiled Bun sidecar through the Rust layer. `pnpm desktop:build` produces an unsigned `.app` and `.dmg`; the `.app` contains `Contents/Resources/sidecars/quorum-sidecar`.
- **Developer one-command launch exists.** Use `pnpm dev` for the legacy kernel or `QUORUM_SESSION_KERNEL=shared pnpm dev` for the new shared-session kernel.
- **Local sidecar entry exists and Bun compile is verified.** The sidecar can be run through tsx with `pnpm smoke:sidecar`, compiled with Bun using `pnpm sidecar:bun:build`, and verified with `pnpm sidecar:bun:smoke`.
- **Node-runtime fallback exists.** It is not a single binary, but `pnpm sidecar:node:build` creates a smoke-tested fallback artifact. Keep it as the fallback route if Bun compile regresses on another platform.
- **Rust/Cargo exists only in the project-local toolchain.** Source `.tools/packaging-env.sh` before running direct Cargo/Tauri commands, or use `pnpm desktop:check`.
- The Web UI exposes shared-session phase/bid diagnostics, replay projection controls, working-memory summaries, continuity status, and turn traces. Rich arbitration score inspection, memory policy tuning, and a full timeline scrubber remain follow-up work.
- A true OS-level tool sandbox, adapter-level native approval/tool bridging, signed installer pipeline, updater, and full cross-platform desktop validation remain follow-up work.

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
- **File attachments**: `MessageBody.attachments` supports safe raster image, PDF, and DOCX data URLs plus daemon-generated document extraction metadata/text. The Web UI handles file upload and clipboard image paste (`Ctrl/Cmd+V`), and `api-model` turns convert only current-topic images to multimodal `image_url` content. PDF/DOCX text is extracted locally and delivered to all agents through the active Context Bundle. Historical context must not repeat data URLs or full extracts. Plain-text paste is unchanged; add a safe local-file bridge before claiming CLI image vision support.
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
1. Rebuild/re-test the next `quorum-windows-x64-portable` artifact on the original Windows machine: launch from Explorer, check Claude Code/Codex health, create two sessions against one workspace, send turns containing `&`/`|` as plain text, restart, and Continue.
2. Add a Windows desktop smoke that starts `Quorum.exe` and verifies sidecar handshake/data-path behavior, rather than validating only archive layout.
3. Replace the guarded local command executor with a declared platform sandbox/container backend; until then keep full command args visible and approval-required by default.
4. Add reducer/hook-level Web connection state tests for reconnect, delete fallback, health routing, and rapid session switching.
5. Add a safe local-file bridge for CLI agents that have native vision support and persist custom agent profiles server-side.

## Conventions / gotchas
- `@quorum/core` stays **dependency-free**; anything needing network/env/SDKs lives in `@quorum/daemon`.
- Verify before claiming with `pnpm typecheck`, `pnpm test`, the Web build, and the relevant sidecar/desktop smoke commands. The 2026-07-13 Web workspace-browser pass ends with 85 passing tests and shared-session smoke coverage.
- Debug artifacts (root `*.png`, `.playwright-mcp/`) are gitignored — keep them out of commits.
- **Git worktrees:** `main` is checked out at `/Users/matthew/Projects/quorum`; a second worktree (`test-framework-debug`) also exists. A branch can only be checked out in one worktree at a time, so don't try to `git checkout main` in the second one.

## Recent history
```
ba4a994 chore(room): turn by human [out-of-band] (preserve PATH order/deduplicate Windows CLI paths)
ccbc1b5 chore(room): turn by human [out-of-band] (Windows app-local data, CLI PATH, shell health checks)
dc0cffa chore(room): turn by human [out-of-band] (clipboard image paste verification note)
dc3a51e chore(room): turn by human [out-of-band] (clipboard image paste)
c4a40b1 fix: launch Codex through Windows command shim
d8d15d3 feat: package portable Windows build
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

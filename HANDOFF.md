# HANDOFF

Canonical collaboration state for **Quorum**. Updated **2026-07-28**.
The protocol source is [`BOOTSTRAP.md`](./BOOTSTRAP.md). Repository evidence
always takes precedence over this summary.

## Collaboration Protocol

### Mandatory rules

1. Read this file before inspecting or changing the project.
2. Update only the structured state that you own:
   - append a new entry for your work under **Recent Activity**;
   - update an Active Issue only when you own it or have new repository evidence;
   - update Current State only to reflect verified present facts.
3. Preserve prior evidence and participant records. Never silently rewrite or
   delete another participant's findings.
4. Record disagreement as new evidence. Do not overwrite the earlier claim.
5. Label material claims as **Confirmed**, **Inferred**, or **Unknown**:
   - **Confirmed**: directly supported by repository contents, an executed check,
     a linked CI run, or a reproduced observation.
   - **Inferred**: a reasoned conclusion that has not been directly verified.
   - **Unknown**: evidence is absent or conflicting.
6. Record only checks that were actually executed. Include the command, result,
   relevant count, commit, platform, or artifact when available.
7. Repository source, tests, Git history, and reproducible runtime evidence outrank
   chat history and summaries.
8. Leave exactly one bounded item under **Next Action** before finishing.
9. Keep the history understandable when every participant changes between turns.

### Section ownership and meaning

- **Current State** is the authoritative present-tense project snapshot. It must
  remain understandable without reading the activity log.
- **Active Issues** is the complete set of known unresolved work. Issue identifiers
  are stable and must not be reused.
- **Next Action** is the single highest-priority bounded handoff task.
- **Recent Activity** explains how the current state was reached. Newest entries go
  first. Do not edit another participant's entry except to correct an objectively
  wrong reference.
- **Archived Summary** compresses older activity while retaining architectural
  decisions, unresolved findings, rejected approaches, and traceable evidence.

### Required activity entry

Each participant appends a dated entry with:

- role or participant id;
- task;
- context inspected;
- actions performed;
- files modified;
- findings and their confidence labels;
- verification actually performed;
- issues created or updated;
- remaining uncertainty;
- recommendation for the following participant.

### Protocol evolution

This protocol may change only after a participant records a proposal that explains
the motivation, compatibility with existing history, and migration impact, then
receives explicit approval. Protocol changes must never be adopted silently.

## Current State

### Snapshot identity

| Field | Value | Confidence |
| --- | --- | --- |
| Repository | `MattSureham/quorum` | Confirmed |
| Branch | `main`, tracking `origin/main` | Confirmed |
| Pre-migration baseline inspected | `5dcdf0d` | Confirmed |
| Snapshot date | 2026-07-28, Asia/Shanghai | Confirmed |
| Canonical handoff | This file | Confirmed |
| Historical Chinese handoff | `HANDOFF.zh.md`, non-canonical | Confirmed |

This protocol migration is documentation-only and is a direct successor to the
inspected baseline. The resulting commit hash is reported in Git history rather
than self-referenced here.

### Authoritative project snapshot

| State | Claim | Evidence |
| --- | --- | --- |
| Confirmed | Quorum is a TypeScript/pnpm monorepo for a human and heterogeneous local CLI or API agents collaborating in persistent shared sessions. | `package.json`, workspace packages, `README.md` |
| Confirmed | The append-only event log is the authority. SQLite stores events, session metadata, projections, snapshots, memory, attachment payloads, credentials, and agent-private native session ids. | `packages/core/src/event-log.ts`, `packages/daemon/src/persistence/sqlite-store.ts` |
| Confirmed | The desktop sidecar starts the shared-session host. The generic CLI still selects shared-session only when `QUORUM_SESSION_KERNEL=shared`; otherwise it reports `legacy-conductor`. | `packages/daemon/src/sidecar.ts`, `packages/cli/src/index.ts` |
| Confirmed | Shared sessions support open discussion, raise hand, and strict round robin, configurable speaker order, advisory target rounds, mandatory final wrap-up, FIFO prompt queuing, interrupts, and addressed turns. | `packages/core/src/session-manager.ts` and its tests |
| Confirmed | Sessions persist across restart. Continue rebuilds from Quorum events and memory; Codex and Claude Code native resume is best effort and falls back to a deterministic Context Bundle. Native hidden state is not the source of truth. | shared-session host, adapters, SQLite tests |
| Confirmed | Agents include local Codex and Claude Code CLIs, OpenAI-compatible API models, deterministic Echo, and an OpenClaw placeholder. Provider catalogs and credentials are separate from participant profiles. | adapter registry, profile catalog, Web UI |
| Confirmed | Provider credentials are daemon-level state. API keys are stored as plaintext JSON in local SQLite and only masked previews are returned to the browser. Codex and Claude Code retain their own CLI authentication. | `SPEC.md` credential boundary, `README.md`, SQLite credential paths |
| Confirmed | A canonical workspace coordinator serializes editable turns across sessions sharing a path. Git checkpoints, rollback, dirty-tree refusal, safe branch switching, and process termination ordering have regression coverage. | workspace and shared-session tests |
| Confirmed | The Web UI centers Sessions, Chat, participants/models, hidden credential configuration, agent health, run status, diagnostics, replay, memory, lifecycle actions, rich Markdown/Mermaid output, bilingual controls, and accessible Session setup. | `packages/client-web`, browser acceptance at `1ab960c` |
| Confirmed | Image paste/upload, PDF, and DOCX attachments are bounded. PDF/DOCX text is extracted locally; historical event replay keeps metadata while payload bodies live in separate SQLite rows. | attachment extractor, schema, gateway and smoke tests |
| Confirmed | Windows packaging produces unsigned x64 NSIS and portable artifacts containing the Bun sidecar. The Node sidecar remains a tested fallback. | Windows workflow, packaging scripts |
| Confirmed | Chat remains message-only; operational events belong in run status and diagnostics. | Web UI rendering and security tests |

### Fresh verification at the migration baseline

Executed locally on 2026-07-28 against `5dcdf0d` before documentation edits:

| Command | Result | Confidence |
| --- | --- | --- |
| `pnpm typecheck` | Passed | Confirmed |
| `pnpm test` | 28 files, 166/166 tests passed | Confirmed |
| `pnpm --filter @quorum/client-web build` | Passed; existing Vite large-chunk warning only | Confirmed |

Historical external acceptance:

- **Confirmed:** [Windows Packages run 29487295657](https://github.com/MattSureham/quorum/actions/runs/29487295657)
  is green on exact implementation commit `1ab960c`. It ran 166 tests,
  compiled-sidecar smoke, Web and unsigned NSIS builds, portable layout
  validation, and all four artifact uploads.
- **Confirmed:** isolated Playwright/Chrome acceptance at `1ab960c` passed at
  1440x858, 958x858, and 390x844 with participant selection visible and
  non-overlapping.
- **Confirmed historical evidence:** the broader responsive, keyboard, Session
  creation, Echo, attachment, prompt-queue, and credential scenarios passed on
  earlier 2026-07-16 checkpoints recorded in Git history.
- **Unknown at this snapshot:** corrected portable behavior has not been recorded
  from a fresh real Windows machine against the latest accepted artifact.

### Present constraints

- Quorum's local command executor is guarded but is not a strong OS sandbox.
- Direct API provider secrets rely on OS account and file permissions; there is no
  Keychain, Credential Manager, or field encryption.
- Windows artifacts are unsigned. Signing, notarization, updating, and complete
  cross-platform release acceptance are unfinished.
- Scanned PDFs require OCR, legacy `.doc` is unsupported, and local CLI image input
  lacks a dedicated safe file bridge.
- The legacy and shared kernels have not fully converged. Shared-session mode does
  not implement the legacy runtime `set_policy` operation.

## Active Issues

### QRM-REL-001 - Real Windows portable acceptance

- **Status:** Open
- **Severity:** P1 release gate
- **Owner:** Unassigned; requires a Windows x64 tester
- **Confidence:** Confirmed
- **Evidence:** run 29487295657 proves build, tests, packaging, and archive layout,
  but the prior real-machine artifact exposed CLI detection and Session creation
  defects. No fresh real-machine result is recorded for the corrected artifact.
- **Current resolution state:** corrected artifact exists and is ready for the
  bounded manual acceptance listed under Next Action.

### QRM-SEC-001 - Strong tool isolation

- **Status:** Open
- **Severity:** P1 security boundary
- **Owner:** Unassigned
- **Confidence:** Confirmed
- **Evidence:** `local-sandbox-executor.ts` constrains cwd, environment, duration,
  output, tool names, and common command patterns, but allowed processes can still
  read other user files, access the network, or invoke interpreters.
- **Current resolution state:** approval cards expose full arguments and approvals
  abort or expire. Do not claim OS-level sandboxing until a platform sandbox or
  container backend is implemented.

### QRM-SEC-002 - Native CLI tool approval bridge

- **Status:** Open
- **Severity:** P1 policy consistency
- **Owner:** Unassigned
- **Confidence:** Confirmed
- **Evidence:** Quorum approval and external-tool execution paths exist, but native
  Codex and Claude Code tool events are not universally routed through the same
  approval executor.
- **Current resolution state:** restrictive policies map native agents to safer
  modes; `full-auto` remains the explicit least-restrictive option. End-to-end
  native tool bridging is unfinished.

### QRM-SEC-003 - Provider secret storage

- **Status:** Open
- **Severity:** P2 security hardening
- **Owner:** Unassigned
- **Confidence:** Confirmed
- **Evidence:** `SPEC.md` and `README.md` state that API-model provider keys are
  plaintext JSON in local SQLite, protected only by local OS account and file
  permissions.
- **Current resolution state:** portable artifacts do not contain developer keys
  and browser responses expose masked previews only. Production-grade secret
  storage requires a system credential store or OS-key-protected encryption.

### QRM-REL-002 - Signed and cross-platform distribution

- **Status:** Open
- **Severity:** P2 release engineering
- **Owner:** Unassigned
- **Confidence:** Confirmed
- **Evidence:** Windows NSIS and portable output are unsigned; signing,
  notarization, auto-update, app-launch smoke, and current macOS/x64 real-machine
  acceptance are not complete. Full Xcode was unavailable for the latest local
  checks recorded before migration.
- **Current resolution state:** archive/layout and sidecar smokes exist. A signed
  release pipeline and platform launch matrix remain to be built.

### QRM-ARCH-001 - Kernel convergence and policy parity

- **Status:** Open
- **Severity:** P2 architecture
- **Owner:** Unassigned
- **Confidence:** Confirmed
- **Evidence:** the desktop sidecar uses shared-session, while the generic CLI
  defaults to legacy unless `QUORUM_SESSION_KERNEL=shared`. Shared-session reports
  that `set_policy` is unavailable.
- **Current resolution state:** shared-session is the product path and has broad
  tests. A deliberate migration decision, parity work, and legacy retirement plan
  are still required.

### QRM-DOC-001 - Remaining attachment and vision formats

- **Status:** Open
- **Severity:** P2 capability
- **Owner:** Unassigned
- **Confidence:** Confirmed
- **Evidence:** README documents OCR as absent, `.doc` as unsupported, and CLI
  vision as metadata/text-only without a dedicated safe local-file bridge.
- **Current resolution state:** bounded raster, PDF, and DOCX support is complete;
  these additional formats and CLI vision transport are follow-up work.

### QRM-CFG-001 - Persisted custom agent profiles

- **Status:** Open
- **Severity:** P2 product configuration
- **Owner:** Unassigned
- **Confidence:** Confirmed
- **Evidence:** provider catalogs and profile selection exist, but the old handoff
  records custom server-persisted profile creation/editing as unfinished.
- **Current resolution state:** built-in profiles and provider-bound API profiles
  work. A versioned profile CRUD and migration contract remains undefined.

### QRM-AGENT-001 - OpenClaw adapter

- **Status:** Open
- **Severity:** P2 integration
- **Owner:** Unassigned
- **Confidence:** Confirmed
- **Evidence:** OpenClaw is presented as a placeholder and health checks report
  placeholder adapters unavailable.
- **Current resolution state:** no production adapter is registered.

### QRM-OBS-001 - Complete observable harness

- **Status:** Open
- **Severity:** P3 diagnostics
- **Owner:** Unassigned
- **Confidence:** Confirmed
- **Evidence:** turn traces cover timing, speaker, tools, outputs, and outcome, but
  historical records identify token counts, native session ids, stdout/stderr,
  structured failure taxonomy, memory-policy tuning, and a full timeline scrubber
  as unfinished.
- **Current resolution state:** first-pass Web diagnostics and backend trace events
  are implemented.

### QRM-REMOTE-001 - Remote collaboration milestone

- **Status:** Open
- **Severity:** P3 roadmap
- **Owner:** Unassigned
- **Confidence:** Confirmed
- **Evidence:** SPEC milestone M6 covers relay, end-to-end encryption, pairing, and
  remote access; current implementation binds the sidecar locally.
- **Current resolution state:** not started and not required for local desktop
  acceptance.

## Next Action

1. On a real Windows x64 machine, download and fully extract the portable artifact
   from Windows Packages run `29487295657`; launch `Quorum.exe` from Explorer;
   verify Codex and Claude Code detection, New Session creation, DeepSeek
   credential save and restart persistence, prompts containing literal `&` and
   `|`, two editable Sessions sharing one workspace without overlapping writes,
   application restart plus Continue, and sidecar shutdown; then append the
   pass/fail evidence to QRM-REL-001 and Recent Activity.

## Recent Activity

### 2026-07-28 - Collaboration protocol migration

- **Role:** Codex documentation maintainer
- **Task:** Initialize the persistent multi-agent collaboration protocol defined by
  `BOOTSTRAP.md`.
- **Context inspected:** `BOOTSTRAP.md`, the complete pre-migration `HANDOFF.md`,
  `HANDOFF.zh.md`, `README.md`, `SPEC.md`, current source references, Git status,
  recent commit history, and current test/build scripts.
- **Actions performed:** Replaced the date-stacked handoff with the canonical
  protocol, present-state snapshot, stable issue registry, one bounded handoff
  action, structured activity log, and evidence-preserving archive. Added the
  canonical README entry and marked the Chinese handoff as historical.
- **Files modified:** `BOOTSTRAP.md` added to version control; `HANDOFF.md`,
  `HANDOFF.zh.md`, and `README.md`.
- **Findings:** **Confirmed** that the old handoff mixed current facts, resolved
  incidents, old test counts, and future work across 819 lines. **Confirmed** that
  `5dcdf0d:HANDOFF.md` preserves the full pre-migration record.
- **Verification:** `pnpm typecheck` passed; `pnpm test` passed 166/166 tests in 28
  files; `pnpm --filter @quorum/client-web build` passed with the existing large
  chunk warning.
- **Issues created or updated:** Created QRM-REL-001, QRM-SEC-001 through
  QRM-SEC-003, QRM-REL-002, QRM-ARCH-001, QRM-DOC-001, QRM-CFG-001,
  QRM-AGENT-001, QRM-OBS-001, and QRM-REMOTE-001 from previously scattered open
  statements.
- **Remaining uncertainty:** Real Windows portable behavior remains unverified.
- **Recommendation:** Execute the single Windows acceptance action above and
  record raw evidence without changing unrelated issue state.

### 2026-07-16 - Participant visibility and current Windows package baseline

- **Role:** Implementation and acceptance participants; individual authors remain
  available in Git history.
- **Task:** Restore participant selection visibility in New Session and validate
  the corrected package.
- **Context inspected:** Session setup layout, participant rows, responsive CSS,
  browser behavior, Windows workflow.
- **Actions performed:** Moved participants before metadata/mode/permissions, added
  bounded participant scrolling, prevented row shrink overlap, and tightened
  responsive permission layout.
- **Files modified:** Web client, styles, README, and historical handoff files.
- **Findings:** **Confirmed** that participant options are visible in the initial
  modal viewport at desktop, tablet, and mobile widths.
- **Verification:** local typecheck, 166 tests, Web build, isolated Playwright at
  1440x858, 958x858, and 390x844; Windows run 29487295657 green on `1ab960c`.
- **Issues created or updated:** implementation defect resolved; QRM-REL-001
  remains because CI does not replace real-machine interaction.
- **Remaining uncertainty:** fresh Windows Explorer launch and CLI discovery.
- **Recommendation:** perform QRM-REL-001 acceptance.

### 2026-07-16 - Reliability, security, document, and UX remediation

- **Role:** Independent reviewers and implementation participants; exact authors
  are preserved in commits `e335e1f..548b67d`.
- **Task:** Resolve reported P1/P2/P3 execution and UX findings.
- **Context inspected:** workspaces, scheduler recovery, DOCX extraction, Codex
  process lifecycle, attachments, WebSocket filtering, Markdown/CSP, composer
  concurrency, status projection, Echo compatibility, and responsive Session
  creation.
- **Actions performed:** Enforced explicit neutral workspaces, restart-idempotent
  prompts, actual DOCX expansion limits, awaited Codex process termination,
  detached attachment payloads, stale-socket isolation, passive rendering,
  bounded concurrent reads, latest-turn status, FIFO settling prompts, correlated
  Session creation, strict Echo sanitization, and responsive accessible dialogs.
- **Files modified:** protocol, core, daemon, Web client, desktop config, tests,
  scripts, README, and historical handoff files.
- **Findings:** **Confirmed** that the reported execution and UX defects have direct
  regression coverage. **Confirmed** that guarded command execution remains short
  of OS sandboxing.
- **Verification:** progressive local matrices reached 166/166 tests; Windows runs
  29470431610, 29484858873, and 29487295657 are green at their stated commits.
- **Issues created or updated:** resolved the concrete review defects; retained
  QRM-SEC-001, QRM-SEC-002, QRM-REL-001, and QRM-REL-002.
- **Remaining uncertainty:** strong sandboxing and real-machine package behavior.
- **Recommendation:** do not reopen resolved defects without new reproducible
  evidence; continue through the active issue registry.

### 2026-07-14 to 2026-07-15 - Product completion and live-path stabilization

- **Role:** Human, Codex, Claude Code, reviewers, and room-generated participants;
  exact attribution is in Git history.
- **Task:** Turn the shared-session kernel into a usable desktop/Web product and
  stabilize credentials, native CLIs, context continuity, modes, rich output, and
  attachments.
- **Context inspected:** full monorepo, local and Windows packaging, provider APIs,
  CLI subprocesses, persistent sessions, browser UI, meeting/session transcripts.
- **Actions performed:** Implemented provider/model profiles, credential UI and
  stable stores, New Session, modes/order/round targets/wrap-up, native resume plus
  Context Bundle fallback, deletion/archive/export, health checks, run status,
  bilingual UI, clipboard images, PDF/DOCX, rich Markdown/Mermaid, workspace
  selection, portable packaging, and Windows CLI path handling.
- **Files modified:** repository-wide; see archived commit groups and
  `5dcdf0d:HANDOFF.md`.
- **Findings:** **Confirmed** that credentials previously appeared lost because
  development launches selected different SQLite files; the stable credential
  store fixed that class of failure. **Confirmed** that provider secrets are not
  embedded in portable artifacts.
- **Verification:** historical test counts progressed from 85 through 166 with
  linked Windows runs in the archived handoff.
- **Issues created or updated:** product defects resolved; long-term security,
  packaging, integration, observability, and remote work remain active above.
- **Remaining uncertainty:** platform-specific behavior outside tested machines.
- **Recommendation:** use current Active Issues, not historical Suggested next
  steps, to select work.

## Archived Summary

### Evidence retention

- The complete 819-line pre-migration handoff is immutable in Git at
  `5dcdf0d:HANDOFF.md`; the Chinese historical record is at
  `5dcdf0d:HANDOFF.zh.md`.
- This summary intentionally removes duplicate prose and obsolete "current"
  assertions, not evidence. Use `git show 5dcdf0d:HANDOFF.md` for the full
  file-by-file implementation trail and every intermediate test count.
- Commit authorship, dates, and diffs remain authoritative through `git log` and
  `git show`.

### Architectural decisions retained

1. **Event-sourced authority:** Quorum events, snapshots, memory summaries, and
   deterministic Context Bundles are authoritative. Native model sessions are
   optional continuity accelerators and may fall back without losing Quorum state.
2. **Shared-session kernel:** `7d303b8` introduced SessionManager, mailbox,
   arbitration, explicit phases, and the legacy adapter bridge. Subsequent commits
   added replay projections, memory compaction, tools, persistence, scheduling,
   continuation, and diagnostics.
3. **Heterogeneous native agents:** Codex and Claude Code use local CLI
   authentication and subprocesses; API models use provider credentials. Prompt
   content travels through stdin rather than Windows shell argv.
4. **Workspace coordination:** canonical workspace paths share one coordinator,
   lease, and watcher across Sessions. Branch switching does not reset heads, dirty
   baselines are refused, and rollback uses the same serialization boundary.
5. **Human-visible execution:** Chat is message-only. Run stages, bids, tool
   approvals, traces, memory, replay, and checkpoints remain outside the primary
   transcript.
6. **Advisory rounds:** discussion round targets encourage convergence and trigger
   a mandatory final wrap-up rather than hard-cutting unfinished conversation.
7. **Bounded attachments:** active-topic images and extracted document text are
   bounded; historical events retain metadata while payloads are detached in
   SQLite.
8. **Portable desktop:** Tauri starts an authenticated loopback Bun sidecar and
   stores runtime state in app-local writable paths. Windows artifacts are
   distributable but unsigned.

### Rejected or superseded approaches

- Treating native hidden state as the source of truth was rejected because it is
  not inspectable, portable, or replayable.
- Provider-centric participant UI and permanently exposed API-key forms were
  replaced by agent/model profiles plus a hidden credential modal.
- Passing prompts through shell command arguments was replaced by stdin after
  Windows command-injection review.
- Destructive `git checkout -B` initialization was replaced by safe existing/new
  branch handling and dirty-tree refusal.
- Per-Session workspace mutexes were replaced by a canonical cross-Session
  coordinator.
- Optimistic Session dialog close, uncorrelated errors, repeated sole-agent bids,
  and hard round cutoffs were replaced by confirmation, request ids, explicit
  completion, and mandatory wrap-up.
- The guarded command runner must not be described as a strong sandbox; that claim
  remains explicitly rejected until QRM-SEC-001 is resolved.

### Implementation epochs

| Epoch | Representative evidence | Durable result |
| --- | --- | --- |
| Foundation and M0-M5 | `d5ac91c`, `c92f387`, `3db9ed9`, `1ca2b6c` | Protocol, event log, Conductor, agents, Git workspace, Web client |
| Shared-session migration | `7d303b8`, `eaf18b2`, `64d0a42`, `0603b32` | Session state machine, projections, persistence, replay, memory |
| Sidecar and desktop | `1d7f27c`, `81aef87`, `de2ff9b`, `ff6825f`, `827efdb` | Authenticated sidecar, Node fallback, Tauri bundles |
| Product workflow | commits listed in `5dcdf0d:HANDOFF.md` entries 20-60 | Credentials, profiles, Session lifecycle, modes, continuity, health, traces |
| Windows hardening | `d8d15d3`, `ccbc1b5`, `ba4a994` and later security commits | Portable build, app-local paths, CLI discovery, shell-safe execution |
| Reliability review | `e335e1f..7f548c9` | Workspace, restart, DOCX, process, attachment, socket, CSP hardening |
| UX acceptance | `3429e69..1ab960c` | Echo, composer, accessible dialogs, responsive layout, participant visibility |

### Historical CI references

| Run | Commit or checkpoint | Preserved conclusion |
| --- | --- | --- |
| 29314485107 | `298a2f1` era | Security/reliability package matrix accepted |
| 29384116932 | `8d62e0e` | Credential-save and portable packaging paths green |
| 29391070418 | `7301fc0` | Credential availability with zero Sessions green |
| 29470431610 | `fabc213` | Review-remediation package matrix green |
| 29484858873 | `548b67d` | 166 tests and real PDF/DOCX compiled-sidecar smoke green |
| 29487295657 | `1ab960c` | Current implementation package baseline green |

These CI results prove their listed automated scope only. They do not close
QRM-REL-001, QRM-SEC-001, signing, notarization, or real-machine release
acceptance.

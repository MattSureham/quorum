# HANDOFF

Canonical collaboration state for **Quorum**. Updated **2026-07-28**.
The protocol source is [`BOOTSTRAP.md`](./BOOTSTRAP.md). Repository evidence
always takes precedence over this summary.

## Collaboration Protocol

### Mandatory rules

1. Read this file before inspecting or changing the project.
2. **Recent Activity** entries are participant-owned records. Append one entry for
   your own work; never rewrite another participant's entry except to correct an
   objectively wrong reference.
3. **Current State**, **Active Issues**, and **Next Action** are shared derived
   projections. Update them only from verified new evidence that you also record
   in your own new Recent Activity entry.
4. Append new evidence to an Active Issue without erasing earlier evidence. Change
   status, severity, owner, or resolution state only when the new entry explains
   the reason and cites the supporting evidence.
5. Preserve prior evidence and participant records. Never silently rewrite or
   delete another participant's findings.
6. Record disagreement as new evidence. Do not overwrite the earlier claim.
7. Label material claims as **Confirmed**, **Inferred**, or **Unknown**:
   - **Confirmed**: directly supported by repository contents, an executed check,
     a linked CI run, or a reproduced observation.
   - **Inferred**: a reasoned conclusion that has not been directly verified.
   - **Unknown**: evidence is absent or conflicting.
8. Record only checks that were actually executed. Include the command, result,
   relevant count, commit, platform, or artifact when available.
9. Repository source, tests, Git history, and reproducible runtime evidence outrank
   chat history and summaries.
10. Before replacing **Next Action**, record the prior action as completed,
    blocked, or reprioritized in your activity entry and, when applicable, its
    Active Issue.
11. Leave exactly one bounded item under **Next Action** before finishing.
12. Keep the history understandable when every participant changes between turns.

### Section ownership and meaning

- **Current State** is the authoritative present-tense shared projection. It must
  remain understandable without reading the activity log.
- **Active Issues** is the shared complete set of known unresolved work. Issue
  identifiers are stable and must not be reused.
- **Next Action** is the shared single highest-priority bounded handoff task.
- **Recent Activity** is the participant-owned append-only explanation of how the
  shared projections changed. Newest entries go first.
- **Archived Summary** is maintained only through the archival procedure below.
  It compresses older activity while retaining architectural decisions, unresolved
  findings, rejected approaches, and traceable evidence.

### Archival procedure

When Recent Activity becomes too large for efficient handoff, a participant may
replace the oldest contiguous batch of complete activity entries only when all of
the following are true:

1. Every still-unresolved finding in the batch already has a stable Active Issue.
2. The exact pre-archive file is preserved at a named Git commit and cited as
   `<commit>:HANDOFF.md`.
3. Archived Summary records the batch's date range, participants or roles, relevant
   commits, architectural decisions, rejected approaches, major reasoning,
   verification evidence, and Active Issue mapping.
4. At least the five newest activity entries remain detailed unless fewer than five
   exist.
5. The participant performing the archive appends its own Recent Activity entry
   describing the compression and its Git anchor. Archival never silently removes
   evidence or changes the accepted meaning of an unresolved issue.

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

#### Approved evolution: shared projections and traceable archival (2026-07-28)

- **Proposal:** make participant-owned activity records distinct from the shared
  Current State, Active Issues, and Next Action projections; define how evidence,
  issue state, action replacement, and archival may update them.
- **Motivation:** the initial protocol required participants to update only their
  own state while also requiring one shared current snapshot and future archival,
  but did not close the ownership and compression semantics.
- **Compatibility:** prior activity entries and evidence remain unchanged. The new
  rules only govern future projection updates and evidence-preserving archival.
- **Migration impact:** no existing history is deleted or rewritten. The current
  archive remains anchored at `5dcdf0d:HANDOFF.md`.
- **Approval:** the repository owner explicitly approved adopting this evolution on
  2026-07-28 before this document update.

## Current State

### Snapshot identity

| Field | Value | Confidence |
| --- | --- | --- |
| Repository | `MattSureham/quorum` | Confirmed |
| Branch | `main`, tracking `origin/main` | Confirmed |
| Current runtime source baseline | `1ab960c`; later committed changes before this review are documentation-only | Confirmed |
| Snapshot date | 2026-07-28, Asia/Shanghai | Confirmed |
| Canonical handoff | This file | Confirmed |
| Historical Chinese handoff | `HANDOFF.zh.md`, non-canonical | Confirmed |

### Authoritative project snapshot

| State | Claim | Evidence |
| --- | --- | --- |
| Confirmed | Quorum is a TypeScript/pnpm monorepo for a human and heterogeneous local CLI or API agents collaborating in persistent shared sessions. | `package.json`, workspace packages, `README.md` |
| Confirmed | The append-only event log is the authority. SQLite stores events, session metadata, projections, snapshots, memory, attachment payloads, credentials, and agent-private native session ids. | `packages/core/src/event-log.ts`, `packages/daemon/src/persistence/sqlite-store.ts` |
| Confirmed | The desktop sidecar starts the shared-session host. The generic CLI still selects shared-session only when `QUORUM_SESSION_KERNEL=shared`; otherwise it reports `legacy-conductor`. | `packages/daemon/src/sidecar.ts`, `packages/cli/src/index.ts` |
| Confirmed | Shared sessions support open discussion, raise hand, and strict round robin, configurable speaker order, advisory target rounds, mandatory final wrap-up, interrupts, and addressed turns. Active-turn and settling prompt queues are FIFO, but collecting/arbitrating prompt handling has the open QRM-SCHED-001 race. | `packages/core/src/session-manager.ts`, its tests, and the 2026-07-28 reproduction below |
| Confirmed | Sessions persist across restart. Continue rebuilds from Quorum events and memory; Codex and Claude Code native resume is best effort and falls back to a deterministic Context Bundle. Native hidden state is not the source of truth. | shared-session host, adapters, SQLite tests |
| Confirmed | Agents include local Codex and Claude Code CLIs, OpenAI-compatible API models, deterministic Echo, and an OpenClaw placeholder. Provider catalogs and credentials are separate from participant profiles. | adapter registry, profile catalog, Web UI |
| Confirmed | Provider credentials are daemon-level state. API keys are stored as plaintext JSON in local SQLite and only masked previews are returned to the browser. Codex and Claude Code retain their own CLI authentication. | `SPEC.md` credential boundary, `README.md`, SQLite credential paths |
| Confirmed | A canonical workspace coordinator serializes editable turns across sessions sharing a path. Git checkpoints, rollback, dirty-tree refusal, safe branch switching, and process termination ordering have regression coverage. | workspace and shared-session tests |
| Confirmed | The Web UI centers Sessions, Chat, participants/models, hidden credential configuration, agent health, run status, diagnostics, replay, memory, lifecycle actions, rich Markdown/Mermaid output, bilingual controls, and accessible Session setup at the tested widths. Responsive breakpoint edges and late create errors remain open as QRM-UX-001 and QRM-WEB-002. | `packages/client-web`, browser acceptance at `1ab960c`, and current issue evidence |
| Confirmed | Image paste/upload, PDF, and DOCX attachments are bounded. PDF/DOCX text is extracted locally; historical event replay keeps metadata while payload bodies live in separate SQLite rows. | attachment extractor, schema, gateway and smoke tests |
| Confirmed | Windows packaging produces unsigned x64 NSIS and portable artifacts containing the Bun sidecar. The Node sidecar remains a tested fallback. | Windows workflow, packaging scripts |
| Confirmed | Chat remains message-only; operational events belong in run status and diagnostics. | Web UI rendering and security tests |

### Latest verification of the current implementation

Executed locally on 2026-07-28 against the current runtime source tree before this
HANDOFF-only review update:

| Command | Result | Confidence |
| --- | --- | --- |
| `pnpm typecheck` | Passed | Confirmed |
| `pnpm test` | 28 files, 166/166 tests passed | Confirmed |
| `pnpm --filter @quorum/client-web build` | Passed; existing Vite large-chunk warning only | Confirmed |
| `pnpm audit --prod` | Passed; no known vulnerabilities reported | Confirmed |

- **Confirmed current failure:** a deterministic inline `tsx` reproduction submits
  a second prompt when the first bid is recorded. The first submission fulfills,
  the second rejects with `illegal session phase transition: idle -> arbitrating`,
  two human messages persist, no agent turn completes, and the final idle snapshot
  retains an epoch-2 pending bid. See QRM-SCHED-001.

Historical external acceptance:

- **Confirmed:** [Windows Packages run 29487295657](https://github.com/MattSureham/quorum/actions/runs/29487295657)
  is green on exact implementation commit `1ab960c`. It ran 166 tests,
  compiled-sidecar smoke, Web and unsigned NSIS builds, portable layout
  validation, and all four artifact uploads.
- **Confirmed:** isolated Playwright/Chrome acceptance at `1ab960c` passed at
  1440x858, 958x858, and 390x844 with participant selection visible and
  non-overlapping.
- **Confirmed historical evidence:** targeted responsive, keyboard, Session
  creation, Echo, attachment, prompt-queue, and credential scenarios passed on
  earlier 2026-07-16 checkpoints recorded in Git history. Those targeted widths do
  not close the breakpoint-edge observations in QRM-UX-001.
- **Unknown at this snapshot:** corrected portable behavior has not been recorded
  from a fresh real Windows machine against the latest accepted artifact.

### Present constraints

| Confidence | Constraint | Evidence |
| --- | --- | --- |
| Confirmed | Quorum's local command executor is guarded but is not a strong OS sandbox. | QRM-SEC-001 and `local-sandbox-executor.ts` |
| Confirmed | Direct API provider secrets rely on OS account and file permissions; there is no Keychain, Credential Manager, or field encryption. | QRM-SEC-003, `SPEC.md`, and SQLite credential storage |
| Confirmed | Windows artifacts are unsigned. Signing, notarization, updating, and complete cross-platform release acceptance are unfinished. | QRM-REL-001, QRM-REL-002, and the Windows workflow |
| Confirmed | Scanned PDFs require OCR, legacy `.doc` is unsupported, and local CLI image input lacks a dedicated safe file bridge. | QRM-DOC-001 and attachment implementation |
| Confirmed | The legacy and shared kernels have not fully converged. Shared-session mode does not implement the legacy runtime `set_policy` operation. | QRM-ARCH-001 and kernel selection code |

## Active Issues

### QRM-SCHED-001 - Prompt race during bid collection and arbitration

- **Status:** Open
- **Severity:** P1 correctness and message-delivery failure
- **Owner:** Unassigned
- **Confidence:** Confirmed
- **Evidence:** on the current source tree, a deterministic reproduction submits a
  second prompt from the first `bid_submitted` event. The first submission
  fulfills, the second rejects with
  `illegal session phase transition: idle -> arbitrating`; both human messages are
  in the EventLog, no agent turn completes, and the idle epoch-2 snapshot retains a
  pending bid. `SessionManager.submitUserPrompt()` queues active, speaking,
  speaker-granted, and settling phases but not `collecting_bids` or `arbitrating`;
  an old bid collector later calls `postBidArbitrate` without an epoch guard.
- **Current resolution state:** active-turn and settling FIFO tests pass, but no
  collecting/arbitrating regression exists. Queue prompts in those phases and make
  stale bid collection/arbitration generation-safe before closing this issue.

### QRM-UX-001 - Responsive breakpoint-edge regressions

- **Status:** Open
- **Severity:** P1 responsive operability
- **Owner:** Unassigned
- **Confidence:** Confirmed
- **Evidence:** the 2026-07-16 browser review observed a clipped Interrupt action at
  1281px and an approximately 62px Chat feed at 961px. Current
  `styles.css` still switches compact columns only at `max-width: 1280px` and
  document flow only at `max-width: 960px`; later CSS changes affect Session setup,
  not these breakpoints or the base 240/340px sidebars.
- **Current resolution state:** the specifically tested desktop, tablet, and mobile
  sizes pass, but `breakpoint + 1px` remains uncovered. Fix both discontinuities and
  add automated geometry checks around each breakpoint.

### QRM-WEB-001 - Live Web connection-state integration coverage

- **Status:** Open
- **Severity:** P3 reliability test debt
- **Owner:** Unassigned
- **Confidence:** Confirmed
- **Evidence:** `socket-message-filter.test.ts` covers stale sockets and cross-room
  messages as pure filtering logic, but the unresolved checks preserved at
  `5dcdf0d:HANDOFF.md` lines 232, 252, and 792 require rapid Session switching,
  reconnect, active-Session deletion fallback, and agent-health routing through the
  React ref/hook state machine.
- **Current resolution state:** no current runtime defect is asserted for all four
  flows, but there is no reducer, hook, or browser integration regression proving
  their interaction.

### QRM-WEB-002 - Expired Session-create errors escape correlation

- **Status:** Open
- **Severity:** P2 UI reliability
- **Owner:** Unassigned
- **Confidence:** Confirmed
- **Evidence:** the 12-second Session-create timeout clears
  `pendingSessionCreateRef`. A later `error` carrying that expired request id can no
  longer satisfy `matchesSessionCreateError()` and falls through to the global
  `setError()`, surfacing an obsolete creation failure in Connection. Existing
  correlation tests cover current and unrelated pending ids, not expired or
  replaced ids.
- **Current resolution state:** late success cannot switch rooms, and current
  request errors remain in the modal. Issued create request ids still need bounded
  history so known late errors can be ignored after timeout or replacement.

### QRM-REL-001 - Real Windows portable acceptance

- **Status:** Open
- **Severity:** P1 release gate
- **Owner:** Unassigned; requires a Windows x64 tester
- **Confidence:** Confirmed
- **Evidence:** run 29487295657 proves build, tests, packaging, and archive layout,
  but the prior real-machine artifact exposed CLI detection and Session creation
  defects. No fresh real-machine result is recorded for the corrected artifact.
- **Current resolution state:** corrected artifact exists and remains ready for
  Explorer launch, CLI discovery, Session creation, credential persistence,
  shared-workspace, restart/Continue, and sidecar-shutdown checks. This action was
  reprioritized behind the currently reproducible QRM-SCHED-001 failure; Windows
  `.cmd` adversarial scope is tracked separately as QRM-SEC-004.

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

### QRM-SEC-004 - Real Windows `.cmd` adversarial acceptance

- **Status:** Open
- **Severity:** P1 security acceptance gate
- **Owner:** Unassigned; requires a Windows x64 tester with real Codex and Claude
  Code `.cmd` shims
- **Confidence:** Confirmed
- **Evidence:** prompts are transported through stdin, network adapter configuration
  and Windows binary arguments are strictly validated, and automated package tests
  are green. The still-open real-machine matrix preserved at
  `5dcdf0d:HANDOFF.md` lines 227 and 248 was compressed to only `&` and `|` during
  migration.
- **Current resolution state:** test literal `&`, `|`, `%VAR%`, `^`, redirection
  operators, quotes, and newlines through real `.cmd` shims. Confirm prompt delivery
  and prove there is no marker file, second command, variable expansion, or
  redirection side effect. This may be performed with QRM-REL-001 but must be
  reported separately.

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

1. Resolve QRM-SCHED-001: add a deterministic SessionManager regression that
   submits a second human prompt from the first `bid_submitted` event, then queue
   prompts received during `collecting_bids` or `arbitrating` and prevent stale
   bid collectors from arbitrating a newer epoch. Require exact FIFO prompt
   capture, one completed agent turn per human prompt, no illegal phase transition,
   and a final `idle` snapshot with zero pending bids; run the focused
   SessionManager tests, full `pnpm test`, and `pnpm typecheck`, then update
   QRM-SCHED-001 and Recent Activity with the result.

## Recent Activity

### 2026-07-28 - Evidence reconciliation and approved protocol evolution

- **Role:** Codex review coordinator with independent protocol, repository-fact,
  and integration reviewers
- **Task:** Review the canonical handoff against `BOOTSTRAP.md`, reconcile it with
  current repository evidence, and adopt the explicitly approved protocol
  clarification.
- **Context inspected:** complete `BOOTSTRAP.md`, `HANDOFF.md`, historical
  `HANDOFF.zh.md`, `README.md`, `5dcdf0d:HANDOFF.md`, current Git history and
  remote state, SessionManager prompt scheduling, Session-create correlation,
  responsive CSS, existing Web state tests, and Windows Packages run 29487295657.
- **Actions performed:** clarified participant-owned records versus shared derived
  projections; added the evidence-preserving archival procedure and its approved
  evolution record; removed migration narrative from Current State; qualified
  current scheduler and Web claims; restored omitted issue and Windows adversarial
  evidence; and reprioritized the single Next Action from Windows manual acceptance
  to the reproducible scheduler failure.
- **Files modified:** `HANDOFF.md` only. Existing untracked
  `docs/quorum-intro.html` was preserved and excluded.
- **Findings:** **Confirmed** that the required five state sections, one Next
  Action, README entry, historical handoff marker, Git anchors, and sampled links
  were already structurally sound. **Confirmed** that Current State constraints
  lacked confidence labels and the migration omitted QRM-SCHED-001, QRM-UX-001,
  QRM-WEB-001, QRM-WEB-002, and the complete QRM-SEC-004 acceptance matrix.
  **Confirmed** that broad 2026-07-16 resolution claims are historical evidence,
  not the current accepted state where the new reproduction disagrees.
- **Verification:** `pnpm typecheck` passed; `pnpm test` passed 166/166 tests in 28
  files; `pnpm --filter @quorum/client-web build` passed with the existing
  large-chunk warning; `pnpm audit --prod` reported no known vulnerabilities. A
  deterministic inline `tsx` scheduler reproduction produced two persisted human
  messages, zero completed turns, an `idle -> arbitrating` rejection, and an idle
  snapshot with a pending bid. GitHub's public summary confirms Windows Packages
  run 29487295657 succeeded on `1ab960c` with four artifacts. The HANDOFF structure
  check found all five required sections, exactly one Next Action, and 16 unique
  Active Issues with every required field; `git diff --check` passed.
- **Issues created or updated:** created QRM-SCHED-001, QRM-UX-001, QRM-WEB-001,
  QRM-WEB-002, and QRM-SEC-004; updated QRM-REL-001 to preserve its manual matrix
  while recording why it is no longer the highest-priority action.
- **Remaining uncertainty:** no fresh 2026-07-28 browser run was claimed for the
  responsive observations; they remain confirmed by the 2026-07-16 browser
  evidence plus unchanged relevant CSS. Real Windows portable and `.cmd` behavior
  remain unverified.
- **Recommendation:** execute the bounded QRM-SCHED-001 regression and fix above,
  then return to the independent Windows acceptance issues.

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
- Broad historical statements that all reported execution/UX defects were resolved
  remain preserved in their original activity and archive context. Current
  QRM-SCHED-001, QRM-UX-001, and QRM-WEB-002 contain later superseding evidence and
  control the accepted present state without rewriting those earlier records.

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

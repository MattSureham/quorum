# @quorum/client-web (M5 — placeholder)

A thin client that renders the room event stream and sends commands over WebSocket.
Nothing here is required for the daemon, the CLI, the demo, or the tests.

Planned stack: React + Vite + Tailwind. It connects to the daemon, sends
`subscribe`, and renders `event` / `snapshot` messages (see SPEC §10):

- group-chat transcript with @mentions and reply threading
- collapsible tool-call / tool-result activity
- per-turn diff view from `checkpoint` events, with rollback
- floor controls: switch policy (free-for-all / directed / moderated), interrupt
- per-call tool approval for agents that support it (Claude); Codex shown as policy-gated

To scaffold later:

    pnpm create vite@latest packages/client-web -- --template react-ts

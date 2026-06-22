# @quorum/client-web

A thin client that renders the room event stream and sends commands over WebSocket.

## Run

```bash
pnpm web:dev
```

Open `http://127.0.0.1:5173`. The client defaults to `ws://127.0.0.1:8787`
and room `main`. If the daemon is offline, it shows preview data so layout and
controls can still be reviewed.

## Current Surface

- live room stream from `snapshot` and `event` WebSocket messages
- connection settings for local daemon URL and room id
- participant and active floor indicators
- policy switching for `free-for-all`, `directed`, and `moderated`
- human message composer with agent target chips
- interrupt button
- checkpoint and tool activity panels

## Build

```bash
pnpm web:build
```

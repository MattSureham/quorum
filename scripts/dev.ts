// One command to bring up a full local stack: the daemon (WS gateway on 8787)
// and the web client (Vite on 5173). A crashed daemon is restarted while Vite
// stays available, allowing the browser to reconnect without losing its UI.
// Dependency-free: just node + the repo's tsx.
import { spawn, type ChildProcess } from "node:child_process";
import { resolve } from "node:path";

const children: { name: string; proc: ChildProcess }[] = [];
let stopping = false;
const childEnv = {
  ...process.env,
  QUORUM_CREDENTIAL_DB_PATH: process.env.QUORUM_CREDENTIAL_DB_PATH ?? resolve(".quorum/credentials.sqlite"),
};

function start(name: string, command: string, args: string[], restartOnExit = false): void {
  // detached => each child leads its own process group, so on shutdown we can
  // signal the whole group (kill -pid) and also reach grandchildren (tsx->node,
  // pnpm->vite) instead of leaking them.
  const proc = spawn(command, args, { stdio: "inherit", env: childEnv, detached: true });
  children.push({ name, proc });
  proc.on("error", (err) => {
    console.error(`[dev] failed to start ${name}: ${err.message}`);
  });
  proc.on("close", (code, signal) => {
    const index = children.findIndex((child) => child.proc === proc);
    if (index >= 0) children.splice(index, 1);
    if (stopping) return;
    if (restartOnExit) {
      console.error(`\n[dev] ${name} exited (${signal ?? code}) — restarting in 1s.`);
      setTimeout(() => {
        if (!stopping) start(name, command, args, true);
      }, 1_000);
      return;
    }
    console.log(`\n[dev] ${name} exited (${signal ?? code}) — stopping the rest.`);
    void stop(typeof code === "number" ? code : 1);
  });
}

async function stop(code: number): Promise<void> {
  if (stopping) return;
  stopping = true;
  await Promise.all(
    children.map(({ proc }) =>
      new Promise<void>((resolve) => {
        if (proc.pid === undefined || proc.exitCode !== null || proc.signalCode !== null) return resolve();
        proc.once("exit", () => resolve());
        try {
          process.kill(-proc.pid, "SIGINT");
        } catch {
          return resolve();
        }
        // last resort if a child ignores SIGINT
        setTimeout(() => {
          try {
            if (proc.pid !== undefined) process.kill(-proc.pid, "SIGKILL");
          } catch { /* already gone */ }
          resolve();
        }, 4000);
      }),
    ),
  );
  process.exit(code);
}

process.on("SIGINT", () => void stop(0));
process.on("SIGTERM", () => void stop(0));

start("daemon", "tsx", ["packages/cli/src/index.ts"], true);
start("web", "pnpm", ["--filter", "@quorum/client-web", "dev"]);

console.log("[dev] daemon -> ws://127.0.0.1:8787   web -> http://127.0.0.1:5173   (daemon auto-restarts; Ctrl-C stops both)");
console.log(`[dev] credentials -> ${childEnv.QUORUM_CREDENTIAL_DB_PATH}`);

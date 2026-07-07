import { mkdir, rm } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

await rm("dist-sidecar/bun", { recursive: true, force: true });
await mkdir("dist-sidecar/bun", { recursive: true });
await exec("bun", [
  "build",
  "--compile",
  "packages/daemon/src/sidecar.ts",
  "--outfile",
  "dist-sidecar/bun/quorum-sidecar",
], { cwd: process.cwd() });

console.log("bun sidecar written to dist-sidecar/bun/quorum-sidecar");

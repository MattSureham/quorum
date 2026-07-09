import { chmod, copyFile, mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);
const sidecarName = process.platform === "win32" ? "quorum-sidecar.exe" : "quorum-sidecar";
const compatibilityName = process.platform === "win32" ? "quorum-sidecar" : "quorum-sidecar.exe";
const outfile = `dist-sidecar/bun/${sidecarName}`;
const compatibilityOutfile = `dist-sidecar/bun/${compatibilityName}`;
const localBun = resolve(".tools/bun/bin", process.platform === "win32" ? "bun.exe" : "bun");
const bun = existsSync(localBun) ? localBun : "bun";

await rm("dist-sidecar/bun", { recursive: true, force: true });
await mkdir("dist-sidecar/bun", { recursive: true });
await exec(bun, [
  "build",
  "--compile",
  "packages/daemon/src/sidecar.ts",
  "--outfile",
  outfile,
], { cwd: process.cwd() });
await copyFile(outfile, compatibilityOutfile);
if (process.platform !== "win32") {
  await chmod(outfile, 0o755);
  await chmod(compatibilityOutfile, 0o755);
}

console.log(`bun sidecar written to ${outfile} (compatibility copy ${compatibilityOutfile})`);

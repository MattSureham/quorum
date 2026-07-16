import { chmod, cp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);
const outDir = resolve("dist-sidecar/node");
const launcher = resolve(outDir, "quorum-sidecar.mjs");
const shell = resolve(outDir, "quorum-sidecar");
const nodeModules = resolve(outDir, "node_modules");

async function link(target: string, path: string): Promise<void> {
  await rm(path, { force: true, recursive: true });
  await symlink(relative(dirname(path), target), path);
}

async function writeWorkspacePackage(name: "core" | "protocol" | "daemon"): Promise<void> {
  const dir = resolve(outDir, "packages", name);
  await mkdir(dir, { recursive: true });
  await cp(resolve("packages", name, "dist"), resolve(dir, "dist"), { recursive: true });
  await writeFile(
    resolve(dir, "package.json"),
    JSON.stringify({
      name: `@quorum/${name}`,
      version: "0.0.1",
      type: "module",
      main: "./dist/index.js",
      exports: name === "daemon"
        ? {
            ".": "./dist/index.js",
            "./sidecar": "./dist/sidecar.js",
          }
        : {
            ".": "./dist/index.js",
            "./schema": name === "protocol" ? "./dist/schema.js" : undefined,
          },
    }, null, 2),
    "utf8",
  );
}

await exec("pnpm", ["build"], { cwd: process.cwd() });
await rm(outDir, { recursive: true, force: true });
await mkdir(dirname(launcher), { recursive: true });
await writeWorkspacePackage("protocol");
await writeWorkspacePackage("core");
await writeWorkspacePackage("daemon");
await mkdir(resolve(nodeModules, "@quorum"), { recursive: true });
await mkdir(resolve(nodeModules, "@xmldom"), { recursive: true });
await link(resolve(outDir, "packages/protocol"), resolve(nodeModules, "@quorum/protocol"));
await link(resolve(outDir, "packages/core"), resolve(nodeModules, "@quorum/core"));
await link(resolve(outDir, "packages/daemon"), resolve(nodeModules, "@quorum/daemon"));
await link(resolve("packages/daemon/node_modules/@xmldom/xmldom"), resolve(nodeModules, "@xmldom/xmldom"));
await link(resolve("packages/daemon/node_modules/better-sqlite3"), resolve(nodeModules, "better-sqlite3"));
await link(resolve("packages/daemon/node_modules/unpdf"), resolve(nodeModules, "unpdf"));
await link(resolve("packages/daemon/node_modules/ws"), resolve(nodeModules, "ws"));
await link(resolve("packages/daemon/node_modules/yauzl"), resolve(nodeModules, "yauzl"));
await link(resolve("packages/protocol/node_modules/zod"), resolve(nodeModules, "zod"));

await writeFile(
  launcher,
  [
    "#!/usr/bin/env node",
    "import './packages/daemon/dist/sidecar.js';",
    "",
  ].join("\n"),
  "utf8",
);
await chmod(launcher, 0o755);

await writeFile(
  shell,
  [
    "#!/usr/bin/env sh",
    "DIR=$(CDPATH= cd -- \"$(dirname -- \"$0\")\" && pwd)",
    "exec node \"$DIR/quorum-sidecar.mjs\" \"$@\"",
    "",
  ].join("\n"),
  "utf8",
);
await chmod(shell, 0o755);

console.log(`node sidecar fallback written to ${outDir}`);

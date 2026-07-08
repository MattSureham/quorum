import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import type { ToolCallRequest, ToolCallResult } from "@quorum/protocol";
import type { ToolExecutionContext, ToolExecutor } from "@quorum/core";

export interface LocalSandboxToolExecutorOptions {
  workspacePath: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
  env?: Record<string, string>;
  allowedTools?: string[];
}

const DEFAULT_ALLOWED_TOOLS = new Set(["bash", "shell", "command"]);
const BLOCKED_PATTERNS = [
  /\brm\s+(-[^\s]*[rf][^\s]*|-r|-f)\s+(\/|\*)/i,
  /\bsudo\b/i,
  /\bmkfs\b/i,
  /\bdd\s+if=/i,
  /\bdiskutil\s+erase/i,
  /\bshutdown\b/i,
  /\breboot\b/i,
  /\bchmod\s+-R\s+777\s+\//i,
];

function extractCommand(args: unknown): string | undefined {
  if (typeof args === "string") return args;
  if (!args || typeof args !== "object") return undefined;
  const record = args as Record<string, unknown>;
  const value = record.command ?? record.cmd ?? record.script;
  return typeof value === "string" ? value : undefined;
}

function limitedAppend(current: string, chunk: Buffer, maxBytes: number): string {
  if (Buffer.byteLength(current) >= maxBytes) return current;
  const remaining = maxBytes - Buffer.byteLength(current);
  return current + chunk.subarray(0, remaining).toString("utf8");
}

function sanitizeEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const keep = ["PATH", "HOME", "USER", "TMPDIR", "TEMP", "TMP", "SystemRoot", "ComSpec"];
  const env: NodeJS.ProcessEnv = {};
  for (const key of keep) {
    if (process.env[key]) env[key] = process.env[key];
  }
  return { ...env, ...extra };
}

function resolveSandboxCwd(baseWorkspacePath: string, requested?: string): string {
  const cwd = resolve(requested ?? baseWorkspacePath);
  const rel = relative(baseWorkspacePath, cwd);
  if (rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel))) return cwd;
  return baseWorkspacePath;
}

export function createLocalSandboxToolExecutor(opts: LocalSandboxToolExecutorOptions): ToolExecutor {
  const workspacePath = resolve(opts.workspacePath);
  const timeoutMs = opts.timeoutMs ?? 20_000;
  const maxOutputBytes = opts.maxOutputBytes ?? 64_000;
  const allowedTools = new Set((opts.allowedTools ?? [...DEFAULT_ALLOWED_TOOLS]).map((tool) => tool.toLowerCase()));
  mkdirSync(workspacePath, { recursive: true });

  return {
    execute(req: ToolCallRequest & { callId: string }, ctx: ToolExecutionContext): Promise<ToolCallResult> {
      const tool = req.tool.toLowerCase();
      if (!allowedTools.has(tool)) {
        return Promise.resolve({ callId: req.callId, ok: false, stderr: `external tool not allowed: ${req.tool}`, exitCode: 126 });
      }

      const command = extractCommand(req.args);
      if (!command?.trim()) {
        return Promise.resolve({ callId: req.callId, ok: false, stderr: "missing command", exitCode: 2 });
      }
      if (BLOCKED_PATTERNS.some((pattern) => pattern.test(command))) {
        return Promise.resolve({ callId: req.callId, ok: false, stderr: "command blocked by local sandbox policy", exitCode: 126 });
      }

      return new Promise<ToolCallResult>((resolveResult) => {
        const isWindows = process.platform === "win32";
        const bin = isWindows ? process.env.ComSpec ?? "cmd.exe" : "bash";
        const args = isWindows ? ["/d", "/s", "/c", command] : ["-lc", command];
        const child = spawn(bin, args, {
          cwd: resolveSandboxCwd(workspacePath, ctx.workspacePath),
          env: sanitizeEnv(opts.env),
          windowsHide: true,
          stdio: ["ignore", "pipe", "pipe"],
        });

        let stdout = "";
        let stderr = "";
        let settled = false;
        let timer: NodeJS.Timeout;
        const finish = (result: ToolCallResult) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolveResult(result);
        };
        timer = setTimeout(() => {
          child.kill("SIGTERM");
          finish({ callId: req.callId, ok: false, stdout, stderr: `${stderr}\ncommand timed out after ${timeoutMs}ms`.trim(), exitCode: 124 });
        }, timeoutMs);

        child.stdout.on("data", (chunk: Buffer) => {
          stdout = limitedAppend(stdout, chunk, maxOutputBytes);
        });
        child.stderr.on("data", (chunk: Buffer) => {
          stderr = limitedAppend(stderr, chunk, maxOutputBytes);
        });
        child.on("error", (error) => {
          finish({ callId: req.callId, ok: false, stdout, stderr: error.message, exitCode: 1 });
        });
        child.on("close", (code) => {
          finish({ callId: req.callId, ok: code === 0, stdout, stderr, exitCode: code ?? 1 });
        });
      });
    },
  };
}

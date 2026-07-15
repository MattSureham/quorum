import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SAFE_CLI_VALUE = /^[A-Za-z0-9._:/@+-]+$/;
const WINDOWS_SHELL_META = /[&|<>^%!\r\n"]/u;

export function safeCliValue(value: string, label: string): string {
  if (!SAFE_CLI_VALUE.test(value)) throw new Error(`${label} contains unsupported command-line characters`);
  return value;
}

export function safeWindowsBinary(value: string, label = "CLI binary path", platform = process.platform): string {
  if (platform === "win32" && WINDOWS_SHELL_META.test(value)) {
    throw new Error(`${label} contains unsupported Windows shell characters`);
  }
  return value;
}

export function resolveCliWorkingDirectory(input: {
  workspacePath?: string;
  sessionId?: string;
  roomTitle?: string;
}): string {
  if (input.workspacePath) return input.workspacePath;
  const rawId = input.sessionId ?? input.roomTitle ?? "session";
  const safeId = rawId.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "session";
  const cwd = join(tmpdir(), "agent-session-workspaces", safeId);
  mkdirSync(cwd, { recursive: true });
  return cwd;
}

import { createHash } from "node:crypto";
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
  const slug = rawId
    .replace(/[^A-Za-z0-9_-]+/g, "-")
    .replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, "")
    .slice(0, 48) || "session";
  const fingerprint = createHash("sha256").update(rawId).digest("hex").slice(0, 16);
  const cwd = join(tmpdir(), "agent-session-workspaces", `${slug}-${fingerprint}`);
  mkdirSync(cwd, { recursive: true });
  return cwd;
}

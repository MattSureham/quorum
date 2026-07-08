import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createLocalSandboxToolExecutor } from "./local-sandbox-executor.js";

describe("createLocalSandboxToolExecutor", () => {
  it("runs approved bash commands inside the workspace", async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), "quorum-tool-"));
    try {
      await writeFile(join(workspacePath, "input.txt"), "sandbox-ok\n");
      const executor = createLocalSandboxToolExecutor({ workspacePath, timeoutMs: 2_000 });
      const result = await executor.execute(
        { callId: "call-1", tool: "Bash", args: { command: "cat input.txt" } },
        { sessionId: "room", workspacePath },
      );

      expect(result.ok).toBe(true);
      expect(result.stdout).toContain("sandbox-ok");
    } finally {
      await rm(workspacePath, { recursive: true, force: true });
    }
  });

  it("blocks dangerous commands before execution", async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), "quorum-tool-"));
    try {
      const executor = createLocalSandboxToolExecutor({ workspacePath });
      const result = await executor.execute(
        { callId: "call-2", tool: "Bash", args: { command: "rm -rf /" } },
        { sessionId: "room", workspacePath },
      );

      expect(result.ok).toBe(false);
      expect(result.stderr).toContain("blocked");
      expect(result.exitCode).toBe(126);
    } finally {
      await rm(workspacePath, { recursive: true, force: true });
    }
  });

  it("rejects tools outside the allowlist", async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), "quorum-tool-"));
    try {
      const executor = createLocalSandboxToolExecutor({ workspacePath });
      const result = await executor.execute(
        { callId: "call-3", tool: "Python", args: { command: "print('x')" } },
        { sessionId: "room", workspacePath },
      );

      expect(result.ok).toBe(false);
      expect(result.exitCode).toBe(126);
    } finally {
      await rm(workspacePath, { recursive: true, force: true });
    }
  });
});

import { stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveCliWorkingDirectory } from "./cli-safety.js";

describe("CLI working directory isolation", () => {
  it("uses the explicit Session workspace when one is configured", () => {
    expect(resolveCliWorkingDirectory({
      workspacePath: "/explicit/project",
      sessionId: "room",
    })).toBe("/explicit/project");
  });

  it("creates a neutral per-Session directory instead of inheriting daemon cwd", async () => {
    const cwd = resolveCliWorkingDirectory({ sessionId: "room/with traversal" });
    expect(cwd).toBe(join(tmpdir(), "agent-session-workspaces", "room-with-traversal"));
    expect(cwd).not.toBe(process.cwd());
    expect((await stat(cwd)).isDirectory()).toBe(true);
  });
});

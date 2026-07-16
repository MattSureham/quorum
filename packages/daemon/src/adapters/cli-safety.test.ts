import { stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative } from "node:path";
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
    const withinRoot = relative(join(tmpdir(), "agent-session-workspaces"), cwd);
    expect(withinRoot.startsWith("..")).toBe(false);
    expect(isAbsolute(withinRoot)).toBe(false);
    expect(cwd).toMatch(/room-with-traversal-[a-f0-9]{16}$/);
    expect(cwd).not.toBe(process.cwd());
    expect((await stat(cwd)).isDirectory()).toBe(true);
  });

  it("cannot escape the neutral root or collide after slug normalization", () => {
    const traversal = resolveCliWorkingDirectory({ sessionId: ".." });
    const slash = resolveCliWorkingDirectory({ sessionId: "room/a" });
    const question = resolveCliWorkingDirectory({ sessionId: "room?a" });
    const root = join(tmpdir(), "agent-session-workspaces");

    expect(relative(root, traversal).startsWith("..")).toBe(false);
    expect(isAbsolute(relative(root, traversal))).toBe(false);
    expect(traversal).not.toBe(root);
    expect(slash).not.toBe(question);
  });
});

import { execFile } from "node:child_process";
import { writeFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, it, expect } from "vitest";
import type { CheckpointResult } from "@quorum/core";
import { GitWorkspace } from "./git-workspace.js";

const exec = promisify(execFile);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await sleep(10);
  }
  throw new Error("timed out waiting for condition");
}

async function makeWorkspace(): Promise<{ dir: string; workspace: GitWorkspace }> {
  const dir = await mkdtemp(join(tmpdir(), "quorum-git-"));
  await exec("git", ["-C", dir, "init"]);
  await exec("git", ["-C", dir, "config", "user.email", "test@example.com"]);
  await exec("git", ["-C", dir, "config", "user.name", "Test User"]);
  await exec("git", ["-C", dir, "commit", "--allow-empty", "-m", "init"]);
  const workspace = new GitWorkspace(dir, "main");
  await workspace.init();
  return { dir, workspace };
}

async function git(dir: string, args: string[]): Promise<string> {
  return (await exec("git", ["-C", dir, ...args])).stdout.trim();
}

describe("GitWorkspace", () => {
  it("creates checkpoint commits with diff stats", async () => {
    const { dir, workspace } = await makeWorkspace();
    await writeFile(join(dir, "a.txt"), "hello\n");

    const checkpoint = await workspace.checkpoint("turn", "agent", "event");

    expect(checkpoint).not.toBeNull();
    expect(checkpoint?.stat).toEqual({ files: 1, insertions: 1, deletions: 0 });
    expect(await git(dir, ["status", "--short"])).toBe("");
    expect(await git(dir, ["log", "--format=%s", "-1"])).toBe("chore(room): turn by agent [event]");
  });

  it("serializes write-floor leases", async () => {
    const { workspace } = await makeWorkspace();
    const first = await workspace.acquireWriteFloor("turn-1", "alpha");
    let secondAcquired = false;
    const secondPromise = workspace.acquireWriteFloor("turn-2", "beta").then((lease) => {
      secondAcquired = true;
      return lease;
    });

    await sleep(50);
    expect(secondAcquired).toBe(false);

    first.release();
    const second = await secondPromise;
    expect(secondAcquired).toBe(true);
    second.release();
  });

  it("checkpoints human out-of-band edits", async () => {
    const { dir, workspace } = await makeWorkspace();
    const checkpoints: CheckpointResult[] = [];
    const unwatch = workspace.watchOutOfBand((checkpoint) => checkpoints.push(checkpoint));

    try {
      await sleep(20);
      await writeFile(join(dir, "human.txt"), "manual edit\n");
      await waitFor(() => checkpoints.length === 1);

      expect(checkpoints[0]?.summary).toBe("out-of-band edit");
      expect(checkpoints[0]?.stat).toEqual({ files: 1, insertions: 1, deletions: 0 });
      expect(await git(dir, ["status", "--short"])).toBe("");
      expect(await git(dir, ["log", "--format=%s", "-1"])).toBe("chore(room): turn by human [out-of-band]");
    } finally {
      unwatch();
    }
  });

  it("does not checkpoint edits made while the write floor is held", async () => {
    const { dir, workspace } = await makeWorkspace();
    const checkpoints: CheckpointResult[] = [];
    const unwatch = workspace.watchOutOfBand((checkpoint) => checkpoints.push(checkpoint));
    const lease = await workspace.acquireWriteFloor("turn", "agent");

    try {
      await sleep(20);
      await writeFile(join(dir, "agent.txt"), "agent edit\n");
      await sleep(150);
      expect(checkpoints).toHaveLength(0);

      const checkpoint = await workspace.checkpoint("turn", "agent", "event");
      lease.release();
      await sleep(150);

      expect(checkpoint?.stat.files).toBe(1);
      expect(checkpoints).toHaveLength(0);
      expect(await git(dir, ["status", "--short"])).toBe("");
    } finally {
      lease.release();
      unwatch();
    }
  });

  it("switches to an existing branch without resetting its head", async () => {
    const { dir } = await makeWorkspace();
    const mainHead = await git(dir, ["rev-parse", "main"]);
    await exec("git", ["-C", dir, "checkout", "-b", "feature"]);
    await writeFile(join(dir, "feature.txt"), "feature\n");
    await exec("git", ["-C", dir, "add", "feature.txt"]);
    await exec("git", ["-C", dir, "commit", "-m", "feature"]);

    await new GitWorkspace(dir, "main").init();

    expect(await git(dir, ["branch", "--show-current"])).toBe("main");
    expect(await git(dir, ["rev-parse", "main"])).toBe(mainHead);
  });

  it("refuses to switch branches with a dirty working tree", async () => {
    const { dir } = await makeWorkspace();
    await exec("git", ["-C", dir, "checkout", "-b", "feature"]);
    await writeFile(join(dir, "dirty.txt"), "uncommitted\n");

    await expect(new GitWorkspace(dir, "main").init()).rejects.toThrow("working tree is dirty");
    expect(await git(dir, ["branch", "--show-current"])).toBe("feature");
  });
});

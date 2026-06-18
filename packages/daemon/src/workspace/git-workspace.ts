import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { watch } from "node:fs";
import type { WorkspaceManager, WriteLease, CheckpointResult } from "@quorum/core";
import type { DiffStat } from "@quorum/protocol";

const exec = promisify(execFile);

/**
 * Single shared working dir on a single branch, with a write-floor mutex and
 * per-turn checkpoint commits. Out-of-band (human) edits are detected via fs.watch.
 * (For robust cross-platform recursive watching, swap fs.watch for chokidar.)
 */
export class GitWorkspace implements WorkspaceManager {
  private chain: Promise<unknown> = Promise.resolve();

  constructor(private readonly dir: string, private readonly branch = "main") {}

  private git(args: string[]) {
    return exec("git", ["-C", this.dir, ...args]);
  }

  async init(): Promise<void> {
    const isRepo = await this.git(["rev-parse", "--is-inside-work-tree"]).then(() => true, () => false);
    if (!isRepo) {
      await this.git(["init"]);
      await this.git(["commit", "--allow-empty", "-m", "chore(room): init"]);
    }
    await this.git(["checkout", "-B", this.branch]).catch(() => {});
  }

  /** Serialize writers. Returns a lease; call release() when the turn is done. */
  acquireWriteFloor(_turnId: string, _who: string): Promise<WriteLease> {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const prev = this.chain;
    this.chain = prev.then(() => gate);
    return prev.then(() => ({ release }));
  }

  async snapshotPre(): Promise<string> {
    return (await this.git(["rev-parse", "HEAD"])).stdout.trim();
  }

  async checkpoint(_turnId: string, who: string, eventId: string): Promise<CheckpointResult | null> {
    const preHead = (await this.git(["rev-parse", "HEAD"])).stdout.trim();
    await this.git(["add", "-A"]);
    const dirty = await this.git(["diff", "--cached", "--quiet"]).then(() => false, () => true);
    if (!dirty) return null;
    await this.git(["commit", "-q", "-m", `chore(room): turn by ${who} [${eventId}]`]);
    const postHead = (await this.git(["rev-parse", "HEAD"])).stdout.trim();
    return { preHead, postHead, stat: await this.diff(preHead, postHead) };
  }

  async diff(fromHead: string, toHead = "HEAD"): Promise<DiffStat> {
    const { stdout } = await this.git(["diff", "--numstat", fromHead, toHead]);
    let files = 0, insertions = 0, deletions = 0;
    for (const line of stdout.trim().split("\n").filter(Boolean)) {
      const [ins, del] = line.split("\t");
      files++;
      insertions += Number(ins) || 0;
      deletions += Number(del) || 0;
    }
    return { files, insertions, deletions };
  }

  async rollbackTo(head: string): Promise<void> {
    await this.git(["reset", "--hard", head]);
  }

  /** Surface human edits made while no write floor is held. */
  watchOutOfBand(onChange: (stat: DiffStat) => void): () => void {
    const w = watch(this.dir, { recursive: true }, (_e, file) => {
      if (file && String(file).startsWith(".git")) return;
      this.diff("HEAD").then(onChange).catch(() => {});
    });
    return () => w.close();
  }
}

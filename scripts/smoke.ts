// Dependency-free validation of the M0 core (EventLog), runnable with `tsx` and
// no external packages installed. Run: npx tsx scripts/smoke.ts
import { EventLog, InMemoryStore } from "../packages/core/src/index.js";
import type { AppendInput } from "../packages/core/src/index.js";

const msg = (text: string): AppendInput => ({
  author: { kind: "human", id: "matt", display: "Matt" },
  type: "message",
  body: { text },
});

let failures = 0;
function check(name: string, cond: boolean): void {
  console.log(`${cond ? "  \u2713" : "  \u2717"} ${name}`);
  if (!cond) failures++;
}

async function main(): Promise<void> {
  console.log("EventLog smoke (M0 acceptance):");

  // 1) monotonic, gap-free seq under concurrent appends
  {
    const log = new EventLog("r", new InMemoryStore());
    const out = await Promise.all(Array.from({ length: 200 }, (_, i) => log.append(msg(`m${i}`))));
    const seqs = out.map((e) => e.seq).sort((a, b) => a - b);
    let gapFree = true;
    for (let i = 1; i < seqs.length; i++) if (seqs[i]! - seqs[i - 1]! !== 1) gapFree = false;
    check("200 concurrent appends -> seq 1..200, unique, gap-free",
      seqs[0] === 1 && seqs.at(-1) === 200 && new Set(seqs).size === 200 && gapFree);
  }

  // 2) subscriber delivery in order
  {
    const log = new EventLog("r", new InMemoryStore());
    const seen: number[] = [];
    log.on((e) => seen.push(e.seq));
    for (let i = 0; i < 10; i++) await log.append(msg(`m${i}`));
    check("subscriber receives all events in order", seen.join(",") === "1,2,3,4,5,6,7,8,9,10");
  }

  // 3) replay since seq
  {
    const log = new EventLog("r", new InMemoryStore());
    for (let i = 0; i < 5; i++) await log.append(msg(`m${i}`));
    check("replay(3) returns only seq > 3", log.replay(3).map((e) => e.seq).join(",") === "4,5");
  }

  console.log(failures === 0 ? "\nSMOKE PASS" : `\nSMOKE FAIL (${failures})`);
  process.exit(failures === 0 ? 0 : 1);
}
void main();

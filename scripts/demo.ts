// End-to-end demo of the room + Conductor with two dependency-free EchoAdapters.
// No real CLI needed. Run: npx tsx scripts/demo.ts
//
// Shows: free-for-all floor control, raise-hand rebuttals, no-consecutive,
// per-topic budget, addressed routing, and live human mid-turn preemption.
import { Conductor, EventLog, InMemoryStore, freeForAll } from "../packages/core/src/index.js";
import type { AppendInput } from "../packages/core/src/index.js";
import type {
  ConductorPolicyConfig, ParticipantDescriptor, RoomEvent,
  MessageBody, ThinkingBody, FloorGrantBody, FloorReleaseBody, FloorRequestBody, SystemBody,
} from "../packages/protocol/src/index.js";
import { EchoAdapter, type EchoLine } from "../packages/daemon/src/adapters/echo.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const ICON: Record<string, string> = {
  message: "\u{1F4AC}", thinking: "\u{1F4AD}", floor_grant: "\u{1F3A4}", floor_release: "\u{1F51A}",
  floor_request: "\u270B", checkpoint: "\u{1F4BE}", system: "\u2139\uFE0F ", tool_call: "\u{1F527}", interrupt: "\u26A1",
};

function fmt(e: RoomEvent): string {
  const to = e.addressedTo?.length ? ` \u2192${e.addressedTo.join(",")}` : "";
  let detail = "";
  switch (e.type) {
    case "message": detail = `${to} ${(e.body as MessageBody).text}`; break;
    case "thinking": detail = `(${(e.body as ThinkingBody).text})`; break;
    case "floor_grant": { const b = e.body as FloorGrantBody; detail = `\u2192 ${b.participantId}  [${b.reason}]`; break; }
    case "floor_release": { const b = e.body as FloorReleaseBody; detail = `${b.turnId.slice(0, 6)} (${b.reason})`; break; }
    case "floor_request": { const b = e.body as FloorRequestBody; detail = `raises hand (${b.intent}): ${b.reason}`; break; }
    case "system": detail = (e.body as SystemBody).text; break;
    default: detail = e.type;
  }
  return `#${String(e.seq).padStart(2, "0")} ${ICON[e.type] ?? "?"} ${e.author.display.padEnd(9)} ${detail}`;
}

// ---- the two fake agents ----
const alphaScript = ({ turnIndex }: { turnIndex: number }): EchoLine[] => {
  if (turnIndex === 0)
    return [
      { delayMs: 250, type: "thinking", text: "权衡无状态与可吊销性" },
      { type: "message", text: "我倾向 JWT：无状态、横向扩展简单、不依赖中心化 session store。" },
    ];
  if (turnIndex === 1)
    return [{ delayMs: 200, type: "message", addressedTo: ["beta"], text: "@beta 公平，但用短时 access token + refresh token 一样能控制有效期。" }];
  if (turnIndex === 2)
    return [
      { delayMs: 150, type: "thinking", text: "开始落地" },
      { type: "message", text: "好，开始按 session + refresh 实现，先建 SessionStore。" },
      { delayMs: 3000, type: "message", text: "（草案完成——这条不该出现，会被打断）" },
    ];
  return [{ delayMs: 150, type: "message", text: "收到，改用内存 store 做原型，先不接 Redis。" }];
};

const betaScript = ({ turnIndex }: { turnIndex: number }): EchoLine[] => {
  if (turnIndex === 0)
    return [
      { delayMs: 200, type: "message", addressedTo: ["alpha"], text: "@alpha 不同意。这个项目要强制登出 + 会话即时吊销，服务端 session 更直接。" },
      { type: "floor_request", intent: "rebut", text: "想就吊销这点继续" },
    ];
  if (turnIndex === 1)
    return [
      { delayMs: 200, type: "message", addressedTo: ["alpha"], text: "@alpha refresh token 要即时吊销就得维护黑名单，等于又回到服务端状态了。" },
      { type: "floor_request", intent: "rebut", text: "还有补充" },
    ];
  return [{ delayMs: 150, type: "message", text: "同意先做原型，我来补会话吊销的测试。" }];
};

async function main(): Promise<void> {
  const roomId = "demo";
  const log = new EventLog(roomId, new InMemoryStore());
  log.on((e) => console.log(fmt(e)));

  const desc = (id: string, display: string): ParticipantDescriptor => ({
    id, kind: "agent", display, adapter: "echo", status: "idle",
  });
  const alpha = new EchoAdapter(desc("alpha", "Alpha"), alphaScript);
  const beta = new EchoAdapter(desc("beta", "Beta"), betaScript);

  const config: ConductorPolicyConfig = {
    name: "free-for-all", maxTurnsPerTopic: 4, noConsecutive: true, turnDeadlineMs: 60_000,
  };
  const conductor = new Conductor({
    roomId, roomTitle: "JWT vs Session", log,
    participants: [alpha, beta], policy: freeForAll, config, primary: "alpha",
  });
  conductor.start();

  const human = (text: string, addressedTo?: string[]): AppendInput => ({
    author: { kind: "human", id: "matt", display: "Matt" }, type: "message", body: { text }, addressedTo,
  });

  console.log("\n=== 场景 1：自由抢麦辩论（有界，然后交还人类）===");
  await log.append(human("接口鉴权用 JWT 还是 server-side session？"));
  await sleep(3500);

  console.log("\n=== 场景 2：人类定向指派 + 回合进行中打断 ===");
  await log.append(human("@alpha 先按 session 实现，把 refresh 也加上。", ["alpha"]));
  await sleep(700); // 让 alpha 进入那条 3s 的长输出，然后打断它
  await log.append(human("等一下——先用内存 store 做原型就行，别接 Redis。"));
  await sleep(2500);

  await conductor.stop();
  console.log("\n=== demo 结束 ===");
  process.exit(0);
}
void main();

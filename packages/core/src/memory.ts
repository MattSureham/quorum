import { createHash } from "node:crypto";
import type { MemorySummary, RoomEvent } from "@quorum/protocol";
import { ulid } from "./ids.js";

export interface WorkingMemorySummaryOptions {
  sessionId: string;
  events: RoomEvent[];
  model?: string;
  promptVersion?: string;
  now?: Date;
}

function stableEventSource(events: RoomEvent[]): string {
  return JSON.stringify(events.map((event) => ({
    id: event.id,
    seq: event.seq,
    ts: event.ts,
    author: event.author.id,
    type: event.type,
    turnId: event.turnId,
    body: event.body,
  })));
}

function lineFor(event: RoomEvent): string | undefined {
  if (event.type === "message") {
    const text = typeof (event.body as any)?.text === "string" ? (event.body as any).text.trim() : "";
    return text ? `#${event.seq} ${event.author.id}: ${text}` : undefined;
  }
  if (event.type === "checkpoint") {
    const stat = (event.body as any)?.stat;
    return stat ? `#${event.seq} checkpoint: ${stat.files} files (+${stat.insertions} -${stat.deletions})` : undefined;
  }
  if (event.type === "speaker_selected") {
    const winner = (event.body as any)?.winner;
    const bid = winner?.bid;
    return bid ? `#${event.seq} selected ${bid.agentId} (${bid.kind}) score ${Number(winner.score ?? 0).toFixed(3)}` : undefined;
  }
  if (event.type === "tool_result") {
    const body = event.body as any;
    return `#${event.seq} tool_result ${body.callId ?? "unknown"} ${body.ok ? "ok" : "failed"}`;
  }
  return undefined;
}

export function createWorkingMemorySummary(opts: WorkingMemorySummaryOptions): MemorySummary {
  const events = [...opts.events].sort((a, b) => a.seq - b.seq);
  const sourceFromSeq = events[0]?.seq ?? 0;
  const sourceToSeq = events.at(-1)?.seq ?? 0;
  const sourceHash = createHash("sha256").update(stableEventSource(events)).digest("hex");
  const lines = events.map(lineFor).filter((line): line is string => !!line);
  const content = lines.length
    ? lines.slice(-40).join("\n")
    : "(no summarizable room events)";

  return {
    summaryId: ulid(),
    sessionId: opts.sessionId,
    sourceFromSeq,
    sourceToSeq,
    sourceHash,
    model: opts.model ?? "extractive-v1",
    promptVersion: opts.promptVersion ?? "working-memory-v1",
    createdAt: (opts.now ?? new Date()).toISOString(),
    content,
  };
}

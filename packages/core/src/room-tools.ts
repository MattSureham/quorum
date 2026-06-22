import type { FloorIntent, RoomEvent, MessageBody, CheckpointBody } from "@quorum/protocol";
import type { PartialRoomEvent } from "./types.js";

/**
 * The shared "room tools" (SPEC §9). These let an agent participate in the
 * coordination — raise its hand, hand off, ask for review — instead of only
 * being scheduled. Each tool call is translated into room events that the
 * adapter yields into the turn stream; the Conductor stamps the author to the
 * current floor holder, so identity cannot be spoofed.
 *
 * This module is pure (no MCP/SDK deps). Adapters wrap it:
 *  - Claude: in-process `createSdkMcpServer` tool handlers call `runRoomTool`.
 *  - Codex: `mcp_tool_call` items in its JSONL stream are matched and replayed
 *    through `runRoomTool`.
 */

export type RoomToolField =
  | { type: "string"; required?: boolean; description?: string }
  | { type: "number"; required?: boolean; description?: string }
  | { type: "string[]"; required?: boolean; description?: string }
  | { type: "enum"; values: string[]; required?: boolean; description?: string };

export interface RoomToolSpec {
  name: string;
  description: string;
  fields: Record<string, RoomToolField>;
}

export interface RoomToolDeps {
  /** Read persisted events with seq > sinceSeq (for `read_room`). */
  readRoom?: (sinceSeq: number) => RoomEvent[];
}

export interface RoomToolOutcome {
  /** Events to inject into the calling agent's turn stream. */
  events: PartialRoomEvent[];
  /** Short text handed back to the agent as the tool result. */
  reply: string;
}

export const ROOM_TOOLS: RoomToolSpec[] = [
  {
    name: "raise_hand",
    description:
      "Ask the Conductor for the floor to continue or rebut after others respond. One-line reason. Do not monologue across turns.",
    fields: {
      reason: { type: "string", required: true, description: "one-line reason you want the floor" },
      intent: { type: "enum", values: ["reply", "rebut", "act"], description: "reply | rebut | act" },
    },
  },
  {
    name: "read_room",
    description: "Read recent room events you may not have seen yet (everything after a given seq).",
    fields: { sinceSeq: { type: "number", description: "return events with seq greater than this (default 0)" } },
  },
  {
    name: "request_review",
    description: "Ask a participant (or everyone) to review the current changes.",
    fields: {
      note: { type: "string", required: true, description: "what to review" },
      target: { type: "string", description: "participant id to review; omit for everyone" },
    },
  },
  {
    name: "hand_off",
    description: "Hand the current task to another participant; they are suggested to speak next.",
    fields: {
      to: { type: "string", required: true, description: "participant id to hand off to" },
      note: { type: "string", description: "short context for the handoff" },
    },
  },
  {
    name: "post_note",
    description: "Post an explicit message to the room (your final message is already posted automatically; this is supplementary).",
    fields: { text: { type: "string", required: true } },
  },
];

const INTENTS = new Set<FloorIntent>(["reply", "rebut", "act"]);

/** Translate a room-tool invocation into room events + a reply for the agent. */
export function runRoomTool(
  name: string,
  args: Record<string, unknown>,
  deps: RoomToolDeps = {},
): RoomToolOutcome {
  switch (name) {
    case "raise_hand": {
      const reason = str(args.reason) || "continue";
      const intent = (INTENTS.has(str(args.intent) as FloorIntent) ? (str(args.intent) as FloorIntent) : "reply");
      return {
        events: [{ type: "floor_request", body: { reason, intent } }],
        reply: `hand raised (${intent}): ${reason}`,
      };
    }
    case "read_room": {
      const since = Number(args.sinceSeq ?? 0) || 0;
      const events = deps.readRoom?.(since) ?? [];
      const lines = events.slice(-30).map(formatEventLine).join("\n");
      return { events: [], reply: events.length ? lines : "(no newer events)" };
    }
    case "request_review": {
      const note = str(args.note) || "please review the current changes";
      const target = str(args.target) || undefined;
      return {
        events: [
          {
            type: "message",
            body: { text: target ? `@${target} [review] ${note}` : `[review] ${note}` },
            addressedTo: target ? [target] : undefined,
          },
        ],
        reply: target ? `review requested from ${target}` : "review requested",
      };
    }
    case "hand_off": {
      const to = str(args.to);
      if (!to) return { events: [], reply: "hand_off needs a `to` participant id" };
      const note = str(args.note) || "handing off to you";
      return {
        events: [{ type: "message", body: { text: `@${to} ${note}` }, addressedTo: [to] }],
        reply: `handed off to ${to}`,
      };
    }
    case "post_note": {
      const text = str(args.text);
      return text
        ? { events: [{ type: "message", body: { text } }], reply: "posted" }
        : { events: [], reply: "nothing to post" };
    }
    default:
      return { events: [], reply: `unknown room tool: ${name}` };
  }
}

/** True if `name` is one of the room tools (possibly namespaced, e.g. "room.raise_hand"). */
export function isRoomTool(name: string): boolean {
  return ROOM_TOOLS.some((t) => t.name === normalizeToolName(name));
}

/**
 * Strip an MCP server namespace prefix: "room.raise_hand", "room:raise_hand",
 * "room/raise_hand", "room__raise_hand" -> "raise_hand". Single underscores are
 * part of the tool names themselves (raise_hand, hand_off) and are preserved.
 */
export function normalizeToolName(name: string): string {
  for (const t of ROOM_TOOLS) {
    if (
      name === t.name ||
      name.endsWith(`.${t.name}`) ||
      name.endsWith(`:${t.name}`) ||
      name.endsWith(`/${t.name}`) ||
      name.endsWith(`__${t.name}`)
    ) {
      return t.name;
    }
  }
  return name;
}

function str(v: unknown): string {
  return v == null ? "" : String(v);
}

function formatEventLine(e: RoomEvent): string {
  const to = e.addressedTo?.length ? `→${e.addressedTo.join(",")}` : "";
  if (e.type === "message") return `#${e.seq} ${e.author.id}${to}: ${(e.body as MessageBody).text}`;
  if (e.type === "checkpoint") {
    const s = (e.body as CheckpointBody).stat;
    return `#${e.seq} ${e.author.id} edited ${s.files} files (+${s.insertions} -${s.deletions})`;
  }
  return `#${e.seq} ${e.author.id} [${e.type}]`;
}

#!/usr/bin/env node
/**
 * Standalone stdio MCP server exposing the room tools (SPEC §9) so an external
 * agent process can call them. Register it with Codex once per machine:
 *
 *     codex mcp add room -- node packages/daemon/src/room-tools/stdio-server.ts
 *
 * Event-routing note: this runs as a separate process and cannot reach the
 * daemon's in-memory EventLog, so it only acknowledges calls. The CodexAdapter
 * watches Codex's `--json` stream and synthesizes the actual room events
 * (raise_hand -> floor_request, hand_off -> addressed message) from the observed
 * `mcp_tool_call`. Claude instead gets an in-process server (see claude-code.ts),
 * so `read_room` is fully backed there but not here.
 *
 * The MCP SDK is imported dynamically and is NOT declared in package.json (to
 * keep the daemon installable without it). Install it where you run Codex:
 *     pnpm add -w @modelcontextprotocol/sdk
 * and verify the export paths below against the installed version.
 */
import { ROOM_TOOLS, runRoomTool, type RoomToolSpec } from "@quorum/core";

function jsonSchema(spec: RoomToolSpec): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const [key, f] of Object.entries(spec.fields)) {
    properties[key] =
      f.type === "number" ? { type: "number", description: f.description }
      : f.type === "string[]" ? { type: "array", items: { type: "string" }, description: f.description }
      : f.type === "enum" ? { type: "string", enum: f.values, description: f.description }
      : { type: "string", description: f.description };
    if (f.required) required.push(key);
  }
  return { type: "object", properties, required };
}

async function main(): Promise<void> {
  const serverMod: string = "@modelcontextprotocol/sdk/server/index.js";
  const stdioMod: string = "@modelcontextprotocol/sdk/server/stdio.js";
  const typesMod: string = "@modelcontextprotocol/sdk/types.js";
  const { Server } = (await import(serverMod)) as any;
  const { StdioServerTransport } = (await import(stdioMod)) as any;
  const { CallToolRequestSchema, ListToolsRequestSchema } = (await import(typesMod)) as any;

  const server = new Server({ name: "room", version: "0.1.0" }, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: ROOM_TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: jsonSchema(t) })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req: any) => {
    const out = runRoomTool(String(req.params?.name), (req.params?.arguments as Record<string, unknown>) ?? {});
    return { content: [{ type: "text", text: out.reply }] };
  });

  await server.connect(new StdioServerTransport());
}

main().catch((err) => {
  console.error("[room mcp] failed to start:", err);
  process.exit(1);
});

import { afterEach, describe, expect, it, vi } from "vitest";
import type { ParticipantDescriptor } from "@quorum/protocol";
import type { TurnInput } from "@quorum/core";
import { ApiModelAdapter } from "./api-model.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  delete process.env.TEST_API_KEY;
});

describe("ApiModelAdapter attachments", () => {
  it("sends only images attached to the prompt that triggered the current epoch", async () => {
    process.env.TEST_API_KEY = "test";
    let requestBody: any;
    globalThis.fetch = vi.fn(async (_url, init) => {
      requestBody = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;
    const self: ParticipantDescriptor = { id: "vision", kind: "agent", display: "Vision", adapter: "api-model", status: "idle" };
    const input: TurnInput = {
      turnId: "turn",
      roomTitle: "room",
      self,
      participants: [self],
      protocol: "",
      projection: [{
        id: "old",
        roomId: "room",
        seq: 1,
        ts: 1,
        author: { kind: "human", id: "human", display: "Human" },
        type: "message",
        body: { text: "old", attachments: [{ id: "old", name: "old.png", mimeType: "image/png", dataUrl: "data:image/png;base64,T0xE" }] },
        visibility: "participant",
      }],
      attachments: [{ id: "new", name: "new.png", mimeType: "image/png", dataUrl: "data:image/png;base64,TkVX" }],
      signal: new AbortController().signal,
    };
    const adapter = new ApiModelAdapter(self, { apiKeyEnv: "TEST_API_KEY", baseUrl: "https://example.invalid/v1", model: "vision" });
    for await (const _event of adapter.takeTurn(input)) { /* drain */ }

    const content = requestBody.messages[1].content;
    expect(content).toEqual(expect.arrayContaining([expect.objectContaining({ image_url: { url: "data:image/png;base64,TkVX" } })]));
    expect(JSON.stringify(content)).not.toContain("T0xE");
  });
});

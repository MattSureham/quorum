import { describe, expect, it } from "vitest";
import { matchesSessionCreateError, matchesSessionCreateResponse } from "./session-create-correlation.js";

const pending = { requestId: "create-1", roomId: "room-1" };

describe("Session create correlation", () => {
  it("matches current success responses and legacy room-id responses", () => {
    expect(matchesSessionCreateResponse(pending, { requestId: "create-1", roomId: "room-1" })).toBe(true);
    expect(matchesSessionCreateResponse(pending, { roomId: "room-1" })).toBe(true);
  });

  it("rejects stale success and unrelated generic errors", () => {
    expect(matchesSessionCreateResponse(pending, { requestId: "create-old", roomId: "room-1" })).toBe(false);
    expect(matchesSessionCreateResponse(undefined, { requestId: "create-1", roomId: "room-1" })).toBe(false);
    expect(matchesSessionCreateError(pending)).toBe(false);
    expect(matchesSessionCreateError(pending, "credential-1")).toBe(false);
    expect(matchesSessionCreateError(pending, "create-1")).toBe(true);
  });
});

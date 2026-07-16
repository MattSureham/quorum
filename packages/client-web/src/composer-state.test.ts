import { describe, expect, it } from "vitest";
import { canSendComposer } from "./composer-state.js";

describe("canSendComposer", () => {
  it("blocks text and keyboard sends while a selected file is still being read", () => {
    expect(canSendComposer(true, "send with image", 0, 1)).toBe(false);
    expect(canSendComposer(true, "send with image", 1, 1)).toBe(false);
  });

  it("allows text or completed attachments only when connected", () => {
    expect(canSendComposer(true, "hello", 0, 0)).toBe(true);
    expect(canSendComposer(true, "", 1, 0)).toBe(true);
    expect(canSendComposer(false, "hello", 0, 0)).toBe(false);
    expect(canSendComposer(true, "", 0, 0)).toBe(false);
  });
});

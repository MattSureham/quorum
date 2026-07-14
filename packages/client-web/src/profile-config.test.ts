import { describe, expect, it } from "vitest";
import { canCreateCustomApiProfile, normalizeStoredCustomProfile } from "./profile-config.js";

describe("custom API profile configuration", () => {
  it("migrates a legacy profile without providerId to the OpenAI credential boundary", () => {
    expect(normalizeStoredCustomProfile({ id: "legacy", display: "Legacy model", model: "custom-model" })).toMatchObject({
      id: "legacy",
      providerId: "openai",
      model: "custom-model",
    });
  });

  it("requires a provider and rejects duplicate ids", () => {
    expect(canCreateCustomApiProfile({ id: "analyst", providerId: "" }, [])).toBe(false);
    expect(canCreateCustomApiProfile({ id: "analyst", providerId: "deepseek" }, ["analyst"])).toBe(false);
    expect(canCreateCustomApiProfile({ id: "analyst", providerId: "deepseek" }, [])).toBe(true);
  });
});

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Tauri security configuration", () => {
  it("blocks remote image loads while allowing the loopback sidecar connection", () => {
    const config = JSON.parse(readFileSync(new URL("./tauri.conf.json", import.meta.url), "utf8")) as any;
    const csp = String(config.app?.security?.csp ?? "");

    expect(csp).toContain("connect-src 'self' ipc: http://ipc.localhost http://127.0.0.1:* ws://127.0.0.1:*");
    expect(csp).toContain("img-src 'self' data: blob:");
    expect(csp).toContain("object-src 'none'");
    expect(csp).not.toMatch(/img-src[^;]*https?:\/\/(?!ipc\.localhost|127\.0\.0\.1)/u);
  });
});

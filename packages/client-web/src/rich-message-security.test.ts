import { describe, expect, it } from "vitest";
import { isSafeImageSource, mermaidSourceError } from "./rich-message-security.js";

describe("rich message security", () => {
  it("accepts embedded raster images without permitting automatic network requests", () => {
    expect(isSafeImageSource("data:image/png;base64,aGVsbG8=")).toBe(true);
    expect(isSafeImageSource("https://example.com/chart.png")).toBe(false);
    expect(isSafeImageSource("http://127.0.0.1:8787/private.png")).toBe(false);
    expect(isSafeImageSource("//example.com/chart.png")).toBe(false);
    expect(isSafeImageSource("/assets/chart.webp")).toBe(false);
    expect(isSafeImageSource("blob:https://example.com/id")).toBe(false);
    expect(isSafeImageSource("javascript:alert(1)")).toBe(false);
    expect(isSafeImageSource("data:image/svg+xml;base64,PHN2Zz4=")).toBe(false);
    expect(isSafeImageSource("file:///Users/example/private.png")).toBe(false);
  });

  it("blocks Mermaid directives and active-content hooks", () => {
    expect(mermaidSourceError("flowchart LR\nA --> B")).toBeUndefined();
    expect(mermaidSourceError("flowchart LR\nA[Data: 42] --> B")).toBeUndefined();
    expect(mermaidSourceError("%%{init: {'securityLevel': 'loose'}}%%\nflowchart LR\nA-->B")).toContain("directives");
    expect(mermaidSourceError("flowchart LR\nclick A href \"javascript:alert(1)\"")).toContain("active content");
    expect(mermaidSourceError("flowchart LR\nA[https://tracker.example/pixel]")).toContain("active content");
    expect(mermaidSourceError("<script>alert(1)</script>")).toContain("active content");
  });
});

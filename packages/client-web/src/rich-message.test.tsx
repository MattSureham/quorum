import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RichMessage } from "./rich-message.js";

const t = (text: string) => text;

describe("RichMessage", () => {
  it("renders GFM structure and safe images instead of a plain text blob", () => {
    const html = renderToStaticMarkup(<RichMessage t={t} text={`## Result

| Option | Score |
| --- | ---: |
| A | 92 |

- [x] Checked

![Chart](data:image/png;base64,aGVsbG8=)
`} />);

    expect(html).toContain("<h2>Result</h2>");
    expect(html).toContain("<table>");
    expect(html).toContain('type="checkbox"');
    expect(html).toContain('src="data:image/png;base64,aGVsbG8="');
    expect(html).toContain('loading="lazy"');
  });

  it("does not turn agent-supplied remote images into automatic requests", () => {
    const html = renderToStaticMarkup(<RichMessage t={t} text={`![remote](https://example.com/tracker.png)

![localhost](http://127.0.0.1:8787/private)
`} />);

    expect(html).not.toContain("https://example.com");
    expect(html).not.toContain("http://127.0.0.1");
    expect(html.match(/Image blocked/g)).toHaveLength(2);
  });

  it("removes raw HTML, blocks executable image URLs, and recognizes Mermaid blocks", () => {
    const html = renderToStaticMarkup(<RichMessage t={t} text={`<script>alert('no')</script>

![bad](javascript:alert(1))

\`\`\`mermaid
flowchart LR
  A --> B
\`\`\`
`} />);

    expect(html).not.toContain("<script>");
    expect(html).not.toContain("javascript:");
    expect(html).toContain("Image blocked");
    expect(html).toContain("Rendering diagram");
    expect(html).not.toContain("language-mermaid");
  });
});

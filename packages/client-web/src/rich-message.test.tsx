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

![Chart](https://example.com/chart.png)
`} />);

    expect(html).toContain("<h2>Result</h2>");
    expect(html).toContain("<table>");
    expect(html).toContain('type="checkbox"');
    expect(html).toContain('src="https://example.com/chart.png"');
    expect(html).toContain('loading="lazy"');
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

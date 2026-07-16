import React, { useEffect, useId, useMemo, useState } from "react";
import DOMPurify from "dompurify";
import ReactMarkdown, { defaultUrlTransform, type Components, type UrlTransform } from "react-markdown";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import { isSafeImageSource, mermaidSourceError } from "./rich-message-security.js";

type Translate = (text: string) => string;

let mermaidModule: Promise<typeof import("mermaid")> | undefined;
let mermaidInitialized = false;

function hastText(node: any): string {
  if (!node) return "";
  if (node.type === "text") return String(node.value ?? "");
  if (!Array.isArray(node.children)) return "";
  return node.children.map(hastText).join("");
}

function mermaidSourceFromPre(node: any): string | undefined {
  const code = node?.children?.[0];
  if (code?.type !== "element" || code.tagName !== "code") return undefined;
  const classes = Array.isArray(code.properties?.className)
    ? code.properties.className.map(String)
    : [String(code.properties?.className ?? "")];
  if (!classes.includes("language-mermaid")) return undefined;
  return hastText(code).replace(/\n$/, "");
}

async function renderMermaid(id: string, source: string): Promise<string> {
  mermaidModule ??= import("mermaid");
  const module = await mermaidModule;
  const mermaid = module.default;
  if (!mermaidInitialized) {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      suppressErrorRendering: true,
      maxTextSize: 50_000,
      theme: "neutral",
      htmlLabels: false,
      flowchart: { htmlLabels: false },
      fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
    });
    mermaidInitialized = true;
  }
  const rendered = await mermaid.render(id, source);
  const sanitized = DOMPurify.sanitize(rendered.svg, {
    USE_PROFILES: { svg: true, svgFilters: true },
    FORBID_TAGS: ["script", "foreignObject", "iframe", "object", "embed"],
    FORBID_ATTR: ["href", "xlink:href", "onload", "onclick", "onerror", "onmouseover", "onfocus"],
  });
  if (!sanitized.includes("<svg")) throw new Error("diagram renderer returned no SVG");
  return sanitized;
}

function MermaidDiagram({ source, t }: { source: string; t: Translate }) {
  const reactId = useId();
  const renderId = useMemo(() => `quorum-mermaid-${reactId.replace(/[^a-z0-9_-]/giu, "")}`, [reactId]);
  const sourceError = mermaidSourceError(source);
  const [state, setState] = useState<{ svg?: string; error?: string }>(() => ({ error: sourceError }));

  useEffect(() => {
    let cancelled = false;
    setState({ error: sourceError });
    if (sourceError) return () => { cancelled = true; };
    void renderMermaid(renderId, source)
      .then((svg) => {
        if (!cancelled) setState({ svg });
      })
      .catch((error) => {
        if (!cancelled) setState({ error: error instanceof Error ? error.message : String(error) });
      });
    return () => { cancelled = true; };
  }, [renderId, source, sourceError]);

  if (state.error) {
    return (
      <div className="mermaid-fallback" role="note">
        <strong>{t("Diagram unavailable")}</strong>
        <span>{state.error}</span>
        <pre><code>{source}</code></pre>
      </div>
    );
  }
  if (!state.svg) return <div className="mermaid-loading">{t("Rendering diagram")}</div>;
  return <div className="mermaid-diagram" aria-label={t("Rendered diagram")} dangerouslySetInnerHTML={{ __html: state.svg }} />;
}

const safeUrlTransform: UrlTransform = (url, key, node) => {
  if (key === "src" && node.tagName === "img") return isSafeImageSource(url) ? url : "";
  return defaultUrlTransform(url);
};

const markdownSanitizeSchema = {
  ...defaultSchema,
  protocols: {
    ...defaultSchema.protocols,
    src: [...(defaultSchema.protocols?.src ?? []), "data"],
  },
};

export function RichMessage({ text, t }: { text: string; t: Translate }) {
  const components = useMemo<Components>(() => ({
    a({ node: _node, ...props }) {
      return <a {...props} target="_blank" rel="noreferrer noopener" />;
    },
    img({ node: _node, src, alt, ...props }) {
      if (!isSafeImageSource(src)) return <span className="markdown-media-error">{t("Image blocked")}</span>;
      return (
        <span className="markdown-image">
          <a href={src} target="_blank" rel="noreferrer noopener">
            <img {...props} src={src} alt={alt ?? ""} loading="lazy" />
          </a>
          {alt ? <small>{alt}</small> : null}
        </span>
      );
    },
    pre({ node, children, ...props }) {
      const source = mermaidSourceFromPre(node);
      if (source !== undefined) return <MermaidDiagram source={source} t={t} />;
      return <pre {...props}>{children}</pre>;
    },
  }), [t]);

  return (
    <div className="rich-message">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeSanitize, markdownSanitizeSchema]]}
        skipHtml
        urlTransform={safeUrlTransform}
        components={components}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

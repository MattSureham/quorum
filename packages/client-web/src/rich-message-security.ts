const SAFE_DATA_IMAGE = /^data:image\/(?:png|jpeg|gif|webp);base64,[a-z0-9+/=\s]+$/iu;
const MERMAID_DIRECTIVE = /%%\s*\{/u;
const MERMAID_ACTIVE_CONTENT = /(?:<\s*(?:script|iframe|object|embed|foreignobject)\b|\bjavascript\s*:|\bdata\s*:(?:text|image|application)\/|\b(?:https?|ftp)\s*:\/\/|\bclick\s+|\burl\s*\()/iu;

export const MAX_MERMAID_SOURCE_LENGTH = 50_000;

export function isSafeImageSource(value: string | undefined): boolean {
  if (!value) return false;
  const source = value.trim();
  if (!source) return false;
  if (SAFE_DATA_IMAGE.test(source)) return source.length <= 7_000_000;
  if (/^(?:https?:|blob:)/iu.test(source)) return true;
  return /^(?:\.?\.?\/|\/)[^\s]*$/u.test(source);
}

export function mermaidSourceError(source: string): string | undefined {
  if (!source.trim()) return "empty diagram";
  if (source.length > MAX_MERMAID_SOURCE_LENGTH) return "diagram source is too large";
  if (MERMAID_DIRECTIVE.test(source)) return "per-diagram configuration directives are disabled";
  if (MERMAID_ACTIVE_CONTENT.test(source)) return "active content is disabled in diagrams";
  return undefined;
}

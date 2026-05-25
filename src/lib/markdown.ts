import { marked } from "marked";

const SAFE_TAGS = new Set([
  "a",
  "blockquote",
  "br",
  "code",
  "em",
  "li",
  "ol",
  "p",
  "pre",
  "strong",
  "ul",
]);

const SAFE_LINK_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function isSafeHref(href: string): boolean {
  if (href.startsWith("/") || href.startsWith("#")) return true;
  try {
    return SAFE_LINK_PROTOCOLS.has(new URL(href).protocol);
  } catch {
    return false;
  }
}

function sanitizeRenderedMarkdown(html: string): string {
  return html
    .replace(/<\/?([a-zA-Z0-9-]+)(\s[^>]*)?>/g, (tag, name) => {
      const lowerName = String(name).toLowerCase();
      if (!SAFE_TAGS.has(lowerName)) return "";
      if (tag.startsWith("</")) return `</${lowerName}>`;
      return lowerName === "a" ? tag : `<${lowerName}>`;
    })
    .replace(/<a\s+([^>]*?)href=(["'])(.*?)\2([^>]*)>/gi, (_tag, _before, _quote, href) => {
      if (!isSafeHref(href)) return "<a>";
      const safeHref = escapeHtml(href);
      return `<a href="${safeHref}" rel="nofollow noreferrer noopener">`;
    })
    .replace(/<a\s+(?![^>]*href=)[^>]*>/gi, "<a>");
}

export function renderSafeMarkdown(input: string): string {
  const escaped = escapeHtml(input);
  const rendered = marked.parse(escaped, {
    async: false,
    breaks: true,
  }) as string;

  return sanitizeRenderedMarkdown(rendered);
}

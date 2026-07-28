/**
 * Sanitise inbound email HTML before any storage or display.
 * Never render provider HTML unsanitised (issue #42 acceptance).
 *
 * Tag matching must treat `/` as an attribute separator (`<img/src=x onerror=…>`
 * is a valid browser HTML quirk). DIY sanitizers remain residual-risk for mXSS;
 * keep the allowlist tight and re-strip residual event handlers.
 */

const ALLOWED_TAGS = new Set([
  "a",
  "b",
  "blockquote",
  "br",
  "code",
  "div",
  "em",
  "h1",
  "h2",
  "h3",
  "h4",
  "hr",
  "i",
  "li",
  "ol",
  "p",
  "pre",
  "span",
  "strong",
  "table",
  "tbody",
  "td",
  "th",
  "thead",
  "tr",
  "u",
  "ul",
]);

const SAFE_LINK_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function isSafeHref(href: string): boolean {
  const trimmed = href.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith("#") || trimmed.startsWith("/")) return true;
  try {
    return SAFE_LINK_PROTOCOLS.has(new URL(trimmed).protocol);
  } catch {
    return false;
  }
}

/**
 * Strip scripts, event handlers, dangerous tags/attrs. Keep a small set of
 * structural tags. Href on anchors is re-validated; everything else is dropped.
 */
export function sanitizeEmailHtml(input: string | null | undefined): string {
  if (!input) return "";
  // Remove high-risk blocks wholesale before tag walk.
  let html = input
    .replace(/<script\b[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[\s\S]*?<\/style>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<iframe\b[\s\S]*?<\/iframe>/gi, "")
    .replace(/<object\b[\s\S]*?<\/object>/gi, "")
    .replace(/<embed\b[^>]*\/?>/gi, "")
    .replace(/<form\b[\s\S]*?<\/form>/gi, "")
    .replace(/<svg\b[\s\S]*?<\/svg>/gi, "")
    .replace(/<math\b[\s\S]*?<\/math>/gi, "");

  // Match tags allowing `/` as a separator after the name (HTML browser quirk).
  // Capture: full tag, whether closing, name, rest of attributes region.
  html = html.replace(
    /<\s*(\/?)\s*([a-zA-Z][a-zA-Z0-9:-]*)\b([^>]*)>/g,
    (_full, closer: string, rawName: string, attrs: string) => {
      const name = rawName.toLowerCase().replace(/^.*:/, "");
      if (!ALLOWED_TAGS.has(name)) return "";
      if (closer === "/") return `</${name}>`;
      if (name === "br" || name === "hr") return `<${name}>`;
      if (name === "a") {
        // Accept both space-separated and slash-separated attribute forms.
        const hrefMatch =
          attrs.match(/\bhref\s*=\s*(["'])(.*?)\1/i) ??
          attrs.match(/\bhref\s*=\s*([^\s"'=<>`]+)/i);
        const href = hrefMatch?.[2] ?? hrefMatch?.[1] ?? "";
        if (!isSafeHref(href)) return "<a>";
        return `<a href="${escapeHtml(href)}" rel="nofollow noreferrer noopener">`;
      }
      // Drop all attributes on remaining allowed tags.
      return `<${name}>`;
    },
  );

  // Defence-in-depth: strip any leftover event handlers / javascript: URLs.
  return html
    .replace(/\son[a-z]+\s*=\s*(["']).*?\1/gi, "")
    .replace(/\son[a-z]+\s*=\s*[^\s>]+/gi, "")
    .replace(/javascript\s*:/gi, "");
}

/** Collapse HTML to plain text when no text/plain part is available. */
export function htmlToPlainText(input: string | null | undefined): string {
  if (!input) return "";
  return input
    .replace(/<script\b[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[\s\S]*?<\/style>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<\/tr>/gi, "\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Cap body size stored in the database. */
export const MAX_STORED_BODY_CHARS = 200_000;

export function truncateBody(value: string, max = MAX_STORED_BODY_CHARS): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}\n\n[truncated]`;
}

/**
 * Sanitisation for report body text (issue #47).
 * Reuses content-block Markdown sanitiser so unsafe HTML/active content
 * cannot inject into templates, previews, or generated exports.
 */

import { sanitizeContentMarkdown } from "@/lib/content-blocks-core";

export { sanitizeContentMarkdown };

/** Strip active content from free-text that ends up in PDF/JSON reports. */
export function sanitizeReportText(input: string | null | undefined): string {
  if (!input) return "";
  return sanitizeContentMarkdown(input);
}

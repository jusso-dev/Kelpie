/**
 * Lightweight RFC822 / MIME parse for mailbox intake.
 * Prefer plain-text + sanitised HTML; collect attachment descriptors/bytes.
 * No third-party MIME dependency — subset sufficient for intake pipeline.
 */

import { sanitizeEmailHtml, htmlToPlainText, truncateBody } from "./sanitize";
import type {
  MailAddress,
  MailAttachmentDescriptor,
  NormalizedMailMessage,
} from "./types";
import { MAX_ATTACHMENT_BYTES } from "./types";

function decodeQuotedPrintable(input: string): Buffer {
  const cleaned = input
    .replace(/=\r?\n/g, "")
    .replace(/=([0-9A-Fa-f]{2})/g, (_m, hex: string) =>
      String.fromCharCode(parseInt(hex, 16)),
    );
  return Buffer.from(cleaned, "binary");
}

function decodeTransferEncoding(
  body: Buffer,
  encoding: string | undefined,
): Buffer {
  const enc = (encoding ?? "7bit").toLowerCase().trim();
  if (enc === "base64") {
    const text = body.toString("utf8").replace(/\s+/g, "");
    try {
      return Buffer.from(text, "base64");
    } catch {
      return body;
    }
  }
  if (enc === "quoted-printable") {
    return decodeQuotedPrintable(body.toString("binary"));
  }
  return body;
}

function decodeCharset(buf: Buffer, charset: string | undefined): string {
  const cs = (charset ?? "utf-8").toLowerCase();
  try {
    return new TextDecoder(cs === "utf8" ? "utf-8" : cs).decode(buf);
  } catch {
    return buf.toString("utf8");
  }
}

/** Decode RFC 2047 encoded-words in headers. */
export function decodeMimeWord(input: string): string {
  return input.replace(
    /=\?([^?]+)\?([bBqQ])\?([^?]*)\?=/g,
    (_m, charset: string, encoding: string, text: string) => {
      try {
        if (encoding.toUpperCase() === "B") {
          return decodeCharset(Buffer.from(text, "base64"), charset);
        }
        const qp = text.replace(/_/g, " ");
        return decodeCharset(decodeQuotedPrintable(qp), charset);
      } catch {
        return text;
      }
    },
  );
}

export function parseAddressList(raw: string | null | undefined): MailAddress[] {
  if (!raw?.trim()) return [];
  const parts = raw.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/);
  const out: MailAddress[] = [];
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const angle = trimmed.match(/^(?:"?([^"]*)"?\s*)?<([^>]+)>/);
    if (angle) {
      out.push({
        name: angle[1]?.trim() || null,
        address: angle[2].trim().toLowerCase(),
      });
      continue;
    }
    const emailOnly = trimmed.replace(/^<|>$/g, "").trim();
    if (emailOnly.includes("@")) {
      out.push({ address: emailOnly.toLowerCase(), name: null });
    }
  }
  return out;
}

type HeaderMap = Record<string, string>;

export function parseHeaders(headerBlock: string): HeaderMap {
  const unfolded = headerBlock.replace(/\r?\n[ \t]+/g, " ");
  const map: HeaderMap = {};
  for (const line of unfolded.split(/\r?\n/)) {
    const idx = line.indexOf(":");
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const value = decodeMimeWord(line.slice(idx + 1).trim());
    if (map[key]) map[key] = `${map[key]}, ${value}`;
    else map[key] = value;
  }
  return map;
}

function headerParam(value: string, name: string): string | undefined {
  const re = new RegExp(
    `(?:^|;|\\s)${name}\\s*=\\s*(?:"([^"]*)"|([^;\\s]+))`,
    "i",
  );
  const m = value.match(re);
  return m?.[1] ?? m?.[2];
}

type MimePart = {
  headers: HeaderMap;
  body: Buffer;
};

function splitMultipart(body: Buffer, boundary: string): MimePart[] {
  const delimiter = Buffer.from(`--${boundary}`);
  const parts: MimePart[] = [];
  let start = body.indexOf(delimiter);
  if (start < 0) return parts;
  start += delimiter.length;
  // Skip optional CRLF after opening boundary
  if (body[start] === 0x0d) start++;
  if (body[start] === 0x0a) start++;

  while (start < body.length) {
    const next = body.indexOf(delimiter, start);
    let end = next < 0 ? body.length : next;
    // Drop trailing CRLF before next boundary
    if (end >= 2 && body[end - 2] === 0x0d && body[end - 1] === 0x0a) {
      end -= 2;
    } else if (end >= 1 && body[end - 1] === 0x0a) {
      end -= 1;
    }
    const chunk = body.subarray(start, end);
    // Closing boundary ends with --
    const isClose =
      body[next + delimiter.length] === 0x2d &&
      body[next + delimiter.length + 1] === 0x2d;
    const sep = chunk.indexOf("\r\n\r\n");
    const sep2 = sep < 0 ? chunk.indexOf("\n\n") : sep;
    if (sep2 >= 0) {
      const headerBytes = chunk.subarray(0, sep2);
      const bodyStart = sep2 + (sep >= 0 ? 4 : 2);
      parts.push({
        headers: parseHeaders(headerBytes.toString("utf8")),
        body: chunk.subarray(bodyStart),
      });
    }
    if (next < 0 || isClose) break;
    start = next + delimiter.length;
    if (body[start] === 0x0d) start++;
    if (body[start] === 0x0a) start++;
  }
  return parts;
}

function collectParts(part: MimePart, acc: MimePart[]): void {
  const ct = part.headers["content-type"] ?? "text/plain";
  const mainType = ct.split(";")[0]?.trim().toLowerCase() ?? "text/plain";
  if (mainType.startsWith("multipart/")) {
    const boundary = headerParam(ct, "boundary");
    if (!boundary) return;
    for (const child of splitMultipart(part.body, boundary)) {
      collectParts(child, acc);
    }
    return;
  }
  acc.push(part);
}

function partIsAttachment(headers: HeaderMap): boolean {
  const cd = headers["content-disposition"] ?? "";
  if (/attachment/i.test(cd)) return true;
  if (/inline/i.test(cd) && headerParam(cd, "filename")) return true;
  const ct = headers["content-type"] ?? "";
  if (headerParam(ct, "name") && !ct.toLowerCase().startsWith("text/")) {
    return true;
  }
  return false;
}

function partFilename(headers: HeaderMap): string {
  const cd = headers["content-disposition"] ?? "";
  const ct = headers["content-type"] ?? "";
  return (
    decodeMimeWord(headerParam(cd, "filename") ?? "") ||
    decodeMimeWord(headerParam(ct, "name") ?? "") ||
    "attachment"
  );
}

/**
 * Parse a raw RFC822 buffer into a normalised mail message.
 */
export function parseRfc822(raw: Buffer): NormalizedMailMessage {
  const sep = raw.indexOf("\r\n\r\n");
  const sep2 = sep < 0 ? raw.indexOf("\n\n") : sep;
  const headerBlock =
    sep2 >= 0 ? raw.subarray(0, sep2).toString("utf8") : raw.toString("utf8");
  const body =
    sep2 >= 0 ? raw.subarray(sep2 + (sep >= 0 ? 4 : 2)) : Buffer.alloc(0);
  const headers = parseHeaders(headerBlock);

  const root: MimePart = { headers, body };
  const leaves: MimePart[] = [];
  collectParts(root, leaves);

  let bodyText = "";
  let bodyHtml = "";
  const attachments: MailAttachmentDescriptor[] = [];

  for (const leaf of leaves) {
    const ctHeader = leaf.headers["content-type"] ?? "text/plain; charset=utf-8";
    const mimeType =
      ctHeader.split(";")[0]?.trim().toLowerCase() ?? "application/octet-stream";
    const charset = headerParam(ctHeader, "charset");
    const transfer = leaf.headers["content-transfer-encoding"];
    const decoded = decodeTransferEncoding(leaf.body, transfer);

    if (partIsAttachment(leaf.headers) || (!mimeType.startsWith("text/") && mimeType !== "message/rfc822")) {
      if (decoded.length > MAX_ATTACHMENT_BYTES) {
        attachments.push({
          filename: partFilename(leaf.headers),
          contentType: mimeType,
          sizeBytes: decoded.length,
          // Omit content when over limit — pipeline records failure meta.
        });
        continue;
      }
      attachments.push({
        filename: partFilename(leaf.headers),
        contentType: mimeType,
        sizeBytes: decoded.length,
        contentId: leaf.headers["content-id"]?.replace(/^<|>$/g, ""),
        content: decoded,
      });
      continue;
    }

    if (mimeType === "text/plain" && !bodyText) {
      bodyText = decodeCharset(decoded, charset);
    } else if (mimeType === "text/html" && !bodyHtml) {
      bodyHtml = decodeCharset(decoded, charset);
    } else if (mimeType.startsWith("text/") && !bodyText) {
      bodyText = decodeCharset(decoded, charset);
    }
  }

  // Single-part non-multipart message: root body itself may be text.
  if (!bodyText && !bodyHtml && leaves.length === 0) {
    const ct = headers["content-type"] ?? "text/plain";
    const mimeType = ct.split(";")[0]?.trim().toLowerCase() ?? "text/plain";
    const decoded = decodeTransferEncoding(
      body,
      headers["content-transfer-encoding"],
    );
    if (mimeType === "text/html") bodyHtml = decodeCharset(decoded, headerParam(ct, "charset"));
    else bodyText = decodeCharset(decoded, headerParam(ct, "charset"));
  }

  const sanitizedHtml = sanitizeEmailHtml(bodyHtml);
  if (!bodyText && bodyHtml) {
    bodyText = htmlToPlainText(bodyHtml);
  }

  const messageId =
    headers["message-id"]?.replace(/^<|>$/g, "").trim() ||
    headers["x-microsoft-message-id"]?.trim() ||
    "";

  const fromList = parseAddressList(headers.from);
  const dateRaw = headers.date;
  let sentAt: Date | null = null;
  if (dateRaw) {
    const d = new Date(dateRaw);
    if (!Number.isNaN(d.getTime())) sentAt = d;
  }

  return {
    providerMessageId: messageId,
    receivedAt: sentAt,
    sentAt,
    from: fromList[0] ?? null,
    to: parseAddressList(headers.to),
    cc: parseAddressList(headers.cc),
    subject: decodeMimeWord(headers.subject ?? "").trim() || "(no subject)",
    bodyText: truncateBody(bodyText),
    bodyHtmlSanitized: truncateBody(sanitizedHtml),
    attachments,
    rawMessage: raw,
  };
}

/**
 * Build a minimal .eml buffer from structured Graph fields when raw MIME is
 * unavailable. Used so the evidence pipeline still preserves the original
 * message content.
 */
export function buildEmlFromParts(input: {
  messageId: string;
  subject: string;
  from: string;
  to: string[];
  cc: string[];
  date: Date | null;
  bodyText: string;
  bodyHtml?: string;
}): Buffer {
  const lines = [
    `Message-ID: <${input.messageId}>`,
    `Date: ${(input.date ?? new Date()).toUTCString()}`,
    `From: ${input.from}`,
    `To: ${input.to.join(", ") || "undisclosed-recipients:;"}`,
    ...(input.cc.length ? [`Cc: ${input.cc.join(", ")}`] : []),
    `Subject: ${input.subject}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="utf-8"',
    "Content-Transfer-Encoding: 8bit",
    "",
    input.bodyText || htmlToPlainText(input.bodyHtml ?? ""),
  ];
  return Buffer.from(lines.join("\r\n"), "utf8");
}

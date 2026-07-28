/**
 * Server-side MIME derivation from file bytes. The client-supplied
 * `file.type` is never trusted for storage/serving decisions (only kept for
 * audit as `declaredContentType`) since it is fully attacker-controlled on a
 * raw multipart upload.
 */

type Signature = {
  mime: string;
  match: (buf: Buffer) => boolean;
};

const SIGNATURES: Signature[] = [
  {
    mime: "application/pdf",
    match: (b) => b.length >= 5 && b.subarray(0, 5).toString("latin1") === "%PDF-",
  },
  {
    mime: "image/png",
    match: (b) =>
      b.length >= 8 &&
      b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  },
  {
    mime: "image/jpeg",
    match: (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  },
  {
    mime: "image/gif",
    match: (b) =>
      b.length >= 6 &&
      (b.subarray(0, 6).toString("latin1") === "GIF87a" ||
        b.subarray(0, 6).toString("latin1") === "GIF89a"),
  },
  {
    mime: "image/bmp",
    match: (b) => b.length >= 2 && b.subarray(0, 2).toString("latin1") === "BM",
  },
  {
    mime: "image/tiff",
    match: (b) =>
      b.length >= 4 &&
      (b.subarray(0, 4).equals(Buffer.from([0x49, 0x49, 0x2a, 0x00])) ||
        b.subarray(0, 4).equals(Buffer.from([0x4d, 0x4d, 0x00, 0x2a]))),
  },
  {
    mime: "application/gzip",
    match: (b) => b.length >= 2 && b[0] === 0x1f && b[1] === 0x8b,
  },
  {
    mime: "application/x-7z-compressed",
    match: (b) =>
      b.length >= 6 &&
      b.subarray(0, 6).equals(Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c])),
  },
  {
    mime: "application/x-rar-compressed",
    match: (b) => b.length >= 4 && b.subarray(0, 4).toString("latin1") === "Rar!",
  },
  {
    mime: "application/zip",
    match: (b) =>
      b.length >= 4 &&
      b[0] === 0x50 &&
      b[1] === 0x4b &&
      (b[2] === 0x03 || b[2] === 0x05 || b[2] === 0x07),
  },
  {
    mime: "application/x-msdownload",
    match: (b) => b.length >= 2 && b.subarray(0, 2).toString("latin1") === "MZ",
  },
  {
    mime: "application/x-elf",
    match: (b) =>
      b.length >= 4 && b.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46])),
  },
];

function looksLikeText(buffer: Buffer): boolean {
  const sample = buffer.subarray(0, Math.min(buffer.length, 8_000));
  if (sample.length === 0) return true;
  let suspicious = 0;
  for (const byte of sample) {
    if (byte === 0) return false;
    const isControl = byte < 7 || (byte > 14 && byte < 32 && byte !== 27);
    if (isControl) suspicious++;
  }
  return suspicious / sample.length < 0.02;
}

/** Derive a MIME type from file content only. Never trust `file.type`. */
export function sniffMimeType(buffer: Buffer): string {
  for (const signature of SIGNATURES) {
    if (signature.match(buffer)) return signature.mime;
  }
  return looksLikeText(buffer) ? "text/plain" : "application/octet-stream";
}

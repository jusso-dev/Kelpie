/**
 * Reports archive metadata (kind, entry count, password protection) from
 * container-format bytes only. Never extracts or decompresses entries — the
 * issue this supports explicitly excludes unpacking unsafe content.
 */

export type ArchiveSniffResult = {
  isArchive: boolean;
  kind: string | null;
  entryCount: number | null;
  passwordProtected: boolean | null;
};

const NOT_ARCHIVE: ArchiveSniffResult = {
  isArchive: false,
  kind: null,
  entryCount: null,
  passwordProtected: null,
};

function sniffZip(buffer: Buffer): ArchiveSniffResult {
  const eocdSignature = [0x50, 0x4b, 0x05, 0x06];
  const searchWindow = 65_557; // max comment length (65535) + EOCD record (22)
  const searchStart = Math.max(0, buffer.length - searchWindow);
  let eocdIndex = -1;
  for (let i = buffer.length - 4; i >= searchStart; i--) {
    if (
      buffer[i] === eocdSignature[0] &&
      buffer[i + 1] === eocdSignature[1] &&
      buffer[i + 2] === eocdSignature[2] &&
      buffer[i + 3] === eocdSignature[3]
    ) {
      eocdIndex = i;
      break;
    }
  }

  let entryCount: number | null = null;
  if (eocdIndex >= 0 && eocdIndex + 12 <= buffer.length) {
    entryCount = buffer.readUInt16LE(eocdIndex + 10);
  }

  let passwordProtected: boolean | null = null;
  const isLocalFileHeader =
    buffer.length >= 8 &&
    buffer[0] === 0x50 &&
    buffer[1] === 0x4b &&
    buffer[2] === 0x03 &&
    buffer[3] === 0x04;
  if (isLocalFileHeader) {
    const generalPurposeFlag = buffer.readUInt16LE(6);
    passwordProtected = (generalPurposeFlag & 0x0001) !== 0;
  }

  return { isArchive: true, kind: "zip", entryCount, passwordProtected };
}

export function sniffArchive(buffer: Buffer): ArchiveSniffResult {
  if (
    buffer.length >= 4 &&
    buffer[0] === 0x50 &&
    buffer[1] === 0x4b &&
    (buffer[2] === 0x03 || buffer[2] === 0x05)
  ) {
    return sniffZip(buffer);
  }
  if (
    buffer.length >= 6 &&
    buffer.subarray(0, 6).equals(Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]))
  ) {
    return { isArchive: true, kind: "7z", entryCount: null, passwordProtected: null };
  }
  if (buffer.length >= 4 && buffer.subarray(0, 4).toString("latin1") === "Rar!") {
    return { isArchive: true, kind: "rar", entryCount: null, passwordProtected: null };
  }
  if (buffer.length >= 2 && buffer[0] === 0x1f && buffer[1] === 0x8b) {
    return { isArchive: true, kind: "gzip", entryCount: null, passwordProtected: null };
  }
  return NOT_ARCHIVE;
}

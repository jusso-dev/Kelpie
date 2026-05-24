import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const localDir = process.env.STORAGE_LOCAL_DIR ?? "./uploads";

export type StoredFile = {
  key: string;
  sha256: string;
  sizeBytes: number;
};

export async function putFile(
  buffer: Buffer,
  organisationId: string,
  filename: string,
): Promise<StoredFile> {
  const sha256 = crypto.createHash("sha256").update(buffer).digest("hex");
  const safeName = filename.replace(/[^A-Za-z0-9._-]/g, "_");
  const key = path.posix.join(
    organisationId,
    sha256.slice(0, 2),
    `${sha256}-${safeName}`,
  );
  const absDir = path.join(localDir, path.dirname(key));
  await fs.mkdir(absDir, { recursive: true });
  await fs.writeFile(path.join(localDir, key), buffer);
  return { key, sha256, sizeBytes: buffer.length };
}

export async function readFile(key: string): Promise<Buffer> {
  return fs.readFile(path.join(localDir, key));
}

import { db } from "@/db";
import { investigationResultRefs } from "@/db/schema";
import { putFile, readFile } from "@/lib/storage";
import { newId } from "@/lib/utils";
import {
  boundResultPayload,
  safeStringify,
} from "./limits";
import { redactResult } from "./redaction";
import {
  INLINE_RESULT_SUMMARY_BYTES,
  type ResultRenderer,
} from "./types";

export type StoredResult = {
  resultSummary: Record<string, unknown> | null;
  resultStorageKey: string | null;
  resultSha256: string | null;
  resultSizeBytes: number;
  resultRefId: string | null;
  truncated: boolean;
};

/**
 * Redact + bound the result, persist full payload to storage when over the
 * inline summary cap, and record a durable result ref row.
 */
export async function storeCommandResult(opts: {
  organisationId: string;
  executionId: string;
  data: unknown;
  maxResultBytes: number;
  renderer: ResultRenderer;
  summary: string;
}): Promise<StoredResult> {
  const redacted = redactResult(opts.data);
  const bounded = boundResultPayload(redacted, opts.maxResultBytes);
  const envelope = {
    renderer: opts.renderer,
    summary: opts.summary,
    truncated: bounded.truncated,
    data: bounded.data,
  };
  const fullJson = safeStringify(envelope);
  const sizeBytes = Buffer.byteLength(fullJson, "utf8");

  let resultSummary: Record<string, unknown> | null = envelope;
  let resultStorageKey: string | null = null;
  let resultSha256: string | null = null;
  let resultRefId: string | null = null;

  if (sizeBytes > INLINE_RESULT_SUMMARY_BYTES) {
    // Keep a lean inline summary; full payload goes to storage.
    resultSummary = {
      renderer: opts.renderer,
      summary: opts.summary,
      truncated: bounded.truncated,
      stored: true,
      note: "Full result stored separately; fetch via execution detail.",
    };
    const buffer = Buffer.from(fullJson, "utf8");
    const stored = await putFile(
      buffer,
      opts.organisationId,
      `investigation-result-${opts.executionId}.json`,
    );
    resultStorageKey = stored.key;
    resultSha256 = stored.sha256;
    resultRefId = newId("irr");
    await db.insert(investigationResultRefs).values({
      id: resultRefId,
      organisationId: opts.organisationId,
      executionId: opts.executionId,
      storageKey: stored.key,
      sha256: stored.sha256,
      sizeBytes: stored.sizeBytes,
      contentType: "application/json",
    });
  } else {
    // Still hash inline payloads so evidence save has a stable hash.
    const crypto = await import("node:crypto");
    resultSha256 = crypto.createHash("sha256").update(fullJson, "utf8").digest("hex");
  }

  return {
    resultSummary,
    resultStorageKey,
    resultSha256,
    resultSizeBytes: sizeBytes,
    resultRefId,
    truncated: bounded.truncated,
  };
}

/** Load the full result JSON for an execution (inline or storage). */
export async function loadFullResultPayload(opts: {
  resultSummary: unknown;
  resultStorageKey: string | null;
}): Promise<unknown> {
  if (opts.resultStorageKey) {
    const buf = await readFile(opts.resultStorageKey);
    try {
      return JSON.parse(buf.toString("utf8"));
    } catch {
      return { error: "corrupt_result_payload" };
    }
  }
  return opts.resultSummary;
}

import { NextResponse } from "next/server";
import {
  fulfillEvidenceRequest,
  requireStakeholderAuth,
  StakeholderError,
} from "@/lib/stakeholder";
import { EvidenceError } from "@/lib/evidence/core";

/**
 * External evidence upload. Reuses the same quarantine / integrity / custody
 * pipeline as staff uploads (#44). File lands as pending_scan.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ requestId: string }> },
) {
  try {
    const ctx = await requireStakeholderAuth(req);
    const { requestId } = await params;

    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "file is required" }, { status: 400 });
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    const result = await fulfillEvidenceRequest(ctx, requestId, {
      buffer,
      filename: file.name || "upload.bin",
      contentType: file.type || null,
    });
    return NextResponse.json({
      ok: true,
      requestId: result.request.id,
      attachmentId: result.attachmentId,
      status: result.request.status,
      // External never learns scan internals beyond "accepted for scanning".
      message: "Upload received and queued for scanning",
    });
  } catch (e) {
    if (e instanceof StakeholderError || e instanceof EvidenceError) {
      return NextResponse.json(
        { error: e.message },
        { status: (e as { status: number }).status },
      );
    }
    throw e;
  }
}

import { NextResponse } from "next/server";
import { requireUser } from "@/lib/session";
import { downloadEvidenceCore, EvidenceError } from "@/lib/evidence/core";
import { stripControlChars } from "@/lib/evidence/filename";

export async function GET(
  _req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const user = await requireUser();
  try {
    const { evidence, buffer } = await downloadEvidenceCore(
      id,
      user.organisationId,
      user.id,
    );
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "content-type": evidence.contentType,
        "content-disposition": `attachment; filename="${stripControlChars(evidence.filename).replace(/"/g, "")}"`,
        "x-evidence-sha256": evidence.sha256,
      },
    });
  } catch (error) {
    if (error instanceof EvidenceError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}

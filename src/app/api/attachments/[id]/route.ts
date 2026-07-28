import { NextResponse } from "next/server";
import { requireUser } from "@/lib/session";
import {
  authorizeCase,
  resolveUserActor,
} from "@/lib/access";
import {
  downloadEvidenceCore,
  EvidenceError,
  getEvidenceInOrg,
} from "@/lib/evidence/core";
import { stripControlChars } from "@/lib/evidence/filename";

export async function GET(
  _req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const user = await requireUser();
  try {
    const evidence = await getEvidenceInOrg(id, user.organisationId);
    if (!evidence) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const actor = await resolveUserActor(user.organisationId, user.id);
    if (!actor) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    // Sensitive evidence needs view_sensitive; otherwise view_metadata is enough
    // to know the file exists and download non-sensitive attachments.
    const required = evidence.sensitive ? "view_sensitive" : "view_metadata";
    const gate = await authorizeCase(
      user.organisationId,
      evidence.caseId,
      actor,
      required,
    );
    if (!gate.ok) {
      return NextResponse.json({ error: gate.error }, { status: gate.status });
    }

    const { evidence: row, buffer } = await downloadEvidenceCore(
      id,
      user.organisationId,
      user.id,
    );
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "content-type": row.contentType,
        "content-disposition": `attachment; filename="${stripControlChars(row.filename).replace(/"/g, "")}"`,
        "x-evidence-sha256": row.sha256,
      },
    });
  } catch (error) {
    if (error instanceof EvidenceError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}

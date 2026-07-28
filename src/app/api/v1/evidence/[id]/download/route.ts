import { NextResponse } from "next/server";
import { db } from "@/db";
import { cases, users } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { authenticateApiTokenWithScope } from "@/lib/api-tokens";
import {
  EvidenceError,
  assertEvidenceExportable,
  downloadEvidenceCore,
  getEvidenceInOrg,
} from "@/lib/evidence/core";
import { stripControlChars } from "@/lib/evidence/filename";

const TLP_VALUES = ["clear", "green", "amber", "amber_strict", "red"] as const;
const PAP_VALUES = ["clear", "green", "amber", "red"] as const;

export async function GET(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateApiTokenWithScope(req, "evidence:read");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  const { id } = await context.params;
  const url = new URL(req.url);
  const maxTlpParam = url.searchParams.get("max_tlp");
  const maxPapParam = url.searchParams.get("max_pap");
  const maxTlp =
    maxTlpParam && (TLP_VALUES as readonly string[]).includes(maxTlpParam)
      ? (maxTlpParam as (typeof TLP_VALUES)[number])
      : null;
  const maxPap =
    maxPapParam && (PAP_VALUES as readonly string[]).includes(maxPapParam)
      ? (maxPapParam as (typeof PAP_VALUES)[number])
      : null;
  if ((maxTlpParam && !maxTlp) || (maxPapParam && !maxPap)) {
    return NextResponse.json({ error: "Invalid max_tlp or max_pap" }, { status: 400 });
  }
  const [actor] = auth.token.createdBy
    ? await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.id, auth.token.createdBy))
        .limit(1)
    : [];
  if (!actor) {
    return NextResponse.json(
      { error: "This action requires a token created by a user" },
      { status: 400 },
    );
  }
  try {
    if (maxTlp || maxPap) {
      const evidence = await getEvidenceInOrg(id, auth.token.organisationId);
      if (!evidence) throw new EvidenceError("Evidence not found", 404);
      const [caseRow] = await db
        .select({ tlp: cases.tlp, pap: cases.pap })
        .from(cases)
        .where(
          and(
            eq(cases.id, evidence.caseId),
            eq(cases.organisationId, auth.token.organisationId),
          ),
        )
        .limit(1);
      if (!caseRow) throw new EvidenceError("Case not found", 404);
      assertEvidenceExportable(evidence, caseRow, {
        maxTlp: maxTlp ?? undefined,
        maxPap: maxPap ?? undefined,
      });
    }
    const { evidence, buffer } = await downloadEvidenceCore(
      id,
      auth.token.organisationId,
      actor.id,
    );
    const filename = stripControlChars(evidence.filename).replace(/"/g, "");
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "content-type": evidence.contentType,
        "content-disposition": `attachment; filename="${filename}"`,
        "x-evidence-sha256": evidence.sha256,
      },
    });
  } catch (err) {
    if (err instanceof EvidenceError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}

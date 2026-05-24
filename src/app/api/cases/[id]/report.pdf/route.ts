import { NextResponse } from "next/server";
import { requireUser } from "@/lib/session";
import { loadCaseReport } from "@/lib/report";
import { renderCasePdf } from "@/lib/report-pdf";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const user = await requireUser();
  const data = await loadCaseReport(user.organisationId, id);
  if (!data) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const buf = await renderCasePdf(data);
  return new NextResponse(new Uint8Array(buf), {
    status: 200,
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="${data.case.caseNumber}.pdf"`,
    },
  });
}

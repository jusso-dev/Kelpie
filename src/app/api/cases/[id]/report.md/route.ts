import { NextResponse } from "next/server";
import { requireUser } from "@/lib/session";
import { loadCaseReport, renderCaseMarkdown } from "@/lib/report";

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
  const md = renderCaseMarkdown(data);
  return new NextResponse(md, {
    status: 200,
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      "content-disposition": `attachment; filename="${data.case.caseNumber}.md"`,
    },
  });
}

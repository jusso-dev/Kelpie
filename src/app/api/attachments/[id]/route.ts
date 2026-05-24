import { NextResponse } from "next/server";
import { db } from "@/db";
import { attachments, cases } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { requireUser } from "@/lib/session";
import { readFile } from "@/lib/storage";

export async function GET(
  _req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const user = await requireUser();
  const [row] = await db
    .select({
      filename: attachments.filename,
      contentType: attachments.contentType,
      storageKey: attachments.storageKey,
      organisationId: cases.organisationId,
    })
    .from(attachments)
    .innerJoin(cases, eq(cases.id, attachments.caseId))
    .where(and(eq(attachments.id, id), eq(cases.organisationId, user.organisationId)))
    .limit(1);
  if (!row) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const data = await readFile(row.storageKey);
  return new NextResponse(new Uint8Array(data), {
    status: 200,
    headers: {
      "content-type": row.contentType,
      "content-disposition": `attachment; filename="${row.filename.replace(/"/g, "")}"`,
    },
  });
}

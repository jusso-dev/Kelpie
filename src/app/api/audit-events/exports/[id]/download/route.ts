import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { auditExportJobs } from "@/db/schema";
import { requireRole } from "@/lib/session";
import { readFile } from "@/lib/storage";

const CONTENT_TYPES = {
  csv: "text/csv",
  ndjson: "application/x-ndjson",
} as const;

export async function GET(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const user = await requireRole(["admin"]);
  const { id } = await context.params;
  const [job] = await db
    .select()
    .from(auditExportJobs)
    .where(
      and(
        eq(auditExportJobs.id, id),
        eq(auditExportJobs.organisationId, user.organisationId),
      ),
    )
    .limit(1);
  if (!job || job.status !== "completed" || !job.storageKey) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const buffer = await readFile(job.storageKey);
  const extension = job.format === "csv" ? "csv" : "ndjson";
  return new Response(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "content-type": CONTENT_TYPES[job.format],
      "content-disposition": `attachment; filename="audit-events-${job.id}.${extension}"`,
    },
  });
}

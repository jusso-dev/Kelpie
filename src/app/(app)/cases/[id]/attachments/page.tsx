import { db } from "@/db";
import { attachments, users } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { format } from "date-fns";
import { requireUser } from "@/lib/session";
import { uploadAttachment } from "@/actions/attachments";

type Props = { params: Promise<{ id: string }> };

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default async function CaseAttachmentsPage({ params }: Props) {
  const { id } = await params;
  await requireUser();
  const rows = await db
    .select({
      id: attachments.id,
      filename: attachments.filename,
      contentType: attachments.contentType,
      sizeBytes: attachments.sizeBytes,
      sha256: attachments.sha256,
      uploadedAt: attachments.uploadedAt,
      uploadedByName: users.name,
    })
    .from(attachments)
    .leftJoin(users, eq(users.id, attachments.uploadedBy))
    .where(eq(attachments.caseId, id))
    .orderBy(desc(attachments.uploadedAt));

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <div className="md:col-span-2 kelpie-card overflow-hidden">
        <table className="kelpie-table">
          <thead>
            <tr>
              <th>File</th>
              <th>Size</th>
              <th>SHA256</th>
              <th>Uploaded</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={4} className="text-center text-slate-500 py-8">
                  No attachments yet.
                </td>
              </tr>
            ) : (
              rows.map((a) => (
                <tr key={a.id}>
                  <td>
                    <a
                      href={`/api/attachments/${a.id}`}
                      className="kelpie-link"
                    >
                      {a.filename}
                    </a>
                    <div className="text-xs text-slate-500">{a.contentType}</div>
                  </td>
                  <td className="text-slate-300 tabular-nums">
                    {formatSize(a.sizeBytes)}
                  </td>
                  <td className="font-mono text-xs text-slate-500">
                    {a.sha256.slice(0, 16)}...
                  </td>
                  <td className="text-xs text-slate-400">
                    {format(a.uploadedAt, "PP p")}
                    <div className="text-slate-500">{a.uploadedByName}</div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <div>
        <form action={uploadAttachment} className="kelpie-card p-5 space-y-3">
          <input type="hidden" name="caseId" value={id} />
          <h2 className="text-sm font-medium text-slate-300">Upload a file</h2>
          <input
            name="file"
            type="file"
            required
            className="block w-full text-sm text-slate-300 file:mr-2 file:px-3 file:py-1 file:rounded file:border-0 file:bg-[color:var(--color-navy-700)] file:text-slate-200"
          />
          <p className="text-xs text-slate-500">
            Max 25 MB. Stored locally by default; configure S3 for production.
          </p>
          <button className="kelpie-btn kelpie-btn-primary w-full justify-center">
            Upload
          </button>
        </form>
      </div>
    </div>
  );
}

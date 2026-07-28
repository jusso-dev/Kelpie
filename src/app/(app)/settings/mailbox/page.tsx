import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { mailboxConnections, mailboxMessages } from "@/db/schema";
import { requireUser } from "@/lib/session";
import MailboxIntakeHistory from "@/components/mailbox-intake-history";

export default async function MailboxIntakePage() {
  const user = await requireUser();
  const canMutate = user.role === "admin" || user.role === "analyst";

  const connections = await db
    .select({
      id: mailboxConnections.id,
      name: mailboxConnections.name,
    })
    .from(mailboxConnections)
    .where(eq(mailboxConnections.organisationId, user.organisationId));

  const connectionName = new Map(connections.map((c) => [c.id, c.name]));

  const rows = await db
    .select()
    .from(mailboxMessages)
    .where(eq(mailboxMessages.organisationId, user.organisationId))
    .orderBy(desc(mailboxMessages.createdAt))
    .limit(100);

  // Extra tenant guard: only show messages whose connection is in this org.
  const connectionIds = new Set(connections.map((c) => c.id));
  const messages = rows
    .filter((m) => connectionIds.has(m.connectionId))
    .map((m) => {
      const meta = Array.isArray(m.attachmentMeta)
        ? (m.attachmentMeta as unknown[])
        : [];
      return {
        id: m.id,
        connectionId: m.connectionId,
        connectionName: connectionName.get(m.connectionId) ?? "Mailbox",
        providerMessageId: m.providerMessageId,
        subject: m.subject,
        fromAddress: m.fromAddress,
        receivedAt: m.receivedAt?.toISOString() ?? null,
        status: m.status,
        failureReason: m.failureReason,
        dismissReason: m.dismissReason,
        caseId: m.caseId,
        retryCount: m.retryCount,
        createdAt: m.createdAt.toISOString(),
        bodyTextPreview: (m.bodyText ?? "").slice(0, 4000),
        bodyHtmlSanitized: m.bodyHtmlSanitized,
        attachmentCount: meta.length,
      };
    });

  return (
    <div className="kelpie-page max-w-6xl">
      <header>
        <Link
          href="/settings/integrations"
          className="text-xs text-slate-400 hover:text-slate-200"
        >
          ← Integrations
        </Link>
        <h1 className="text-2xl font-semibold mt-1">Mailbox intake</h1>
        <p className="text-sm text-slate-400">
          Review inbound messages, create cases, retry failures, or dismiss with
          a reason. HTML is always sanitised before display.
        </p>
      </header>

      <section className="kelpie-section">
        <div className="kelpie-section-header">
          <h2>Intake history</h2>
          <p>
            Deduplicated by provider message id per mailbox connection. Cross-org
            messages never appear here.
          </p>
        </div>
        <MailboxIntakeHistory messages={messages} canMutate={canMutate} />
      </section>
    </div>
  );
}

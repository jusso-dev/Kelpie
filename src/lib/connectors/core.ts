import { db } from "@/db";
import { alerts, siemConnectors, siemCursors } from "@/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import { newId } from "@/lib/utils";
import { fireWebhook } from "@/lib/webhooks";
import { getConnector } from "./registry";
import { applyMapping } from "./mapping";
import type { FieldMapping } from "./types";

async function alertExists(
  organisationId: string,
  externalRef: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: alerts.id })
    .from(alerts)
    .where(
      and(
        eq(alerts.organisationId, organisationId),
        eq(alerts.externalRef, externalRef),
      ),
    )
    .limit(1);
  return Boolean(row);
}

export async function pollConnector(connectorId: string): Promise<{
  produced: number;
  error: string | null;
}> {
  const [conn] = await db
    .select()
    .from(siemConnectors)
    .where(eq(siemConnectors.id, connectorId))
    .limit(1);
  if (!conn) return { produced: 0, error: "connector not found" };

  const handler = getConnector(conn.kind);
  if (!handler) {
    await db
      .update(siemConnectors)
      .set({ lastError: `unknown connector kind: ${conn.kind}`, lastPolledAt: new Date() })
      .where(eq(siemConnectors.id, conn.id));
    return { produced: 0, error: "unknown kind" };
  }

  const [cursorRow] = await db
    .select()
    .from(siemCursors)
    .where(eq(siemCursors.connectorId, conn.id))
    .limit(1);
  const cursor = cursorRow?.cursor ?? null;

  // A configured mapping overrides the handler default. Missing keys fall back.
  const stored = (conn.mapping as Partial<FieldMapping>) ?? {};
  const mapping: FieldMapping = {
    ...handler.defaultMapping,
    ...stored,
  };

  let produced = 0;
  try {
    const { records, nextCursor } = await handler.poll({
      config: (conn.config as Record<string, unknown>) ?? {},
      cursor,
    });

    for (const record of records) {
      const normalised = applyMapping(record, mapping);
      if (normalised.externalRef) {
        const dup = await alertExists(conn.organisationId, normalised.externalRef);
        if (dup) continue;
      }
      const id = newId("alert");
      await db.insert(alerts).values({
        id,
        organisationId: conn.organisationId,
        source: `${conn.kind}:${conn.name}`,
        externalRef: normalised.externalRef,
        title: normalised.title,
        description: normalised.description,
        severity: normalised.severity,
        rawPayload: normalised.rawPayload,
        observables: normalised.observables,
      });
      produced++;
      await fireWebhook(conn.organisationId, "alert.created", {
        alert_id: id,
        title: normalised.title,
        severity: normalised.severity,
        source: `${conn.kind}:${conn.name}`,
      });
    }

    if (nextCursor && nextCursor !== cursor) {
      if (cursorRow) {
        await db
          .update(siemCursors)
          .set({ cursor: nextCursor, updatedAt: new Date() })
          .where(eq(siemCursors.connectorId, conn.id));
      } else {
        await db.insert(siemCursors).values({
          connectorId: conn.id,
          cursor: nextCursor,
        });
      }
    }

    await db
      .update(siemConnectors)
      .set({
        lastPolledAt: new Date(),
        lastError: null,
        alertsProduced: conn.alertsProduced + produced,
      })
      .where(eq(siemConnectors.id, conn.id));
    return { produced, error: null };
  } catch (e) {
    const error = (e as Error).message;
    // Setting last_error halts further polling until an admin clears it.
    await db
      .update(siemConnectors)
      .set({ lastPolledAt: new Date(), lastError: error })
      .where(eq(siemConnectors.id, conn.id));
    return { produced, error };
  }
}

/**
 * Polls every active connector that is not currently halted by a stored error.
 */
export async function pollAllActiveConnectors(): Promise<{
  polled: number;
  produced: number;
}> {
  const active = await db
    .select({ id: siemConnectors.id })
    .from(siemConnectors)
    .where(
      and(eq(siemConnectors.isActive, true), isNull(siemConnectors.lastError)),
    );
  let produced = 0;
  for (const c of active) {
    const r = await pollConnector(c.id);
    produced += r.produced;
  }
  return { polled: active.length, produced };
}

import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { alerts } from "@/db/schema";
import { authenticateApiTokenWithScope } from "@/lib/api-tokens";
import {
  acknowledgeAlertsCore,
  dismissAlertsCore,
  promoteAlertToCaseCore,
} from "@/lib/alert-triage";

const patchSchema = z.object({
  action: z.enum(["acknowledge", "dismiss", "promote"]),
});

export async function GET(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateApiTokenWithScope(req, "alerts:read");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  const { id } = await context.params;
  const [alert] = await db
    .select()
    .from(alerts)
    .where(
      and(eq(alerts.id, id), eq(alerts.organisationId, auth.token.organisationId)),
    )
    .limit(1);
  if (!alert) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(alert);
}

export async function PATCH(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateApiTokenWithScope(req, "alerts:write");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  const { id } = await context.params;
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const [current] = await db
    .select({ status: alerts.status })
    .from(alerts)
    .where(
      and(eq(alerts.id, id), eq(alerts.organisationId, auth.token.organisationId)),
    )
    .limit(1);
  if (!current) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (
    (parsed.data.action === "acknowledge" &&
      !["new", "triaged"].includes(current.status)) ||
    (parsed.data.action === "dismiss" && current.status === "promoted") ||
    (parsed.data.action === "promote" && current.status === "dismissed")
  ) {
    return NextResponse.json(
      { error: `Alert is already ${current.status}` },
      { status: 409 },
    );
  }

  try {
    let caseId: string | null = null;
    if (parsed.data.action === "acknowledge") {
      await acknowledgeAlertsCore(
        auth.token.organisationId,
        auth.token.createdBy,
        [id],
      );
    } else if (parsed.data.action === "dismiss") {
      await dismissAlertsCore(
        auth.token.organisationId,
        auth.token.createdBy,
        [id],
      );
    } else {
      caseId = (
        await promoteAlertToCaseCore(
          auth.token.organisationId,
          auth.token.createdBy,
          id,
        )
      ).caseId;
    }
    const [updated] = await db
      .select()
      .from(alerts)
      .where(
        and(eq(alerts.id, id), eq(alerts.organisationId, auth.token.organisationId)),
      )
      .limit(1);
    if (!updated) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ ...updated, caseId });
  } catch (error) {
    const message = (error as Error).message;
    return NextResponse.json(
      { error: message === "Alert not found" ? "Not found" : message },
      { status: message === "Alert not found" ? 404 : 409 },
    );
  }
}

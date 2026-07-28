import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateApiTokenWithScope } from "@/lib/api-tokens";
import {
  WatcherError,
  removeWatcherCore,
  updateWatcherPreferencesCore,
} from "@/lib/watchers-core";

const preferencesSchema = z.object({
  notifyOnComment: z.boolean().optional(),
  notifyOnStatusChange: z.boolean().optional(),
  notifyOnAssignment: z.boolean().optional(),
  notifyOnEscalation: z.boolean().optional(),
});

export async function PATCH(
  req: Request,
  context: { params: Promise<{ id: string; userId: string }> },
) {
  const auth = await authenticateApiTokenWithScope(req, "watchers:write");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  const { id, userId } = await context.params;
  const body = await req.json().catch(() => null);
  const parsed = preferencesSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid payload", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  try {
    await updateWatcherPreferencesCore(auth.token.organisationId, id, userId, parsed.data);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof WatcherError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}

export async function DELETE(
  req: Request,
  context: { params: Promise<{ id: string; userId: string }> },
) {
  const auth = await authenticateApiTokenWithScope(req, "watchers:write");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  const { id, userId } = await context.params;
  await removeWatcherCore(auth.token.organisationId, id, userId);
  return NextResponse.json({ ok: true });
}

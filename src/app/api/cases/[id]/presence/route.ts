import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { cases, users } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { getRoster, heartbeat, leave } from "@/lib/presence";
import { getRecentActivity, type CaseActivityCursor } from "@/lib/case-activity";

async function resolve(id: string) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return null;
  const [u] = await db
    .select({
      id: users.id,
      name: users.name,
      organisationId: users.organisationId,
    })
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1);
  if (!u || !u.organisationId) return null;
  const [c] = await db
    .select({ id: cases.id })
    .from(cases)
    .where(and(eq(cases.id, id), eq(cases.organisationId, u.organisationId)))
    .limit(1);
  if (!c) return null;
  return { userId: u.id, userName: u.name };
}

// Server-sent events stream of the case roster plus the case-activity
// channel (case, task, comment, observable, and assignment changes). Both
// share this one authorized-per-organisation-and-case connection rather than
// opening a second transport.
export async function GET(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const me = await resolve(id);
  if (!me) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      // Starts at connection time: the page's initial server render already
      // has full, authoritative data, so the channel only needs to announce
      // activity from here on. This cursor lives only in this connection's
      // closure and is discarded on reconnect; the client performs its own
      // authoritative refetch whenever a connection (re)opens, so a
      // restarted server or a dropped connection can never leave a client
      // stuck on stale data waiting for a gap-filling replay that never
      // comes.
      let activityCursor: CaseActivityCursor = {
        occurredAt: new Date(),
        // Sorts before any real id, so an event written in the same
        // millisecond this connection opened is still delivered.
        id: "",
      };
      const push = async () => {
        if (closed) return;
        try {
          const [roster, activity] = await Promise.all([
            getRoster(id, me.userId),
            getRecentActivity(id, activityCursor),
          ]);
          if (activity.length > 0) {
            const last = activity[activity.length - 1];
            activityCursor = {
              occurredAt: new Date(last.occurredAt),
              id: last.id,
            };
          }
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ roster, activity })}\n\n`),
          );
        } catch {
          // Swallow transient DB errors; the next tick retries.
        }
      };
      await push();
      const interval = setInterval(push, 2000);
      const stop = () => {
        if (closed) return;
        closed = true;
        clearInterval(interval);
        try {
          controller.close();
        } catch {
          // already closed
        }
      };
      req.signal.addEventListener("abort", stop);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}

// Heartbeat / set editing state.
export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const me = await resolve(id);
  if (!me) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }
  const body = (await req.json().catch(() => ({}))) as {
    editingField?: string | null;
    typing?: boolean;
    leave?: boolean;
  };
  if (body.leave) {
    await leave(id, me.userId);
    return NextResponse.json({ ok: true });
  }
  await heartbeat({
    caseId: id,
    userId: me.userId,
    userName: me.userName,
    editingField: body.editingField ?? null,
    typing: Boolean(body.typing),
  });
  const roster = await getRoster(id, me.userId);
  return NextResponse.json({ roster });
}

export async function DELETE(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const me = await resolve(id);
  if (!me) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }
  await leave(id, me.userId);
  return NextResponse.json({ ok: true });
}

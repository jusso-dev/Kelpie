import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateMobileUser } from "@/lib/mobile-auth";
import {
  registerMobileDevice,
  unregisterMobileDevice,
} from "@/lib/mobile-push";

const deviceSchema = z.object({
  token: z.string().regex(/^[a-fA-F0-9]{32,}$/),
  environment: z.enum(["sandbox", "production"]),
});

export async function POST(req: Request) {
  const auth = await authenticateMobileUser(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  const parsed = deviceSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_payload", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const device = await registerMobileDevice({
    organisationId: auth.token.organisationId,
    userId: auth.user.id,
    ...parsed.data,
    token: parsed.data.token.toLowerCase(),
    bundleId: process.env.APNS_BUNDLE_ID?.trim() || "dev.kelpie.mobile",
  });
  return NextResponse.json(device, { status: 201 });
}

export async function DELETE(req: Request) {
  const auth = await authenticateMobileUser(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  const parsed = deviceSchema.pick({ token: true }).safeParse(
    await req.json().catch(() => null),
  );
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  }
  await unregisterMobileDevice({
    organisationId: auth.token.organisationId,
    userId: auth.user.id,
    token: parsed.data.token.toLowerCase(),
  });
  return NextResponse.json({ ok: true });
}

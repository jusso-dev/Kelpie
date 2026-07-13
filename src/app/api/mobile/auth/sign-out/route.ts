import { NextResponse } from "next/server";
import { authenticateMobileRequest, revokeMobileToken } from "@/lib/mobile-auth";

export async function POST(req: Request) {
  const auth = await authenticateMobileRequest(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }

  await revokeMobileToken(auth.token.id, auth.token.organisationId);
  return NextResponse.json({ ok: true });
}

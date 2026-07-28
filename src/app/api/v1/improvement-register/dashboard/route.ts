import { NextResponse } from "next/server";
import { authenticateApiTokenWithScope } from "@/lib/api-tokens";
import {
  ImprovementRegisterError,
  improvementDashboardCore,
} from "@/lib/improvement-register";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await authenticateApiTokenWithScope(req, "improvements:read");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  try {
    const dashboard = await improvementDashboardCore(
      auth.token.organisationId,
      auth.token.createdBy,
    );
    return NextResponse.json(
      { dashboard },
      { headers: { "cache-control": "private, no-store" } },
    );
  } catch (err) {
    if (err instanceof ImprovementRegisterError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}

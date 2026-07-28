import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateApiTokenWithScope } from "@/lib/api-tokens";
import { resolveTokenActor } from "@/lib/access";
import {
  createStakeholderInvite,
  listStakeholderInvites,
  STAKEHOLDER_ROLES,
  StakeholderError,
  TLP_ORDER,
  PAP_ORDER,
} from "@/lib/stakeholder";

const createSchema = z.object({
  email: z.string().email().max(320),
  displayName: z.string().min(1).max(200),
  organisationLabel: z.string().max(200).optional().nullable(),
  role: z.enum(STAKEHOLDER_ROLES),
  purpose: z.string().min(3).max(500),
  maxTlp: z.enum(TLP_ORDER).default("amber"),
  maxPap: z.enum(PAP_ORDER).default("amber"),
  expiresInHours: z.number().int().min(1).max(24 * 30).optional(),
  singleUse: z.boolean().optional(),
});

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateApiTokenWithScope(req, "cases:read");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  const { id: caseId } = await params;
  const invites = await listStakeholderInvites(auth.token.organisationId, caseId);
  return NextResponse.json({
    invites: invites.map((i) => ({
      id: i.id,
      role: i.role,
      purpose: i.purpose,
      status: i.status,
      maxTlp: i.maxTlp,
      maxPap: i.maxPap,
      expiresAt: i.expiresAt.toISOString(),
      collaboratorEmail: i.collaboratorEmail,
      collaboratorName: i.collaboratorName,
      singleUse: i.singleUse,
      createdAt: i.createdAt.toISOString(),
    })),
  });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateApiTokenWithScope(req, "cases:write");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  const { id: caseId } = await params;
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = createSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const actor = await resolveTokenActor(auth.token);

  try {
    const result = await createStakeholderInvite({
      organisationId: auth.token.organisationId,
      caseId,
      actor,
      invitedByUserId: auth.token.createdBy ?? "",
      email: parsed.data.email,
      displayName: parsed.data.displayName,
      organisationLabel: parsed.data.organisationLabel,
      role: parsed.data.role,
      purpose: parsed.data.purpose,
      maxTlp: parsed.data.maxTlp,
      maxPap: parsed.data.maxPap,
      expiresInHours: parsed.data.expiresInHours,
      singleUse: parsed.data.singleUse,
    });
    return NextResponse.json(
      {
        id: result.invitation.id,
        token: result.token,
        expiresAt: result.invitation.expiresAt.toISOString(),
        role: result.invitation.role,
        status: result.invitation.status,
      },
      { status: 201 },
    );
  } catch (e) {
    if (e instanceof StakeholderError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    throw e;
  }
}

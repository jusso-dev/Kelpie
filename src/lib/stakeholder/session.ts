/**
 * External stakeholder sessions — token-based, distinct from BetterAuth.
 *
 * Auth never falls through to staff membership. Revoked/expired invites
 * and sessions fail closed with identical 401 responses (no enumeration).
 */

import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  externalCollaborators,
  stakeholderInvitations,
  stakeholderSessions,
  type ExternalCollaborator,
  type StakeholderInvitation,
  type StakeholderSession,
} from "@/db/schema";
import { newId } from "@/lib/utils";
import {
  generateSessionToken,
  hashStakeholderToken,
  looksLikeInviteToken,
  looksLikeSessionToken,
} from "./tokens";
import { recordStakeholderAccess } from "./audit";
import { StakeholderError, type StakeholderRole } from "./types";

export const STAKEHOLDER_SESSION_COOKIE = "kelpie_stakeholder_session";
/** Default session lifetime once invite is accepted. */
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

export type StakeholderAuthContext = {
  session: StakeholderSession;
  invitation: StakeholderInvitation;
  collaborator: ExternalCollaborator;
  role: StakeholderRole;
  caseId: string;
  organisationId: string;
};

function clientIp(req: Request): string | null {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]?.trim() || null;
  return req.headers.get("x-real-ip");
}

/**
 * Accept an invite token and mint a session token. Single-use invites burn
 * the invite token (status → accepted); multi-use keep pending/accepted
 * while still blocking after revoke/expiry.
 */
export async function acceptStakeholderInvite(opts: {
  inviteToken: string;
  sourceIp?: string | null;
  userAgent?: string | null;
}): Promise<{ sessionToken: string; context: StakeholderAuthContext }> {
  if (!looksLikeInviteToken(opts.inviteToken)) {
    throw new StakeholderError("Invalid or expired invitation", 401);
  }
  const hash = hashStakeholderToken(opts.inviteToken);
  const [inv] = await db
    .select()
    .from(stakeholderInvitations)
    .where(eq(stakeholderInvitations.tokenHash, hash))
    .limit(1);
  if (!inv) {
    throw new StakeholderError("Invalid or expired invitation", 401);
  }
  if (inv.status === "revoked" || inv.revokedAt) {
    throw new StakeholderError("Invalid or expired invitation", 401);
  }
  if (inv.expiresAt.getTime() <= Date.now()) {
    if (inv.status !== "expired") {
      await db
        .update(stakeholderInvitations)
        .set({ status: "expired", updatedAt: new Date() })
        .where(eq(stakeholderInvitations.id, inv.id));
    }
    throw new StakeholderError("Invalid or expired invitation", 401);
  }
  if (inv.singleUse && inv.status === "accepted") {
    // Single-use invite already consumed — block token replay.
    throw new StakeholderError("Invalid or expired invitation", 401);
  }

  const [collab] = await db
    .select()
    .from(externalCollaborators)
    .where(eq(externalCollaborators.id, inv.collaboratorId))
    .limit(1);
  if (!collab) {
    throw new StakeholderError("Invalid or expired invitation", 401);
  }

  const now = new Date();
  if (inv.status === "pending") {
    await db
      .update(stakeholderInvitations)
      .set({
        status: "accepted",
        acceptedAt: now,
        updatedAt: now,
      })
      .where(eq(stakeholderInvitations.id, inv.id));
    inv.status = "accepted";
    inv.acceptedAt = now;
  }

  const { plaintext, hash: sessionHash } = generateSessionToken();
  const sessionId = newId("stk_ses");
  const expiresAt = new Date(
    Math.min(now.getTime() + SESSION_TTL_MS, inv.expiresAt.getTime()),
  );
  const [session] = await db
    .insert(stakeholderSessions)
    .values({
      id: sessionId,
      organisationId: inv.organisationId,
      invitationId: inv.id,
      collaboratorId: inv.collaboratorId,
      caseId: inv.caseId,
      tokenHash: sessionHash,
      expiresAt,
    })
    .returning();
  if (!session) throw new StakeholderError("Failed to create session", 500);

  await recordStakeholderAccess({
    organisationId: inv.organisationId,
    caseId: inv.caseId,
    invitationId: inv.id,
    collaboratorId: inv.collaboratorId,
    sessionId,
    action: "session_started",
    targetType: "stakeholder_session",
    targetId: sessionId,
    sourceIp: opts.sourceIp,
    userAgent: opts.userAgent,
    actorLabel: collab.email,
  });

  return {
    sessionToken: plaintext,
    context: {
      session,
      invitation: inv,
      collaborator: collab,
      role: inv.role as StakeholderRole,
      caseId: inv.caseId,
      organisationId: inv.organisationId,
    },
  };
}

export async function authenticateStakeholderSession(
  sessionToken: string | null | undefined,
): Promise<StakeholderAuthContext | null> {
  if (!sessionToken || !looksLikeSessionToken(sessionToken)) return null;
  const hash = hashStakeholderToken(sessionToken);
  const [session] = await db
    .select()
    .from(stakeholderSessions)
    .where(eq(stakeholderSessions.tokenHash, hash))
    .limit(1);
  if (!session) return null;
  if (session.revokedAt) return null;
  if (session.expiresAt.getTime() <= Date.now()) return null;

  const [inv] = await db
    .select()
    .from(stakeholderInvitations)
    .where(eq(stakeholderInvitations.id, session.invitationId))
    .limit(1);
  if (!inv) return null;
  if (inv.status === "revoked" || inv.revokedAt) return null;
  if (inv.expiresAt.getTime() <= Date.now()) return null;
  if (inv.status === "expired") return null;

  const [collab] = await db
    .select()
    .from(externalCollaborators)
    .where(eq(externalCollaborators.id, session.collaboratorId))
    .limit(1);
  if (!collab) return null;

  // Touch lastSeenAt without failing the request on race.
  await db
    .update(stakeholderSessions)
    .set({ lastSeenAt: sql`now()` })
    .where(eq(stakeholderSessions.id, session.id))
    .catch(() => {});

  return {
    session,
    invitation: inv,
    collaborator: collab,
    role: inv.role as StakeholderRole,
    caseId: session.caseId,
    organisationId: session.organisationId,
  };
}

/** Extract session token from Authorization Bearer or cookie. */
export function extractStakeholderToken(req: Request): string | null {
  const header = req.headers.get("authorization");
  if (header?.startsWith("Bearer ")) {
    const t = header.slice(7).trim();
    if (t) return t;
  }
  const cookie = req.headers.get("cookie") ?? "";
  const match = cookie
    .split(";")
    .map((p) => p.trim())
    .find((p) => p.startsWith(`${STAKEHOLDER_SESSION_COOKIE}=`));
  if (match) {
    return decodeURIComponent(match.split("=").slice(1).join("="));
  }
  return null;
}

export async function requireStakeholderAuth(
  req: Request,
): Promise<StakeholderAuthContext> {
  const token = extractStakeholderToken(req);
  const ctx = await authenticateStakeholderSession(token);
  if (!ctx) {
    throw new StakeholderError("Not authenticated", 401);
  }
  return ctx;
}

export async function revokeStakeholderSession(
  sessionId: string,
  organisationId: string,
): Promise<void> {
  await db
    .update(stakeholderSessions)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(stakeholderSessions.id, sessionId),
        eq(stakeholderSessions.organisationId, organisationId),
        isNull(stakeholderSessions.revokedAt),
      ),
    );
}

export function stakeholderSessionCookieHeader(
  sessionToken: string,
  expiresAt: Date,
): string {
  const secure =
    process.env.NODE_ENV === "production" ||
    (process.env.APP_URL ?? "").startsWith("https");
  const parts = [
    `${STAKEHOLDER_SESSION_COOKIE}=${encodeURIComponent(sessionToken)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Expires=${expiresAt.toUTCString()}`,
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export function clearStakeholderSessionCookieHeader(): string {
  return `${STAKEHOLDER_SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export { clientIp };

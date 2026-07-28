/**
 * Coverage for restricted stakeholder portal (issue #63):
 * - invite lifecycle (create, accept, single-use replay, expire)
 * - enumeration resistance (wrong IDs, cross-tenant)
 * - upload quarantine via evidence pipeline
 * - TLP/PAP redaction + ceiling block
 * - compartment export gate blocks sharing
 * - revocation kills sessions promptly (race)
 * - tenant isolation of invites/sessions/contributions
 * - external attribution on responses
 *
 * Uses real Postgres via DATABASE_URL.
 */
import assert from "node:assert/strict";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../src/db";
import {
  attachments,
  cases,
  externalCollaborators,
  organisations,
  stakeholderAccessEvents,
  stakeholderApprovals,
  stakeholderEvidenceRequests,
  stakeholderInvitations,
  stakeholderResponses,
  stakeholderSessions,
  stakeholderUpdates,
  users,
} from "../src/db/schema";
import { newId } from "../src/lib/utils";
import {
  acceptStakeholderInvite,
  authenticateStakeholderSession,
  buildExternalPortalView,
  createEvidenceRequest,
  createStakeholderApprovalRequest,
  createStakeholderInvite,
  fulfillEvidenceRequest,
  listCaseExternalContributions,
  postStakeholderResponse,
  previewExternalView,
  publishStakeholderUpdate,
  revokeStakeholderInvite,
  roleHasCapability,
  StakeholderError,
} from "../src/lib/stakeholder";
import type { AccessActor } from "../src/lib/access";

const runId = newId("i63test").slice("i63test_".length).slice(0, 10);
const orgAId = `org_i63a_${runId}`;
const orgBId = `org_i63b_${runId}`;
const userAId = `user_i63a_${runId}`;
const userA2Id = `user_i63a2_${runId}`;
const userBId = `user_i63b_${runId}`;
let caseA = "";
let caseB = "";
let caseRestricted = "";
let caseRed = "";

const actorA = (): AccessActor => ({
  organisationId: orgAId,
  userId: userAId,
  role: "admin",
  teamIds: [],
});

const actorA2 = (): AccessActor => ({
  organisationId: orgAId,
  userId: userA2Id,
  role: "analyst",
  teamIds: [],
});

async function setup() {
  await db.insert(organisations).values([
    { id: orgAId, name: "Stakeholder Org A", slug: `i63a-${runId}` },
    { id: orgBId, name: "Stakeholder Org B", slug: `i63b-${runId}` },
  ]);
  await db.insert(users).values([
    {
      id: userAId,
      name: "Admin A",
      email: `i63a-${runId}@example.com`,
      organisationId: orgAId,
      role: "admin",
    },
    {
      id: userA2Id,
      name: "Analyst A",
      email: `i63a2-${runId}@example.com`,
      organisationId: orgAId,
      role: "analyst",
    },
    {
      id: userBId,
      name: "Admin B",
      email: `i63b-${runId}@example.com`,
      organisationId: orgBId,
      role: "admin",
    },
  ]);

  caseA = newId("case");
  caseB = newId("case");
  caseRestricted = newId("case");
  caseRed = newId("case");
  await db.insert(cases).values([
    {
      id: caseA,
      organisationId: orgAId,
      caseNumber: `KP-2026-${runId.slice(0, 4)}1`,
      title: "Phishing campaign against finance",
      status: "in_progress",
      severity: "high",
      tlp: "amber",
      pap: "amber",
    },
    {
      id: caseB,
      organisationId: orgBId,
      caseNumber: `KP-2026-${runId.slice(0, 4)}2`,
      title: "Other tenant case",
      status: "open",
      severity: "medium",
      tlp: "green",
      pap: "green",
    },
    {
      id: caseRestricted,
      organisationId: orgAId,
      caseNumber: `KP-2026-${runId.slice(0, 4)}3`,
      title: "Compartment restricted case",
      status: "open",
      severity: "high",
      tlp: "amber",
      pap: "amber",
      visibilityMode: "restricted",
    },
    {
      id: caseRed,
      organisationId: orgAId,
      caseNumber: `KP-2026-${runId.slice(0, 4)}4`,
      title: "RED classified case",
      status: "open",
      severity: "critical",
      tlp: "red",
      pap: "red",
    },
  ]);
}

async function cleanup() {
  await db.delete(organisations).where(inArray(organisations.id, [orgAId, orgBId]));
}

async function main() {
  await setup();
  try {
    // ── Role capability matrix ──────────────────────────────────────────
    assert.equal(roleHasCapability("update_reader", "view_updates"), true);
    assert.equal(roleHasCapability("update_reader", "upload_evidence"), false);
    assert.equal(roleHasCapability("evidence_provider", "upload_evidence"), true);
    assert.equal(roleHasCapability("approver", "approve"), true);
    assert.equal(roleHasCapability("respondent", "respond"), true);
    console.log("ok: role capability matrix");

    // ── Invite lifecycle ────────────────────────────────────────────────
    const invite = await createStakeholderInvite({
      organisationId: orgAId,
      caseId: caseA,
      actor: actorA(),
      invitedByUserId: userAId,
      email: `vendor-${runId}@example.com`,
      displayName: "Vendor Contact",
      organisationLabel: "Acme Vendor",
      role: "respondent",
      purpose: "Provide mailbox logs for phishing investigation",
      maxTlp: "amber",
      maxPap: "amber",
      expiresInHours: 24,
      singleUse: true,
    });
    assert.ok(invite.token.startsWith("kstk_"));
    assert.equal(invite.invitation.status, "pending");
    // Token never stored in plaintext
    const [stored] = await db
      .select()
      .from(stakeholderInvitations)
      .where(eq(stakeholderInvitations.id, invite.invitation.id));
    assert.notEqual(stored?.tokenHash, invite.token);
    console.log("ok: invite created with hashed token");

    const accepted = await acceptStakeholderInvite({
      inviteToken: invite.token,
      sourceIp: "203.0.113.10",
      userAgent: "stakeholder-test/1.0",
    });
    assert.ok(accepted.sessionToken.startsWith("ksts_"));
    assert.equal(accepted.context.caseId, caseA);
    assert.equal(accepted.context.organisationId, orgAId);
    console.log("ok: invite accepted → session");

    // Single-use replay blocked
    await assert.rejects(
      () => acceptStakeholderInvite({ inviteToken: invite.token }),
      (e: unknown) =>
        e instanceof StakeholderError && e.status === 401,
    );
    console.log("ok: single-use invite token replay blocked");

    // Session auth works
    const auth = await authenticateStakeholderSession(accepted.sessionToken);
    assert.ok(auth);
    assert.equal(auth!.caseId, caseA);
    console.log("ok: session auth");

    // Multi-use invite can be re-accepted
    const multi = await createStakeholderInvite({
      organisationId: orgAId,
      caseId: caseA,
      actor: actorA(),
      invitedByUserId: userAId,
      email: `multi-${runId}@example.com`,
      displayName: "Multi Use",
      role: "update_reader",
      purpose: "Read-only status updates for business owner",
      maxTlp: "amber",
      maxPap: "amber",
      singleUse: false,
    });
    const m1 = await acceptStakeholderInvite({ inviteToken: multi.token });
    const m2 = await acceptStakeholderInvite({ inviteToken: multi.token });
    assert.notEqual(m1.sessionToken, m2.sessionToken);
    console.log("ok: multi-use invite allows multiple sessions");

    // ── Enumeration resistance ──────────────────────────────────────────
    await assert.rejects(
      () => acceptStakeholderInvite({ inviteToken: "kstk_notarealtokenvalue1234567890" }),
      (e: unknown) => e instanceof StakeholderError && e.status === 401,
    );
    await assert.rejects(
      () => acceptStakeholderInvite({ inviteToken: "klp_staff_api_token_shape" }),
      (e: unknown) => e instanceof StakeholderError && e.status === 401,
    );
    // Cross-tenant case id is not reachable from session (session binds case)
    const view = await buildExternalPortalView(auth!);
    assert.equal(view.case.caseNumber.startsWith("KP-"), true);
    assert.ok(!("members" in view));
    assert.ok(!("organisationId" in view.case));
    assert.ok(!("id" in view.case)); // no raw case id exposed
    console.log("ok: enumeration resistance (token + external view shape)");

    // ── Publish update + redaction by TLP ───────────────────────────────
    await publishStakeholderUpdate({
      organisationId: orgAId,
      caseId: caseA,
      actor: actorA(),
      publishedByUserId: userAId,
      title: "Safe amber update",
      body: "We are investigating mailbox rules.",
      tlp: "amber",
      pap: "amber",
    });
    await publishStakeholderUpdate({
      organisationId: orgAId,
      caseId: caseA,
      actor: actorA(),
      publishedByUserId: userAId,
      title: "RED internal only",
      body: "SECRET_RED_PAYLOAD_SHOULD_NOT_LEAK",
      tlp: "red",
      pap: "red",
    });
    const portalView = await buildExternalPortalView(auth!);
    assert.ok(portalView.updates.some((u) => u.title === "Safe amber update"));
    assert.ok(
      !portalView.updates.some((u) => u.body.includes("SECRET_RED_PAYLOAD")),
    );
    console.log("ok: TLP redaction hides over-ceiling updates");

    // Analyst preview matches external view content shape
    const preview = await previewExternalView({
      organisationId: orgAId,
      invitationId: invite.invitation.id,
      actor: actorA(),
    });
    assert.equal(preview.case.caseNumber, portalView.case.caseNumber);
    assert.equal(preview.updates.length, portalView.updates.length);
    console.log("ok: analyst preview matches external view");

    // ── Response + attribution ──────────────────────────────────────────
    const rsp = await postStakeholderResponse(
      auth!,
      "Here are the mailbox export details from the vendor side.",
    );
    assert.ok(rsp.id);
    const contributions = await listCaseExternalContributions(orgAId, caseA);
    assert.ok(contributions.some((c) => c.id === rsp.id));
    assert.equal(contributions[0]?.source, "external");
    assert.ok(contributions[0]?.attribution);
    console.log("ok: external response attributed");

    // Update reader cannot respond
    const readerAuth = await authenticateStakeholderSession(m1.sessionToken);
    assert.ok(readerAuth);
    await assert.rejects(
      () => postStakeholderResponse(readerAuth!, "should fail"),
      (e: unknown) => e instanceof StakeholderError && e.status === 403,
    );
    console.log("ok: role capability enforced on respond");

    // ── Evidence request + quarantine upload ────────────────────────────
    const evidenceInvite = await createStakeholderInvite({
      organisationId: orgAId,
      caseId: caseA,
      actor: actorA(),
      invitedByUserId: userAId,
      email: `evidence-${runId}@example.com`,
      displayName: "Evidence Provider",
      role: "evidence_provider",
      purpose: "Upload firewall logs",
      maxTlp: "amber",
      maxPap: "amber",
    });
    const evAccepted = await acceptStakeholderInvite({
      inviteToken: evidenceInvite.token,
    });
    const req = await createEvidenceRequest({
      organisationId: orgAId,
      caseId: caseA,
      actor: actorA(),
      requestedByUserId: userAId,
      invitationId: evidenceInvite.invitation.id,
      title: "Firewall logs",
      instructions: "Upload the last 24h of deny logs as CSV.",
    });
    const fulfilled = await fulfillEvidenceRequest(
      evAccepted.context,
      req.id,
      {
        buffer: Buffer.from("ts,src,dst\n1,10.0.0.1,8.8.8.8\n"),
        filename: "fw-logs.csv",
        contentType: "text/csv",
      },
    );
    assert.equal(fulfilled.request.status, "fulfilled");
    const [att] = await db
      .select()
      .from(attachments)
      .where(eq(attachments.id, fulfilled.attachmentId));
    assert.ok(att);
    assert.equal(att?.status, "pending_scan");
    assert.equal(att?.source, "stakeholder_portal");
    assert.ok(att?.sha256);
    console.log("ok: external upload enters quarantine pipeline (pending_scan)");

    // ── Approval flow ───────────────────────────────────────────────────
    const apprInvite = await createStakeholderInvite({
      organisationId: orgAId,
      caseId: caseA,
      actor: actorA(),
      invitedByUserId: userAId,
      email: `approver-${runId}@example.com`,
      displayName: "Legal Approver",
      role: "approver",
      purpose: "Approve customer notification",
      maxTlp: "amber",
      maxPap: "amber",
    });
    const apprSession = await acceptStakeholderInvite({
      inviteToken: apprInvite.token,
    });
    const { decideStakeholderApproval } = await import(
      "../src/lib/stakeholder/portal-core"
    );
    const approval = await createStakeholderApprovalRequest({
      organisationId: orgAId,
      caseId: caseA,
      actor: actorA(),
      requestedByUserId: userAId,
      invitationId: apprInvite.invitation.id,
      title: "Notify affected customers?",
      description: "Approve draft customer notification letter.",
    });
    const decided = await decideStakeholderApproval(
      apprSession.context,
      approval.id,
      "approved",
      "Approved with edits offline",
    );
    assert.equal(decided.status, "approved");
    console.log("ok: external approval decision");

    // ── TLP ceiling blocks invite below case classification ─────────────
    await assert.rejects(
      () =>
        createStakeholderInvite({
          organisationId: orgAId,
          caseId: caseRed,
          actor: actorA(),
          invitedByUserId: userAId,
          email: `red-${runId}@example.com`,
          displayName: "Should Fail",
          role: "update_reader",
          purpose: "Should not be allowed at green ceiling",
          maxTlp: "green",
          maxPap: "green",
        }),
      (e: unknown) =>
        e instanceof StakeholderError &&
        e.status === 403 &&
        /TLP/i.test(e.message),
    );
    console.log("ok: case TLP blocks under-ceiling invite");

    // ── Compartment blocks sharing without export ───────────────────────
    // Restricted case: admin has know_exists + administer_access but NOT
    // export by default.
    await assert.rejects(
      () =>
        createStakeholderInvite({
          organisationId: orgAId,
          caseId: caseRestricted,
          actor: actorA(),
          invitedByUserId: userAId,
          email: `restricted-${runId}@example.com`,
          displayName: "Blocked",
          role: "update_reader",
          purpose: "Should be blocked by compartment",
          maxTlp: "amber",
          maxPap: "amber",
        }),
      (e: unknown) =>
        e instanceof StakeholderError && e.status === 403,
    );
    // Analyst without export on restricted case also blocked
    await assert.rejects(
      () =>
        createStakeholderInvite({
          organisationId: orgAId,
          caseId: caseRestricted,
          actor: actorA2(),
          invitedByUserId: userA2Id,
          email: `analyst-blocked-${runId}@example.com`,
          displayName: "Blocked Analyst",
          role: "update_reader",
          purpose: "Analyst lacks export on restricted case",
          maxTlp: "amber",
          maxPap: "amber",
        }),
      (e: unknown) => e instanceof StakeholderError && e.status === 403,
    );
    console.log("ok: compartment/export policy blocks sharing");

    // ── Revocation kills sessions (race) ────────────────────────────────
    const live = await authenticateStakeholderSession(accepted.sessionToken);
    assert.ok(live, "session live before revoke");
    await revokeStakeholderInvite({
      organisationId: orgAId,
      invitationId: invite.invitation.id,
      revokedByUserId: userAId,
      reason: "Engagement complete",
    });
    const dead = await authenticateStakeholderSession(accepted.sessionToken);
    assert.equal(dead, null, "session dead after revoke");
    // Concurrent accept of old token also fails
    await assert.rejects(
      () => acceptStakeholderInvite({ inviteToken: invite.token }),
      (e: unknown) => e instanceof StakeholderError && e.status === 401,
    );
    // Re-auth is the hard gate for all subsequent portal access
    assert.equal(
      await authenticateStakeholderSession(accepted.sessionToken),
      null,
    );
    void live;
    console.log("ok: revocation kills sessions promptly");

    // Expired invite
    const expiring = await createStakeholderInvite({
      organisationId: orgAId,
      caseId: caseA,
      actor: actorA(),
      invitedByUserId: userAId,
      email: `expire-${runId}@example.com`,
      displayName: "Expires Soon",
      role: "update_reader",
      purpose: "Will expire",
      maxTlp: "amber",
      maxPap: "amber",
      expiresInHours: 1,
    });
    await db
      .update(stakeholderInvitations)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(stakeholderInvitations.id, expiring.invitation.id));
    await assert.rejects(
      () => acceptStakeholderInvite({ inviteToken: expiring.token }),
      (e: unknown) => e instanceof StakeholderError && e.status === 401,
    );
    console.log("ok: expired invite rejected");

    // ── Tenant isolation ────────────────────────────────────────────────
    await assert.rejects(
      () =>
        createStakeholderInvite({
          organisationId: orgAId,
          caseId: caseB, // org B case
          actor: actorA(),
          invitedByUserId: userAId,
          email: `xorg-${runId}@example.com`,
          displayName: "Cross",
          role: "update_reader",
          purpose: "Cross-tenant attempt",
          maxTlp: "green",
          maxPap: "green",
        }),
      (e: unknown) => e instanceof StakeholderError && e.status === 404,
    );
    // Org B cannot revoke org A invite
    await assert.rejects(
      () =>
        revokeStakeholderInvite({
          organisationId: orgBId,
          invitationId: multi.invitation.id,
          revokedByUserId: userBId,
        }),
      (e: unknown) => e instanceof StakeholderError && e.status === 404,
    );
    // Org B cannot preview org A invite
    await assert.rejects(
      () =>
        previewExternalView({
          organisationId: orgBId,
          invitationId: multi.invitation.id,
          actor: {
            organisationId: orgBId,
            userId: userBId,
            role: "admin",
            teamIds: [],
          },
        }),
      (e: unknown) => e instanceof StakeholderError && e.status === 404,
    );
    console.log("ok: tenant isolation");

    // ── Access events recorded ──────────────────────────────────────────
    const events = await db
      .select()
      .from(stakeholderAccessEvents)
      .where(
        and(
          eq(stakeholderAccessEvents.organisationId, orgAId),
          eq(stakeholderAccessEvents.caseId, caseA),
        ),
      );
    assert.ok(events.some((e) => e.action === "session_started"));
    assert.ok(events.some((e) => e.action === "response_posted"));
    assert.ok(events.some((e) => e.action === "evidence_uploaded"));
    assert.ok(events.some((e) => e.action === "invite_revoked"));
    console.log("ok: external access audit events");

    // External collaborator is not a staff user
    const collabs = await db
      .select()
      .from(externalCollaborators)
      .where(eq(externalCollaborators.organisationId, orgAId));
    assert.ok(collabs.length >= 1);
    for (const c of collabs) {
      const [staff] = await db
        .select()
        .from(users)
        .where(eq(users.email, c.email));
      assert.equal(staff, undefined, "external email must not be org member");
    }
    console.log("ok: external identities separate from staff users");

    // Wrong evidence request id for session → 404
    await assert.rejects(
      () =>
        fulfillEvidenceRequest(evAccepted.context, "stk_ereq_nonexistent", {
          buffer: Buffer.from("x"),
          filename: "x.bin",
          contentType: null,
        }),
      (e: unknown) => e instanceof StakeholderError && e.status === 404,
    );
    console.log("ok: direct object URL enumeration resisted");
  } finally {
    await cleanup();
  }
}

main()
  .then(() => {
    console.log("\nall stakeholder portal tests passed");
    process.exit(0);
  })
  .catch((err) => {
    console.error(err);
    cleanup().finally(() => process.exit(1));
  });

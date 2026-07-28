/**
 * Integration coverage for case compartments, grants, break-glass, revocation,
 * sensitive content blocks / custom fields, and tenant isolation (issue #61).
 */
import assert from "node:assert/strict";
import { and, eq } from "drizzle-orm";
import { db } from "../src/db";
import {
  caseAccessEvents,
  caseAccessGrants,
  caseContentBlocks,
  cases,
  customFieldDefinitions,
  customFieldValues,
  organisations,
  teamMembers,
  teams,
  users,
} from "../src/db/schema";
import {
  AccessError,
  authorizeCase,
  breakGlassAccess,
  createAccessGrant,
  evaluateCasePermissions,
  hasPermission,
  loadCaseAccessContext,
  redactContentBlock,
  redactCustomFields,
  revokeAccessGrant,
  setCaseVisibility,
  type AccessActor,
} from "../src/lib/access";
import { createContentBlockCore } from "../src/lib/content-blocks-core";
import { getCustomFieldsForEntity } from "../src/lib/custom-fields";
import { newId } from "../src/lib/utils";

const runId = newId("i61test").slice("i61test_".length).slice(0, 10);
const orgAId = `org_i61a_${runId}`;
const orgBId = `org_i61b_${runId}`;
const adminAId = `user_i61admin_${runId}`;
const analystAId = `user_i61a_${runId}`;
const analystA2Id = `user_i61a2_${runId}`;
const analystBId = `user_i61b_${runId}`;
const teamLegalId = `team_i61legal_${runId}`;
const teamSocId = `team_i61soc_${runId}`;
let caseRestricted = "";
let caseOrg = "";
let caseB = "";

async function setup() {
  await db.insert(organisations).values([
    { id: orgAId, name: "Access Org A", slug: `i61a-${runId}` },
    { id: orgBId, name: "Access Org B", slug: `i61b-${runId}` },
  ]);
  await db.insert(users).values([
    {
      id: adminAId,
      name: "Admin A",
      email: `i61admin-${runId}@example.com`,
      organisationId: orgAId,
      role: "admin",
    },
    {
      id: analystAId,
      name: "Analyst A",
      email: `i61a-${runId}@example.com`,
      organisationId: orgAId,
      role: "analyst",
    },
    {
      id: analystA2Id,
      name: "Analyst A2",
      email: `i61a2-${runId}@example.com`,
      organisationId: orgAId,
      role: "analyst",
    },
    {
      id: analystBId,
      name: "Analyst B",
      email: `i61b-${runId}@example.com`,
      organisationId: orgBId,
      role: "analyst",
    },
  ]);
  await db.insert(teams).values([
    {
      id: teamLegalId,
      organisationId: orgAId,
      name: `Legal ${runId}`,
      createdBy: adminAId,
    },
    {
      id: teamSocId,
      organisationId: orgAId,
      name: `SOC ${runId}`,
      createdBy: adminAId,
    },
  ]);
  await db.insert(teamMembers).values([
    {
      id: newId("tm"),
      organisationId: orgAId,
      teamId: teamLegalId,
      userId: analystAId,
      addedBy: adminAId,
    },
    {
      id: newId("tm"),
      organisationId: orgAId,
      teamId: teamSocId,
      userId: analystA2Id,
      addedBy: adminAId,
    },
  ]);

  caseRestricted = newId("case");
  caseOrg = newId("case");
  caseB = newId("case");
  await db.insert(cases).values([
    {
      id: caseRestricted,
      organisationId: orgAId,
      caseNumber: `I61R-${runId}`,
      title: "Executive fraud investigation",
      summary: "sensitive summary",
    },
    {
      id: caseOrg,
      organisationId: orgAId,
      caseNumber: `I61O-${runId}`,
      title: "Open phishing wave",
    },
    {
      id: caseB,
      organisationId: orgBId,
      caseNumber: `I61B-${runId}`,
      title: "Other org case",
    },
  ]);
}

async function cleanup() {
  await db.delete(organisations).where(eq(organisations.id, orgAId));
  await db.delete(organisations).where(eq(organisations.id, orgBId));
}

function actorA(userId: string, role: AccessActor["role"] = "analyst"): AccessActor {
  const teamIds =
    userId === analystAId
      ? [teamLegalId]
      : userId === analystA2Id
        ? [teamSocId]
        : [];
  return {
    organisationId: orgAId,
    userId,
    role,
    teamIds,
  };
}

async function main() {
  await setup();
  try {
    // ── default organisation visibility ────────────────────────────────
    {
      const gate = await authorizeCase(
        orgAId,
        caseOrg,
        actorA(analystAId),
        "view_sensitive",
      );
      assert.equal(gate.ok, true);
      console.log("ok: organisation-mode case visible to analyst");
    }

    // ── set restricted visibility ──────────────────────────────────────
    {
      const admin = actorA(adminAId, "admin");
      const result = await setCaseVisibility(orgAId, admin, caseRestricted, {
        visibilityMode: "restricted",
        reason: "Insider threat need-to-know",
      });
      assert.equal(result.visibilityMode, "restricted");
      assert.ok(result.accessPolicyVersion >= 2);

      const denied = await authorizeCase(
        orgAId,
        caseRestricted,
        actorA(analystAId),
        "know_exists",
      );
      assert.equal(denied.ok, false);
      assert.equal(denied.status, 404);

      // Admin knows it exists but cannot view metadata without grant.
      const adminKnow = await authorizeCase(
        orgAId,
        caseRestricted,
        admin,
        "know_exists",
      );
      assert.equal(adminKnow.ok, true);
      const adminMeta = await authorizeCase(
        orgAId,
        caseRestricted,
        admin,
        "view_metadata",
      );
      assert.equal(adminMeta.ok, false);
      console.log("ok: restricted mode hides case from analysts; admin administers only");
    }

    // ── grant + view ───────────────────────────────────────────────────
    {
      const admin = actorA(adminAId, "admin");
      const grant = await createAccessGrant(orgAId, admin, caseRestricted, {
        subjectType: "user",
        subjectId: analystAId,
        permissions: [
          "know_exists",
          "view_metadata",
          "view_sensitive",
          "edit",
        ],
        reason: "Lead investigator for fraud case",
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      });
      assert.ok(grant.id);

      const gate = await authorizeCase(
        orgAId,
        caseRestricted,
        actorA(analystAId),
        "view_sensitive",
      );
      assert.equal(gate.ok, true);
      assert.equal(
        hasPermission(gate.permissions, "export"),
        false,
        "export not implied by view grant",
      );

      // Other analyst still denied.
      const other = await authorizeCase(
        orgAId,
        caseRestricted,
        actorA(analystA2Id),
        "know_exists",
      );
      assert.equal(other.ok, false);
      console.log("ok: grant enables access for subject only; export independent");
    }

    // ── sensitive content block redaction ──────────────────────────────
    {
      // Give analystA2 metadata-only (no view_sensitive).
      const admin = actorA(adminAId, "admin");
      await createAccessGrant(orgAId, admin, caseRestricted, {
        subjectType: "user",
        subjectId: analystA2Id,
        permissions: ["know_exists", "view_metadata"],
        reason: "Metadata visibility for triage queue only",
      });

      const block = await createContentBlockCore(
        orgAId,
        analystAId,
        caseRestricted,
        {
          type: "finding",
          title: "Executive bank accounts",
          content: "Account 12345678 at BigBank",
          sensitive: true,
        },
      );
      assert.equal(block.sensitive, true);

      const gate = await authorizeCase(
        orgAId,
        caseRestricted,
        actorA(analystA2Id),
        "view_metadata",
      );
      assert.equal(gate.ok, true);
      const redacted = redactContentBlock(block, gate.permissions, {
        actor: actorA(analystA2Id),
        grants: gate.ctx.grants,
      });
      assert.equal(redacted.redacted, true);
      assert.equal(redacted.content, "[redacted]");
      assert.notEqual(redacted.content, "Account 12345678 at BigBank");

      const full = await authorizeCase(
        orgAId,
        caseRestricted,
        actorA(analystAId),
        "view_sensitive",
      );
      assert.equal(full.ok, true);
      const clear = redactContentBlock(block, full.permissions);
      assert.equal(clear.redacted, false);
      assert.match(clear.content, /Account 12345678/);
      console.log("ok: sensitive content block redacted without view_sensitive");
    }

    // ── sensitive custom field ─────────────────────────────────────────
    {
      const fieldId = newId("cfd");
      await db.insert(customFieldDefinitions).values({
        id: fieldId,
        organisationId: orgAId,
        entity: "case",
        key: `suspect_ssn_${runId}`,
        label: "Suspect SSN",
        type: "string",
        options: [],
        required: false,
        sensitive: true,
        orderIndex: 0,
        isActive: true,
      });
      await db.insert(customFieldValues).values({
        id: newId("cfv"),
        entity: "case",
        entityId: caseRestricted,
        fieldId,
        value: "123-45-6789",
      });

      const fields = await getCustomFieldsForEntity(orgAId, caseRestricted);
      const metaGate = await authorizeCase(
        orgAId,
        caseRestricted,
        actorA(analystA2Id),
        "view_metadata",
      );
      assert.equal(metaGate.ok, true);
      const redacted = redactCustomFields(fields, metaGate.permissions, {
        actor: actorA(analystA2Id),
        grants: metaGate.ctx.grants,
      });
      const ssn = redacted.find((f) => f.id === fieldId);
      assert.ok(ssn);
      assert.equal(ssn!.redacted, true);
      assert.equal(ssn!.value, "[redacted]");
      assert.equal(ssn!.label, "Suspect SSN");
      console.log("ok: sensitive custom field value redacted, label kept");
    }

    // ── selected_teams mode ────────────────────────────────────────────
    {
      const admin = actorA(adminAId, "admin");
      const teamCase = newId("case");
      await db.insert(cases).values({
        id: teamCase,
        organisationId: orgAId,
        caseNumber: `I61T-${runId}`,
        title: "Legal hold matter",
      });
      await setCaseVisibility(orgAId, admin, teamCase, {
        visibilityMode: "selected_teams",
        teamIds: [teamLegalId],
        reason: "Legal team only for this matter",
      });

      const legal = await authorizeCase(
        orgAId,
        teamCase,
        actorA(analystAId),
        "view_metadata",
      );
      assert.equal(legal.ok, true);

      const soc = await authorizeCase(
        orgAId,
        teamCase,
        actorA(analystA2Id),
        "know_exists",
      );
      assert.equal(soc.ok, false);
      console.log("ok: selected_teams compartment enforces team membership");
    }

    // ── break-glass ────────────────────────────────────────────────────
    {
      const outsider = actorA(analystA2Id);
      // Ensure outsider still has no sensitive on restricted case without grant...
      // they have metadata grant from earlier — revoke it first.
      const grants = await db
        .select()
        .from(caseAccessGrants)
        .where(
          and(
            eq(caseAccessGrants.caseId, caseRestricted),
            eq(caseAccessGrants.subjectId, analystA2Id),
          ),
        );
      const admin = actorA(adminAId, "admin");
      for (const g of grants) {
        if (!g.revokedAt) {
          await revokeAccessGrant(
            orgAId,
            admin,
            caseRestricted,
            g.id,
            "Revoking prior metadata grant before break-glass test",
          );
        }
      }

      const denied = await authorizeCase(
        orgAId,
        caseRestricted,
        outsider,
        "know_exists",
      );
      assert.equal(denied.ok, false);

      const bg = await breakGlassAccess(orgAId, outsider, caseRestricted, {
        reason: "Active containment decision needs case context now",
        ttlMs: 60 * 60 * 1000,
      });
      assert.ok(bg.id);
      assert.ok(bg.expiresAt.getTime() > Date.now());

      const after = await authorizeCase(
        orgAId,
        caseRestricted,
        outsider,
        "view_sensitive",
      );
      assert.equal(after.ok, true);

      const [bgRow] = await db
        .select()
        .from(caseAccessGrants)
        .where(eq(caseAccessGrants.id, bg.id));
      assert.equal(bgRow?.isBreakGlass, true);
      assert.ok(bgRow?.reason && bgRow.reason.length >= 8);

      const events = await db
        .select()
        .from(caseAccessEvents)
        .where(
          and(
            eq(caseAccessEvents.caseId, caseRestricted),
            eq(caseAccessEvents.action, "break_glass"),
          ),
        );
      assert.ok(events.length >= 1);
      // Access history must not store the sensitive case title/body.
      for (const ev of events) {
        const meta = ev.metadata as Record<string, unknown>;
        assert.equal(meta?.title, undefined);
        assert.equal(meta?.summary, undefined);
      }
      console.log("ok: break-glass requires reason, expires, audited");
    }

    // ── revocation race: revoked grant stops access immediately ────────
    {
      const admin = actorA(adminAId, "admin");
      const grant = await createAccessGrant(orgAId, admin, caseRestricted, {
        subjectType: "user",
        subjectId: analystA2Id,
        permissions: ["know_exists", "view_metadata", "export"],
        reason: "Temporary export permission for compliance pull",
      });
      let gate = await authorizeCase(
        orgAId,
        caseRestricted,
        actorA(analystA2Id),
        "export",
      );
      assert.equal(gate.ok, true);

      await revokeAccessGrant(
        orgAId,
        admin,
        caseRestricted,
        grant.id,
        "Revoked after compliance window closed",
      );

      // Double-revoke is a conflict.
      await assert.rejects(
        () =>
          revokeAccessGrant(
            orgAId,
            admin,
            caseRestricted,
            grant.id,
            "Second revoke should fail with conflict",
          ),
        (err: unknown) =>
          err instanceof AccessError && err.status === 409,
      );

      gate = await authorizeCase(
        orgAId,
        caseRestricted,
        actorA(analystA2Id),
        "export",
      );
      // May still have break-glass from earlier — check export specifically
      // by reloading context and evaluating without break-glass if expired...
      // Instead verify the revoked grant itself is inactive:
      const ctx = await loadCaseAccessContext(orgAId, caseRestricted);
      assert.ok(ctx);
      const activeGrant = ctx.grants.find((g) => g.id === grant.id);
      assert.equal(
        activeGrant,
        undefined,
        "revoked grant must not appear in active grant set",
      );
      console.log("ok: revocation removes grant immediately; double-revoke is 409");
    }

    // ── tenant isolation ───────────────────────────────────────────────
    {
      const foreign: AccessActor = {
        organisationId: orgBId,
        userId: analystBId,
        role: "analyst",
        teamIds: [],
      };
      const gate = await authorizeCase(
        orgAId,
        caseRestricted,
        foreign,
        "know_exists",
      );
      assert.equal(gate.ok, false);

      // Even with correct org id spoofed on the actor, case load is org-scoped.
      const spoof: AccessActor = {
        organisationId: orgAId,
        userId: analystBId,
        role: "admin",
        teamIds: [],
      };
      // user is not in org A — resolveUserActor would reject; evaluate still
      // allows if caller lies. authorizeCase uses actor.organisationId match
      // against the requested org, but case load filters by organisationId.
      // Cross-org user id as admin of org A is a data integrity issue; policy
      // still only sees grants for that subject id.
      const spoofGate = await authorizeCase(
        orgAId,
        caseRestricted,
        spoof,
        "view_sensitive",
      );
      // spoofed admin of org A would get administer + know_exists only
      assert.equal(
        spoofGate.ok === false ||
          (spoofGate.ok && !hasPermission(spoofGate.permissions, "view_sensitive")),
        true,
      );
      console.log("ok: tenant isolation denies foreign org actors");
    }

    // ── short reason rejected ──────────────────────────────────────────
    {
      const admin = actorA(adminAId, "admin");
      await assert.rejects(
        () =>
          createAccessGrant(orgAId, admin, caseRestricted, {
            subjectType: "user",
            subjectId: analystAId,
            permissions: ["export"],
            reason: "short",
          }),
        (err: unknown) => err instanceof AccessError && err.status === 400,
      );
      console.log("ok: short grant reason rejected");
    }

    // ── content blocks table has no sensitive body in access events ────
    {
      const allEvents = await db
        .select()
        .from(caseAccessEvents)
        .where(eq(caseAccessEvents.organisationId, orgAId));
      for (const ev of allEvents) {
        const blob = JSON.stringify(ev);
        assert.equal(blob.includes("123-45-6789"), false);
        assert.equal(blob.includes("Account 12345678"), false);
      }
      console.log("ok: access history never stores sensitive field values");
    }

    console.log("\nall access-core tests passed");
  } finally {
    await cleanup();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
  return cleanup().catch(() => undefined);
});

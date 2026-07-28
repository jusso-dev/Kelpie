/**
 * Unit coverage for pure case-compartment policy evaluation (issue #61).
 * No database required.
 */
import assert from "node:assert/strict";
import {
  accessCacheKey,
  canViewSensitiveObject,
  evaluateCasePermissions,
  hasPermission,
  isInBaseCompartment,
  redactCaseListRow,
  redactSensitiveContent,
  REDACTED_PLACEHOLDER,
  type AccessActor,
  type CaseAccessContext,
} from "../src/lib/access";

function baseCtx(
  overrides: Partial<CaseAccessContext> = {},
): CaseAccessContext {
  return {
    organisationId: "org_a",
    caseId: "case_1",
    visibilityMode: "organisation",
    accessPolicyVersion: 1,
    compartmentTeamIds: [],
    compartmentMemberIds: [],
    grants: [],
    now: new Date("2026-01-15T12:00:00Z"),
    ...overrides,
  };
}

function actor(overrides: Partial<AccessActor> = {}): AccessActor {
  return {
    organisationId: "org_a",
    userId: "user_a",
    role: "analyst",
    teamIds: [],
    ...overrides,
  };
}

// ── organisation mode (default open-within-tenant) ─────────────────────

{
  const ctx = baseCtx();
  const analyst = actor();
  const perms = evaluateCasePermissions(ctx, analyst);
  assert.ok(hasPermission(perms, "know_exists"));
  assert.ok(hasPermission(perms, "view_metadata"));
  assert.ok(hasPermission(perms, "view_sensitive"));
  assert.ok(hasPermission(perms, "edit"));
  assert.ok(hasPermission(perms, "export"));
  assert.equal(hasPermission(perms, "administer_access"), false);
  console.log("ok: organisation mode analyst gets view/edit/export");
}

{
  const ctx = baseCtx();
  const admin = actor({ role: "admin", userId: "admin_a" });
  const perms = evaluateCasePermissions(ctx, admin);
  assert.ok(hasPermission(perms, "administer_access"));
  assert.ok(hasPermission(perms, "view_sensitive"));
  console.log("ok: organisation mode admin administers + views sensitive");
}

{
  const ctx = baseCtx();
  const ro = actor({ role: "read_only", userId: "ro_a" });
  const perms = evaluateCasePermissions(ctx, ro);
  assert.ok(hasPermission(perms, "view_metadata"));
  assert.ok(hasPermission(perms, "view_sensitive"));
  assert.equal(hasPermission(perms, "edit"), false);
  assert.equal(hasPermission(perms, "export"), false);
  console.log("ok: read_only views but cannot edit/export");
}

// ── cross-tenant deny ──────────────────────────────────────────────────

{
  const ctx = baseCtx();
  const foreign = actor({ organisationId: "org_b" });
  const perms = evaluateCasePermissions(ctx, foreign);
  assert.equal(perms.size, 0);
  console.log("ok: cross-tenant actor gets empty permission set");
}

// ── restricted mode ────────────────────────────────────────────────────

{
  const ctx = baseCtx({ visibilityMode: "restricted" });
  const analyst = actor();
  const perms = evaluateCasePermissions(ctx, analyst);
  assert.equal(hasPermission(perms, "know_exists"), false);
  assert.equal(hasPermission(perms, "view_metadata"), false);
  console.log("ok: restricted mode denies base analyst");
}

{
  const ctx = baseCtx({ visibilityMode: "restricted" });
  const admin = actor({ role: "admin", userId: "admin_a" });
  const perms = evaluateCasePermissions(ctx, admin);
  assert.ok(hasPermission(perms, "know_exists"));
  assert.ok(hasPermission(perms, "administer_access"));
  assert.equal(
    hasPermission(perms, "view_metadata"),
    false,
    "admin must not auto-view restricted content",
  );
  assert.equal(hasPermission(perms, "view_sensitive"), false);
  console.log("ok: restricted mode admin can administer without viewing content");
}

// ── selected_teams ─────────────────────────────────────────────────────

{
  const ctx = baseCtx({
    visibilityMode: "selected_teams",
    compartmentTeamIds: ["team_legal"],
  });
  const outsider = actor({ teamIds: ["team_soc"] });
  assert.equal(isInBaseCompartment(ctx, outsider), false);
  assert.equal(
    hasPermission(evaluateCasePermissions(ctx, outsider), "know_exists"),
    false,
  );

  const insider = actor({ teamIds: ["team_legal", "team_soc"] });
  assert.ok(isInBaseCompartment(ctx, insider));
  const perms = evaluateCasePermissions(ctx, insider);
  assert.ok(hasPermission(perms, "view_metadata"));
  assert.equal(
    hasPermission(perms, "view_sensitive"),
    false,
    "compartment members do not auto-get view_sensitive",
  );
  console.log("ok: selected_teams membership gates metadata, not sensitive");
}

// ── explicit_members ───────────────────────────────────────────────────

{
  const ctx = baseCtx({
    visibilityMode: "explicit_members",
    compartmentMemberIds: ["user_a"],
  });
  assert.ok(isInBaseCompartment(ctx, actor()));
  assert.equal(
    isInBaseCompartment(ctx, actor({ userId: "user_b" })),
    false,
  );
  console.log("ok: explicit_members membership check");
}

// ── grants: time-bounded, revoked, object-scoped ──────────────────────

{
  const now = new Date("2026-01-15T12:00:00Z");
  const ctx = baseCtx({
    visibilityMode: "restricted",
    now,
    grants: [
      {
        subjectType: "user",
        subjectId: "user_a",
        permissions: ["know_exists", "view_metadata", "view_sensitive"],
        objectType: "case",
        objectId: null,
        expiresAt: new Date("2026-01-15T16:00:00Z"),
        revokedAt: null,
        isBreakGlass: true,
      },
    ],
  });
  const perms = evaluateCasePermissions(ctx, actor());
  assert.ok(hasPermission(perms, "view_sensitive"));
  console.log("ok: active break-glass grant grants view_sensitive");
}

{
  const now = new Date("2026-01-15T18:00:00Z");
  const ctx = baseCtx({
    visibilityMode: "restricted",
    now,
    grants: [
      {
        subjectType: "user",
        subjectId: "user_a",
        permissions: ["know_exists", "view_metadata", "view_sensitive"],
        objectType: "case",
        objectId: null,
        expiresAt: new Date("2026-01-15T16:00:00Z"),
        revokedAt: null,
        isBreakGlass: true,
      },
    ],
  });
  const perms = evaluateCasePermissions(ctx, actor());
  assert.equal(hasPermission(perms, "view_sensitive"), false);
  console.log("ok: expired grant is ignored");
}

{
  const now = new Date("2026-01-15T12:00:00Z");
  const ctx = baseCtx({
    visibilityMode: "restricted",
    now,
    grants: [
      {
        subjectType: "user",
        subjectId: "user_a",
        permissions: ["know_exists", "view_metadata", "view_sensitive"],
        objectType: "case",
        objectId: null,
        expiresAt: null,
        revokedAt: new Date("2026-01-15T11:00:00Z"),
        isBreakGlass: false,
      },
    ],
  });
  const perms = evaluateCasePermissions(ctx, actor());
  assert.equal(hasPermission(perms, "know_exists"), false);
  console.log("ok: revoked grant is ignored");
}

// ── export independent of view ─────────────────────────────────────────

{
  const ctx = baseCtx({
    visibilityMode: "restricted",
    grants: [
      {
        subjectType: "user",
        subjectId: "user_a",
        permissions: ["know_exists", "view_metadata", "view_sensitive"],
        objectType: "case",
        objectId: null,
        expiresAt: null,
        revokedAt: null,
        isBreakGlass: false,
      },
    ],
  });
  const perms = evaluateCasePermissions(ctx, actor());
  assert.ok(hasPermission(perms, "view_sensitive"));
  assert.equal(
    hasPermission(perms, "export"),
    false,
    "export must not be implied by view",
  );
  console.log("ok: export independent of view permissions");
}

// ── sensitive object redaction ─────────────────────────────────────────

{
  const perms = new Set([
    "view_metadata",
  ] as const) as unknown as Set<
    import("../src/lib/access").AccessPermission
  >;
  assert.equal(
    canViewSensitiveObject(perms, {
      sensitive: false,
      objectType: "content_block",
      objectId: "b1",
      grants: [],
      actor: actor(),
    }),
    true,
  );
  assert.equal(
    canViewSensitiveObject(perms, {
      sensitive: true,
      objectType: "content_block",
      objectId: "b1",
      grants: [],
      actor: actor(),
    }),
    false,
  );
  assert.equal(
    canViewSensitiveObject(perms, {
      sensitive: true,
      objectType: "content_block",
      objectId: "b1",
      grants: [
        {
          subjectType: "user",
          subjectId: "user_a",
          permissions: ["view_sensitive"],
          objectType: "content_block",
          objectId: "b1",
          expiresAt: null,
          revokedAt: null,
          isBreakGlass: false,
        },
      ],
      actor: actor(),
    }),
    true,
  );
  console.log("ok: object-level sensitive grant unlocks single block");
}

{
  const redacted = redactSensitiveContent(
    { content: "secret", title: "ok", contentStructured: { a: 1 } },
    ["content", "contentStructured"],
  );
  assert.equal(redacted.content, REDACTED_PLACEHOLDER);
  assert.equal(redacted.contentStructured, REDACTED_PLACEHOLDER);
  assert.equal(redacted.title, "ok");
  console.log("ok: deterministic sensitive content redaction");
}

{
  const knowOnly = new Set([
    "know_exists",
  ] as const) as unknown as Set<
    import("../src/lib/access").AccessPermission
  >;
  const row = redactCaseListRow(
    { id: "c1", title: "Insider fraud", summary: "details" },
    knowOnly,
  );
  assert.equal(row.title, REDACTED_PLACEHOLDER);
  assert.equal(row.summary, null);
  console.log("ok: list row redacts title without view_metadata");
}

// ── cache key includes org + actor + policy version ────────────────────

{
  const k1 = accessCacheKey({
    organisationId: "org_a",
    actorId: "user_a",
    caseId: "case_1",
    policyVersion: 1,
    permission: "view_sensitive",
  });
  const k2 = accessCacheKey({
    organisationId: "org_a",
    actorId: "user_a",
    caseId: "case_1",
    policyVersion: 2,
    permission: "view_sensitive",
  });
  assert.notEqual(k1, k2);
  assert.match(k1, /org_a:user_a:case_1:v1:view_sensitive/);
  console.log("ok: cache key includes org, actor, policy version");
}

// ── system actors ──────────────────────────────────────────────────────

{
  const ctx = baseCtx({ visibilityMode: "restricted" });
  const system = actor({
    userId: null,
    role: "system",
  });
  assert.equal(evaluateCasePermissions(ctx, system).size, 0);

  const internal = actor({ userId: null, role: "system_internal" });
  const perms = evaluateCasePermissions(ctx, internal);
  assert.ok(hasPermission(perms, "view_sensitive"));
  assert.ok(hasPermission(perms, "export"));
  console.log("ok: system vs system_internal privilege split");
}

// ── assigning does not appear in base compartment (policy purity) ──────

{
  // evaluateCasePermissions has no assignee concept — assignment must not
  // grant access. This documents the invariant used by grants.ts callers.
  const ctx = baseCtx({
    visibilityMode: "restricted",
    compartmentMemberIds: [],
  });
  const assignee = actor({ userId: "assignee_x" });
  assert.equal(isInBaseCompartment(ctx, assignee), false);
  console.log("ok: restricted case grants nothing by identity alone");
}

console.log("\nall access-evaluate tests passed");

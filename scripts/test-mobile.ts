import assert from "node:assert/strict";
import { and, eq } from "drizzle-orm";
import { db } from "../src/db";
import {
  alerts,
  apiTokens,
  cases,
  mobileNotificationDeliveries,
  organisations,
  sessions,
  slaPolicies,
  users,
} from "../src/db/schema";
import { ingestAlert } from "../src/lib/alerts-core";
import { postCommentCore } from "../src/lib/comments-core";
import { issueMobileToken } from "../src/lib/mobile-auth";
import { registerMobileDevice } from "../src/lib/mobile-push";
import { newId } from "../src/lib/utils";
import { hashApiToken } from "../src/lib/api-tokens";
import { PATCH as patchAlert } from "../src/app/api/v1/alerts/[id]/route";
import { POST as runSla } from "../src/app/api/cron/sla/route";
import { POST as mobileSignIn } from "../src/app/api/mobile/auth/sign-in/route";

async function main() {
  const organisationId = newId("org");
  const adminId = newId("user");
  const analystId = newId("user");
  const readerId = newId("user");
  process.env.CRON_SECRET = "mobile-test-cron-secret";

  await db.insert(organisations).values({
    id: organisationId,
    name: "Mobile test SOC",
    slug: `mobile-test-${Date.now()}`,
  });
  await db.insert(users).values([
    {
      id: adminId,
      organisationId,
      name: "Mobile Admin",
      email: `mobile-admin-${Date.now()}@example.test`,
      role: "admin",
    },
    {
      id: analystId,
      organisationId,
      name: "Mobile Analyst",
      email: `mobile.analyst-${Date.now()}@example.test`,
      role: "analyst",
    },
    {
      id: readerId,
      organisationId,
      name: "Mobile Reader",
      email: `mobile-reader-${Date.now()}@example.test`,
      role: "read_only",
    },
  ]);

  try {
    await Promise.all([
      registerMobileDevice({
        organisationId,
        userId: adminId,
        token: "a".repeat(64),
        environment: "sandbox",
        bundleId: "dev.kelpie.mobile",
      }),
      registerMobileDevice({
        organisationId,
        userId: analystId,
        token: "b".repeat(64),
        environment: "sandbox",
        bundleId: "dev.kelpie.mobile",
      }),
      registerMobileDevice({
        organisationId,
        userId: readerId,
        token: "c".repeat(64),
        environment: "sandbox",
        bundleId: "dev.kelpie.mobile",
      }),
    ]);

    const critical = await ingestAlert(organisationId, {
      source: "mobile-test",
      externalRef: newId("critical"),
      title: "Critical mobile routing test",
      severity: "critical",
    });
    assert.equal(critical.created, true);
    const criticalPushes = await db
      .select()
      .from(mobileNotificationDeliveries)
      .where(eq(mobileNotificationDeliveries.event, "critical_alert"));
    const routedCritical = criticalPushes.filter(
      (delivery) => delivery.destinationId === critical.alert.id,
    );
    assert.deepEqual(
      new Set(routedCritical.map((delivery) => delivery.userId)),
      new Set([adminId, analystId]),
      "critical alerts route to mobile analysts, never read-only users",
    );

    const { token: analystToken } = await issueMobileToken(analystId);
    const acknowledgeResponse = await patchAlert(
      new Request(`http://localhost/api/v1/alerts/${critical.alert.id}`, {
        method: "PATCH",
        headers: {
          authorization: `Bearer ${analystToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ action: "acknowledge" }),
      }),
      { params: Promise.resolve({ id: critical.alert.id }) },
    );
    assert.equal(acknowledgeResponse.status, 200);
    const acknowledgeBody = (await acknowledgeResponse.json()) as { status: string };
    assert.equal(acknowledgeBody.status, "triaged");

    const caseId = newId("case");
    await db.insert(cases).values({
      id: caseId,
      organisationId,
      caseNumber: "MOBILE-0001",
      title: "Mention and SLA mobile test",
      severity: "critical",
      assigneeId: analystId,
      openedAt: new Date(Date.now() - 10 * 60_000),
    });
    await db.insert(slaPolicies).values({
      id: newId("sla"),
      organisationId,
      name: "Mobile test critical",
      severity: "critical",
      timeToAcknowledgeMinutes: 1,
      timeToContainMinutes: 2,
      timeToResolveMinutes: 3,
    });
    const analyst = await db
      .select({ id: users.id, name: users.name, email: users.email })
      .from(users)
      .where(eq(users.id, analystId))
      .then((rows) => rows[0]);
    assert.ok(analyst);
    const mentionHandle = analyst.email.split("@")[0];
    const comment = await postCommentCore(
      organisationId,
      { id: adminId, name: "Mobile Admin" },
      caseId,
      `Please review this from mobile @${mentionHandle}`,
    );
    assert.deepEqual(comment.mentionedUserIds, [analystId]);

    const slaResponse = await runSla(
      new Request("http://localhost/api/cron/sla", {
        method: "POST",
        headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
      }),
    );
    assert.equal(slaResponse.status, 200);

    const casePushes = await db
      .select({ event: mobileNotificationDeliveries.event, userId: mobileNotificationDeliveries.userId })
      .from(mobileNotificationDeliveries)
      .where(eq(mobileNotificationDeliveries.destinationId, caseId));
    assert.ok(casePushes.some((delivery) => delivery.event === "comment_mention" && delivery.userId === analystId));
    assert.ok(casePushes.some((delivery) => delivery.event === "sla_breach" && delivery.userId === analystId));

    const readerSession = await issueMobileToken(readerId);
    const [readerToken] = await db
      .select({ scopes: apiTokens.scopes })
      .from(apiTokens)
      .where(and(eq(apiTokens.createdBy, readerId), eq(apiTokens.organisationId, organisationId)))
      .limit(1);
    assert.ok(readerToken);
    assert.deepEqual(readerToken.scopes, [
      "alerts:read",
      "cases:read",
      "tasks:read",
      "observables:read",
      "comments:read",
    ]);
    assert.ok(readerSession.token.startsWith("klp_"));

    const browserSessionsBefore = await db.select({ id: sessions.id }).from(sessions);
    const signInResponse = await mobileSignIn(
      new Request("http://localhost/api/mobile/auth/sign-in", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: "admin@acme.local",
          password: "kelpieadmin",
        }),
      }),
    );
    assert.equal(signInResponse.status, 200, "mobile sign-in uses the existing BetterAuth account");
    const signInBody = (await signInResponse.json()) as { token?: string; scopes?: string[] };
    assert.ok(signInBody.token?.startsWith("klp_"));
    assert.ok(signInBody.scopes?.includes("alerts:write"));
    const browserSessionsAfter = await db.select({ id: sessions.id }).from(sessions);
    assert.equal(
      browserSessionsAfter.length,
      browserSessionsBefore.length,
      "mobile sign-in does not leave an unbound browser session",
    );
    await db
      .delete(apiTokens)
      .where(eq(apiTokens.tokenHash, hashApiToken(signInBody.token!)));
    console.log("Mobile sign-in, least privilege, alert triage, and all three push routes passed.");
  } finally {
    await db.delete(organisations).where(eq(organisations.id, organisationId));
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

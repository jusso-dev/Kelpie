/**
 * Seed Kelpie with an organisation, an admin user, a playbook, a couple of
 * alerts, and one promoted case so the UI has something to herd.
 *
 * Re-running this script is idempotent: it only inserts when nothing exists
 * for the chosen organisation slug.
 */

import { db } from "../src/db";
import {
  accounts,
  alerts,
  caseTasks,
  cases,
  observables,
  organisations,
  playbookRuns,
  playbooks,
  timelineEvents,
  users,
} from "../src/db/schema";
import { eq } from "drizzle-orm";
import { newId } from "../src/lib/utils";
import { auth } from "../src/lib/auth";
import { nextCaseNumber } from "../src/lib/case-number";

const ORG_SLUG = "acme-soc";

async function main() {
  const existing = await db
    .select()
    .from(organisations)
    .where(eq(organisations.slug, ORG_SLUG))
    .limit(1);
  if (existing.length > 0) {
    console.log(`Organisation "${ORG_SLUG}" already exists. Skipping seed.`);
    return;
  }

  const orgId = newId("org");
  await db.insert(organisations).values({
    id: orgId,
    name: "Acme SOC",
    slug: ORG_SLUG,
  });

  // Create admin user via BetterAuth so the password is hashed correctly.
  const signUp = await auth.api.signUpEmail({
    body: {
      email: "admin@acme.local",
      password: "kelpieadmin",
      name: "Admin Drover",
    },
  });
  const userId = signUp.user.id;
  await db
    .update(users)
    .set({ organisationId: orgId, role: "admin" })
    .where(eq(users.id, userId));

  // Create an analyst alongside the admin.
  const analystSignUp = await auth.api.signUpEmail({
    body: {
      email: "analyst@acme.local",
      password: "kelpieanalyst",
      name: "Sam Analyst",
    },
  });
  await db
    .update(users)
    .set({ organisationId: orgId, role: "analyst" })
    .where(eq(users.id, analystSignUp.user.id));

  // A standard phishing playbook.
  const pbId = newId("pb");
  await db.insert(playbooks).values({
    id: pbId,
    organisationId: orgId,
    name: "Phishing first response",
    description: "Initial containment and notification for reported phishing.",
    classification: "phishing",
    isActive: true,
    steps: [
      {
        id: newId("step"),
        title: "Acknowledge and confirm scope",
        description: "Identify recipients and confirm the message is malicious.",
        offsetMinutes: 15,
        isRequired: true,
      },
      {
        id: newId("step"),
        title: "Block sender and URLs",
        description: "Push block rules into mail and web proxy.",
        offsetMinutes: 60,
        isRequired: true,
      },
      {
        id: newId("step"),
        title: "Notify affected users",
        description: "Email the recipients with guidance.",
        offsetMinutes: 180,
        isRequired: true,
      },
      {
        id: newId("step"),
        title: "Hunt for clicks and credential reuse",
        description: "Search auth logs for sign-ins from new IPs after delivery.",
        offsetMinutes: 360,
        isRequired: false,
      },
    ],
  });

  // Two open alerts and one already promoted.
  const a1 = newId("alert");
  const a2 = newId("alert");
  const a3 = newId("alert");
  await db.insert(alerts).values([
    {
      id: a1,
      organisationId: orgId,
      source: "siem-splunk",
      externalRef: "splunk-1001",
      title: "Possible brute force against VPN gateway",
      description: "Many failed auths from 203.0.113.4 against vpn.acme.local",
      severity: "high",
      status: "new",
      observables: [
        { type: "ip", value: "203.0.113.4" },
        { type: "hostname", value: "vpn.acme.local" },
      ],
      rawPayload: { count: 412, window_minutes: 5 },
    },
    {
      id: a2,
      organisationId: orgId,
      source: "email-report",
      externalRef: "report-44",
      title: "Reported phishing: invoice from unknown sender",
      description: "Finance reported a suspicious invoice email",
      severity: "medium",
      status: "new",
      observables: [
        { type: "email", value: "billing@acm3.co" },
        { type: "url", value: "https://acm3.co/login" },
      ],
      rawPayload: { reporter: "j.kim@acme.local" },
    },
    {
      id: a3,
      organisationId: orgId,
      source: "edr-crowdstrike",
      externalRef: "cs-9091",
      title: "Suspicious PowerShell execution on workstation",
      severity: "medium",
      status: "new",
      observables: [
        { type: "hostname", value: "WIN-01-FIN" },
        { type: "file_hash", value: "d41d8cd98f00b204e9800998ecf8427e" },
      ],
      rawPayload: { detection: "powershell_encoded_command" },
    },
  ]);

  // One case demonstrating the lifecycle.
  const caseId = newId("case");
  const caseNumber = await nextCaseNumber(orgId);
  await db.insert(cases).values({
    id: caseId,
    organisationId: orgId,
    caseNumber,
    title: "Phishing wave against finance team",
    summary:
      "Multiple finance users received a near-identical lure with a fake DocuSign link. Two clicked and one entered credentials before reporting.",
    severity: "high",
    status: "contained",
    tlp: "amber",
    pap: "amber",
    classification: "phishing",
    assigneeId: userId,
    reporterId: userId,
    mitreTechniques: ["T1566.002", "T1078"],
    acknowledgedAt: new Date(Date.now() - 4 * 60 * 60 * 1000),
    containedAt: new Date(Date.now() - 1 * 60 * 60 * 1000),
  });

  await db.insert(observables).values([
    {
      id: newId("obs"),
      caseId,
      type: "url",
      value: "https://acm3.co/login",
      tlp: "amber",
      isIoc: true,
      createdBy: userId,
    },
    {
      id: newId("obs"),
      caseId,
      type: "ip",
      value: "198.51.100.42",
      tlp: "amber",
      isIoc: true,
      createdBy: userId,
    },
    {
      id: newId("obs"),
      caseId,
      type: "email",
      value: "billing@acm3.co",
      tlp: "amber",
      isIoc: true,
      createdBy: userId,
    },
  ]);

  // Spawn the playbook so there are tasks with cadence.
  const runId = newId("run");
  await db.insert(playbookRuns).values({
    id: runId,
    caseId,
    playbookId: pbId,
    startedBy: userId,
    startedAt: new Date(Date.now() - 3 * 60 * 60 * 1000),
  });
  const [pb] = await db
    .select()
    .from(playbooks)
    .where(eq(playbooks.id, pbId))
    .limit(1);
  const steps = pb.steps as Array<{
    id: string;
    title: string;
    description?: string;
    offsetMinutes: number;
    isRequired: boolean;
  }>;
  const startedAt = new Date(Date.now() - 3 * 60 * 60 * 1000);
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    await db.insert(caseTasks).values({
      id: newId("task"),
      caseId,
      title: s.title,
      description: s.description ?? null,
      dueAt: new Date(startedAt.getTime() + s.offsetMinutes * 60000),
      orderIndex: i,
      playbookRunId: runId,
      playbookStepId: s.id,
      status: i < 2 ? "done" : "in_progress",
      completedAt: i < 2 ? new Date(Date.now() - (4 - i) * 30 * 60000) : null,
      completedBy: i < 2 ? userId : null,
    });
  }

  // Seed timeline events to give the UI substance.
  const tlInsert = async (eventType: string, payload: Record<string, unknown>, offsetMin: number) => {
    await db.insert(timelineEvents).values({
      id: newId("tle"),
      caseId,
      actorId: userId,
      eventType,
      payload,
      occurredAt: new Date(Date.now() - offsetMin * 60000),
    });
  };
  await tlInsert("case_created", { title: "Phishing wave against finance team" }, 240);
  await tlInsert("status_change", { from: "open", to: "in_progress" }, 235);
  await tlInsert("playbook_started", { playbook_name: pb.name, steps: steps.length }, 180);
  await tlInsert("task_completed", { title: "Acknowledge and confirm scope" }, 90);
  await tlInsert("status_change", { from: "in_progress", to: "contained" }, 60);

  console.log("Seeded:");
  console.log(`  Organisation: ${ORG_SLUG}`);
  console.log("  Admin login : admin@acme.local / kelpieadmin");
  console.log("  Analyst     : analyst@acme.local / kelpieanalyst");
  console.log(`  Case        : ${caseNumber}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

import { db } from "@/db";
import { caseTemplates, playbooks, type PlaybookStep } from "@/db/schema";
import { count, eq } from "drizzle-orm";
import { newId } from "./utils";

type BaselinePlaybook = {
  key: string;
  name: string;
  description: string;
  classification:
    | "malware"
    | "phishing"
    | "unauthorised_access"
    | "data_breach"
    | "dos"
    | "policy_violation"
    | "other";
  steps: Array<Omit<PlaybookStep, "id">>;
};

const BASELINE_PLAYBOOKS: BaselinePlaybook[] = [
  {
    key: "phishing",
    name: "Phishing first response",
    description: "Triage, contain, and follow up on reported phishing.",
    classification: "phishing",
    steps: [
      {
        title: "Acknowledge report and preserve evidence",
        description: "Confirm reporter, preserve headers, screenshots, URLs, and attachment hashes.",
        offsetMinutes: 15,
        isRequired: true,
      },
      {
        title: "Scope recipients and delivery",
        description: "Search mail logs for matching subject, sender, URLs, and attachments.",
        offsetMinutes: 30,
        isRequired: true,
      },
      {
        title: "Block sender, URLs, and payloads",
        description: "Add mail, DNS, proxy, and EDR blocks for confirmed indicators.",
        offsetMinutes: 60,
        isRequired: true,
      },
      {
        title: "Check clicks and credential exposure",
        description: "Review proxy and identity logs, reset credentials where exposure is likely.",
        offsetMinutes: 120,
        isRequired: true,
      },
      {
        title: "Notify affected users",
        description: "Send clear guidance to recipients and confirm reporting channel expectations.",
        offsetMinutes: 180,
        isRequired: false,
      },
    ],
  },
  {
    key: "malware",
    name: "Endpoint malware containment",
    description: "Contain a suspicious host, collect evidence, and eradicate malware.",
    classification: "malware",
    steps: [
      {
        title: "Confirm detection and affected endpoint",
        description: "Validate host, user, detection name, process tree, and first seen time.",
        offsetMinutes: 15,
        isRequired: true,
      },
      {
        title: "Isolate endpoint",
        description: "Network contain the host while preserving remote response access.",
        offsetMinutes: 30,
        isRequired: true,
      },
      {
        title: "Collect volatile evidence",
        description: "Capture process list, network connections, suspicious files, and relevant logs.",
        offsetMinutes: 90,
        isRequired: true,
      },
      {
        title: "Eradicate and re-scan",
        description: "Remove persistence, clean or rebuild, then run an EDR and AV scan.",
        offsetMinutes: 240,
        isRequired: true,
      },
      {
        title: "Hunt for lateral movement",
        description: "Search for shared hashes, parent processes, user activity, and remote execution.",
        offsetMinutes: 360,
        isRequired: false,
      },
    ],
  },
  {
    key: "unauthorised_access",
    name: "Account compromise response",
    description: "Handle suspicious sign-ins, session theft, or credential compromise.",
    classification: "unauthorised_access",
    steps: [
      {
        title: "Validate identity event",
        description: "Review user, source IP, device, MFA outcome, impossible travel, and app accessed.",
        offsetMinutes: 15,
        isRequired: true,
      },
      {
        title: "Revoke sessions and reset credentials",
        description: "Invalidate refresh tokens, reset password, and require MFA re-registration if needed.",
        offsetMinutes: 45,
        isRequired: true,
      },
      {
        title: "Review mailbox and app activity",
        description: "Check forwarding rules, OAuth grants, inbox rules, files accessed, and administrator actions.",
        offsetMinutes: 120,
        isRequired: true,
      },
      {
        title: "Block malicious infrastructure",
        description: "Add conditional access, firewall, proxy, and detection blocks for confirmed sources.",
        offsetMinutes: 180,
        isRequired: false,
      },
      {
        title: "Notify owner and document exposure",
        description: "Record user impact, data accessed, containment actions, and follow-up owner.",
        offsetMinutes: 360,
        isRequired: true,
      },
    ],
  },
  {
    key: "data_breach",
    name: "Data exposure triage",
    description: "Assess suspected data loss, preserve facts, and support notification decisions.",
    classification: "data_breach",
    steps: [
      {
        title: "Preserve source evidence",
        description: "Capture alert, access logs, file names, recipient lists, and affected systems.",
        offsetMinutes: 30,
        isRequired: true,
      },
      {
        title: "Classify exposed data",
        description: "Determine data types, sensitivity, record counts, jurisdictions, and business owner.",
        offsetMinutes: 120,
        isRequired: true,
      },
      {
        title: "Contain access",
        description: "Revoke sharing links, disable exposed credentials, and block unauthorised access paths.",
        offsetMinutes: 180,
        isRequired: true,
      },
      {
        title: "Escalate to legal and privacy owners",
        description: "Provide facts needed for notification, contractual, and regulatory assessment.",
        offsetMinutes: 240,
        isRequired: true,
      },
      {
        title: "Prepare impact summary",
        description: "Document timeline, data involved, containment, residual risk, and next actions.",
        offsetMinutes: 480,
        isRequired: true,
      },
    ],
  },
  {
    key: "service_disruption",
    name: "Service disruption triage",
    description: "Coordinate a denial-of-service or critical service availability incident.",
    classification: "dos",
    steps: [
      {
        title: "Confirm impact and affected service",
        description: "Identify user impact, service owner, region, symptom, and start time.",
        offsetMinutes: 15,
        isRequired: true,
      },
      {
        title: "Collect traffic and health signals",
        description: "Review WAF, CDN, load balancer, firewall, DNS, and application telemetry.",
        offsetMinutes: 30,
        isRequired: true,
      },
      {
        title: "Apply mitigation",
        description: "Enable rate limits, WAF rules, upstream filtering, or failover as appropriate.",
        offsetMinutes: 60,
        isRequired: true,
      },
      {
        title: "Open provider or infrastructure escalation",
        description: "Engage ISP, cloud, CDN, or platform support with evidence and requested action.",
        offsetMinutes: 90,
        isRequired: false,
      },
      {
        title: "Monitor recovery and document residual risk",
        description: "Track service health, customer impact, mitigation side effects, and follow-up work.",
        offsetMinutes: 180,
        isRequired: true,
      },
    ],
  },
];

const BASELINE_TEMPLATES = [
  {
    name: "Reported phishing",
    classification: "phishing" as const,
    defaultSeverity: "medium" as const,
    defaultTlp: "amber" as const,
    playbookKey: "phishing",
    defaultTags: ["email", "user-reported"],
    defaultDataClassificationTags: ["internal"],
    summaryTemplate:
      "Reported on {{date}} by {{reporter}}.\n\nInitial facts:\n- Reporter:\n- Sender:\n- Subject:\n- URLs or attachments:\n- Known recipients:\n\nContainment notes:",
    defaultTasks: [
      {
        title: "Attach original message or headers",
        description: "Preserve enough evidence for mailbox search and indicator extraction.",
      },
    ],
  },
  {
    name: "Endpoint malware alert",
    classification: "malware" as const,
    defaultSeverity: "high" as const,
    defaultTlp: "amber" as const,
    playbookKey: "malware",
    defaultTags: ["endpoint", "edr"],
    defaultDataClassificationTags: ["internal"],
    summaryTemplate:
      "Reported on {{date}} by {{reporter}}.\n\nEndpoint:\nUser:\nDetection:\nFirst seen:\nBusiness impact:\n\nInitial containment:",
    defaultTasks: [
      {
        title: "Identify host owner and business criticality",
        description: "Confirm whether isolation will disrupt a critical workflow.",
      },
    ],
  },
  {
    name: "Suspicious account activity",
    classification: "unauthorised_access" as const,
    defaultSeverity: "high" as const,
    defaultTlp: "amber" as const,
    playbookKey: "unauthorised_access",
    defaultTags: ["identity", "account-compromise"],
    defaultDataClassificationTags: ["credentials"],
    summaryTemplate:
      "Reported on {{date}} by {{reporter}}.\n\nAccount:\nSuspicious source:\nMFA result:\nApps accessed:\nPotential exposure:\n\nImmediate actions:",
    defaultTasks: [
      {
        title: "Confirm account owner contact details",
        description: "Use a known-good channel before discussing suspicious activity.",
      },
    ],
  },
  {
    name: "Potential data exposure",
    classification: "data_breach" as const,
    defaultSeverity: "critical" as const,
    defaultTlp: "amber_strict" as const,
    playbookKey: "data_breach",
    defaultTags: ["privacy", "potential-breach"],
    defaultDataClassificationTags: ["confidential", "pii"],
    summaryTemplate:
      "Reported on {{date}} by {{reporter}}.\n\nData involved:\nSystems involved:\nExternal parties:\nApproximate record count:\nContainment status:\n\nPrivacy/legal notes:",
    defaultTasks: [
      {
        title: "Identify data owner",
        description: "Find the business owner who can classify the data and approve containment.",
      },
    ],
  },
  {
    name: "Critical service outage",
    classification: "dos" as const,
    defaultSeverity: "high" as const,
    defaultTlp: "amber" as const,
    playbookKey: "service_disruption",
    defaultTags: ["availability", "service-impact"],
    defaultDataClassificationTags: ["internal"],
    summaryTemplate:
      "Reported on {{date}} by {{reporter}}.\n\nService:\nUser impact:\nStart time:\nKnown dependencies:\nCurrent mitigations:\n\nCommunication owner:",
    defaultTasks: [
      {
        title: "Nominate incident communications owner",
        description: "Keep stakeholder updates separate from technical mitigation work.",
      },
    ],
  },
];

export async function seedBaselineOrganisationData(
  organisationId: string,
): Promise<{ playbooksCreated: number; templatesCreated: number }> {
  const [{ value: playbookCount }] = await db
    .select({ value: count() })
    .from(playbooks)
    .where(eq(playbooks.organisationId, organisationId));

  const playbookIdsByKey = new Map<string, string>();
  let playbooksCreated = 0;

  if (Number(playbookCount) === 0) {
    for (const baseline of BASELINE_PLAYBOOKS) {
      const id = newId("pb");
      playbookIdsByKey.set(baseline.key, id);
      await db.insert(playbooks).values({
        id,
        organisationId,
        name: baseline.name,
        description: baseline.description,
        classification: baseline.classification,
        isActive: true,
        steps: baseline.steps.map((step) => ({
          id: newId("step"),
          ...step,
        })),
      });
      playbooksCreated++;
    }
  } else {
    const existing = await db
      .select({ id: playbooks.id, name: playbooks.name })
      .from(playbooks)
      .where(eq(playbooks.organisationId, organisationId));
    for (const baseline of BASELINE_PLAYBOOKS) {
      const match = existing.find((p) => p.name === baseline.name);
      if (match) playbookIdsByKey.set(baseline.key, match.id);
    }
  }

  const [{ value: templateCount }] = await db
    .select({ value: count() })
    .from(caseTemplates)
    .where(eq(caseTemplates.organisationId, organisationId));

  let templatesCreated = 0;
  if (Number(templateCount) === 0) {
    for (const template of BASELINE_TEMPLATES) {
      await db.insert(caseTemplates).values({
        id: newId("ct"),
        organisationId,
        name: template.name,
        classification: template.classification,
        defaultSeverity: template.defaultSeverity,
        defaultTlp: template.defaultTlp,
        summaryTemplate: template.summaryTemplate,
        defaultPlaybookId: playbookIdsByKey.get(template.playbookKey) ?? null,
        defaultTags: template.defaultTags,
        defaultDataClassificationTags: template.defaultDataClassificationTags,
        defaultTasks: template.defaultTasks,
      });
      templatesCreated++;
    }
  }

  return { playbooksCreated, templatesCreated };
}

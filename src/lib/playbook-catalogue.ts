/**
 * Baseline playbook catalogue (issue #52).
 *
 * This module is the single source of truth for Kelpie's versioned
 * common-scenario playbook catalogue. `src/lib/baseline-data.ts` seeds this
 * content per-organisation (idempotently, by `catalogueKey`); the REST and
 * MCP read surfaces (`src/lib/playbooks-core.ts`) read whatever ends up in
 * the `playbooks`/`case_templates` tables, so this file only ever needs to
 * change when the catalogue itself changes.
 *
 * ## Maintenance rules
 *
 * 1. Never rename or reuse an existing `key`. Keys are stable identifiers:
 *    they are how seeding recognises "this baseline scenario already exists
 *    for this organisation" (see `playbooks.catalogue_key`, unique per
 *    organisation). Renaming a key makes every already-seeded organisation
 *    look like it is missing that scenario, and the next sync would create a
 *    duplicate playbook instead of recognising the existing one.
 * 2. Adding a new entry to `BASELINE_PLAYBOOKS` (or `BASELINE_TEMPLATES`) is
 *    always safe: `seedBaselineOrganisationData` only inserts rows whose key
 *    is missing for that organisation. Existing rows — including ones an
 *    analyst has since edited — are never touched.
 * 3. Editing an existing entry's `steps`/`content`/etc. in this file changes
 *    what *new* organisations (and orgs that never had that key) receive. It
 *    does **not** retroactively change any already-seeded playbook, by
 *    design — that is the "never overwrite local edits" guarantee. If a
 *    correction genuinely needs to reach existing organisations, that is a
 *    deliberate, reviewed data migration, not a silent side effect of
 *    editing this file.
 * 4. Bump `PLAYBOOK_CATALOGUE_VERSION` when the catalogue's shape or content
 *    meaningfully changes. The version is stamped onto newly-inserted rows
 *    only (`catalogueVersion`), so it records "which catalogue definition
 *    produced this row", not a live version an existing row must track.
 * 5. Keep `classification` within the existing `classificationEnum` values
 *    (`malware`, `phishing`, `unauthorised_access`, `data_breach`, `dos`,
 *    `policy_violation`, `other`). The catalogue intentionally distinguishes
 *    finer-grained scenarios via `key`/`tags`/`requiredObservableTypes`
 *    rather than growing the case classification enum.
 * 6. MITRE ATT&CK technique IDs are plain strings (`mitreTechniques`). Issue
 *    #48 (structured ATT&CK mapping) is a separate, unmerged change — do not
 *    add a dependency on it here.
 * 7. Threat-intelligence-shaped observables only ever use Kelpie's four
 *    supported indicator types: `ip`, `url`, `file_hash`, `domain` (see
 *    `src/lib/ti/indicator-types.ts`). `requiredObservableTypes` may also use
 *    the broader observable types (`email`, `hostname`, `username`,
 *    `registry_key`, `other`) since that field describes case observables in
 *    general, not TI indicators specifically.
 */

import type { PlaybookContent, PlaybookStep } from "@/db/schema";

export const PLAYBOOK_CATALOGUE_VERSION = 1;

export type BaselineClassification =
  | "malware"
  | "phishing"
  | "unauthorised_access"
  | "data_breach"
  | "dos"
  | "policy_violation"
  | "other";

export type BaselineSeverity = "low" | "medium" | "high" | "critical";

export type BaselineObservableType =
  | "ip"
  | "domain"
  | "url"
  | "file_hash"
  | "email"
  | "hostname"
  | "username"
  | "registry_key"
  | "other";

export type BaselinePlaybook = {
  key: string;
  name: string;
  description: string;
  classification: BaselineClassification;
  defaultSeverity: BaselineSeverity;
  tags: string[];
  requiredObservableTypes: BaselineObservableType[];
  steps: Array<Omit<PlaybookStep, "id">>;
  content: PlaybookContent;
};

export type BaselineTemplate = {
  key: string;
  playbookKey: string;
  name: string;
  classification: BaselineClassification;
  defaultSeverity: BaselineSeverity;
  defaultTlp: "clear" | "green" | "amber" | "amber_strict" | "red";
  defaultTags: string[];
  defaultDataClassificationTags: string[];
  summaryTemplate: string;
  defaultTasks: Array<{ title: string; description?: string }>;
};

/**
 * 16 common SOC scenarios (issue #52). Order here is display order on a
 * freshly-seeded organisation; it has no bearing on stability of `key`.
 */
export const BASELINE_PLAYBOOKS: BaselinePlaybook[] = [
  {
    key: "reported_phishing",
    name: "Reported phishing and malicious attachment/URL",
    description:
      "Triage a user-reported or detected phishing email, malicious attachment, or malicious URL; contain delivery and follow up with affected recipients.",
    classification: "phishing",
    defaultSeverity: "medium",
    tags: ["email", "phishing", "user-reported"],
    requiredObservableTypes: ["url", "email", "file_hash"],
    steps: [
      {
        title: "Acknowledge report and preserve evidence",
        description:
          "Confirm the reporter, thank them, and preserve the original message: full headers, sender address, subject, body, URLs, and attachment hashes before anything is deleted or auto-remediated by mail security tooling.",
        offsetMinutes: 15,
        isRequired: true,
        phase: "triage",
      },
      {
        title: "Scope recipients and delivery",
        description:
          "Search mail logs/EDR for the same sender, subject, URLs, and attachment hashes to find every recipient, whether it was delivered, opened, or clicked.",
        offsetMinutes: 30,
        isRequired: true,
        phase: "scoping",
      },
      {
        title: "Block sender, URLs, and payloads",
        description:
          "Add mail, DNS, proxy, and EDR blocks for the confirmed sender, URLs, domains, and attachment hashes.",
        offsetMinutes: 60,
        isRequired: true,
        phase: "containment",
        requiresApproval: false,
      },
      {
        title: "Check clicks and credential exposure",
        description:
          "Review proxy and identity sign-in logs for anyone who visited the URL or entered credentials; reset credentials and revoke sessions for anyone with likely exposure.",
        offsetMinutes: 120,
        isRequired: true,
        phase: "eradication",
        requiresApproval: true,
      },
      {
        title: "Notify affected users",
        description:
          "Send clear guidance to recipients: what to look for, what to do, and how to report similar messages.",
        offsetMinutes: 180,
        isRequired: false,
        phase: "communications",
      },
      {
        title: "Confirm closure and record lessons",
        description:
          "Confirm no further deliveries, all indicators blocked, and any exposed accounts remediated before closing.",
        offsetMinutes: 300,
        isRequired: true,
        phase: "closure",
      },
    ],
    content: {
      purpose:
        "Contain a phishing lure quickly, establish how far it spread, and remove any credential or malware exposure it caused.",
      triggers: [
        "User-reported suspicious email via the report button or help desk.",
        "Secure email gateway or EDR detection for a known phishing indicator.",
        "Multiple users report a near-identical message in a short window.",
      ],
      exclusions: [
        "Internal phishing-awareness simulation traffic from an approved vendor/campaign.",
        "Marketing or newsletter email that a user has simply misidentified as phishing with no malicious indicators.",
      ],
      severityGuidance:
        "Low/medium when reported before wide delivery and no evidence of clicks. High when credentials were entered or a payload executed. Critical when it enabled account takeover, lateral movement, or looks like the opening stage of a business email compromise or ransomware chain.",
      evidenceToPreserve: [
        "Full original message including headers (do not forward-and-strip).",
        "Screenshot of the message as rendered to the recipient.",
        "URLs and attachment file hashes.",
        "Mail flow / delivery log entries for every recipient.",
      ],
      initialQuestions: [
        "Who reported it, and did they interact with it (click, open, enter credentials)?",
        "Is the sender internal, external, or a spoofed internal address?",
        "Does the lure reference a real internal process (invoice, payroll, DocuSign) suggesting targeted reconnaissance?",
        "How many recipients, and are any of them privileged or finance/payroll accounts?",
      ],
      decisionPoints: [
        "Escalate to business email compromise handling if the sender is an internal/vendor mailbox rather than an external spoof.",
        "Escalate to malware containment if the attachment executed on an endpoint.",
        "Escalate to data exposure handling if a credential-harvesting page captured real credentials.",
      ],
      approvalActions: [
        "Resetting a user's credentials and revoking active sessions.",
        "Blocking a vendor or partner domain that may affect legitimate mail flow.",
      ],
      communicationsOwners: [
        "IT/security owns containment communication to affected recipients.",
        "People/HR owner only if a targeted user needs individual follow-up.",
      ],
      closureCriteria: [
        "All confirmed indicators (sender, URLs, attachment hashes) are blocked.",
        "Every recipient with likely exposure has been checked and, where needed, remediated.",
        "No further deliveries observed for at least one full mail-log review cycle.",
      ],
      followUpImprovements: [
        "Add the lure's indicators to the organisation's blocklists/threat-intel feed.",
        "Consider targeted awareness reminder if the lure was convincing or widely delivered.",
      ],
      mitreTechniques: ["T1566.001", "T1566.002", "T1204.001", "T1204.002"],
      caseFieldsToCapture: [
        "Sender address and display name",
        "Subject line",
        "Recipient count",
        "Confirmed clicks/credential entry (yes/no)",
      ],
    },
  },
  {
    key: "business_email_compromise",
    name: "Business email compromise",
    description:
      "Handle a compromised or spoofed business mailbox used for fraud (invoice redirection, gift-card requests, payroll diversion) or as a pivot into further compromise.",
    classification: "unauthorised_access",
    defaultSeverity: "high",
    tags: ["email", "fraud", "identity", "finance"],
    requiredObservableTypes: ["email", "ip", "username"],
    steps: [
      {
        title: "Confirm mailbox compromise vs. spoof",
        description:
          "Check sign-in logs, mail rules, and message headers to determine whether the mailbox itself was compromised or the sender was merely spoofed.",
        offsetMinutes: 15,
        isRequired: true,
        phase: "triage",
      },
      {
        title: "Revoke sessions and reset credentials",
        description:
          "If compromised: invalidate all active sessions/refresh tokens, force a password reset, and re-register MFA.",
        offsetMinutes: 30,
        isRequired: true,
        phase: "containment",
        requiresApproval: true,
      },
      {
        title: "Search for and remove malicious mail rules and forwarding",
        description:
          "Attackers commonly add hidden inbox rules or auto-forwarding to hide their fraud traffic; find and remove every one, and record what each did.",
        offsetMinutes: 60,
        isRequired: true,
        phase: "eradication",
      },
      {
        title: "Identify fraudulent messages sent and their recipients",
        description:
          "Search sent items and mail flow logs for fraudulent invoices, payment redirection, or gift-card requests sent from the mailbox.",
        offsetMinutes: 90,
        isRequired: true,
        phase: "scoping",
      },
      {
        title: "Alert finance/payroll and any external recipients",
        description:
          "Warn finance/payroll to hold or reverse any payment made because of the fraudulent messages, and notify external recipients who received them.",
        offsetMinutes: 120,
        isRequired: true,
        phase: "communications",
        requiresApproval: true,
      },
      {
        title: "Confirm closure and residual risk",
        description:
          "Confirm no outstanding fraudulent payments, mailbox rules are clean, and access is fully re-secured before closing.",
        offsetMinutes: 480,
        isRequired: true,
        phase: "closure",
      },
    ],
    content: {
      purpose:
        "Stop fraud in progress from a compromised or spoofed business mailbox, and prevent financial loss to the organisation or its partners.",
      triggers: [
        "Finance/payroll flags an unusual payment or bank-detail-change request.",
        "A partner reports receiving a suspicious invoice or payment request from your domain.",
        "Sign-in anomaly on an executive, finance, or payroll mailbox.",
      ],
      exclusions: [
        "A legitimate but unusually-worded internal finance request confirmed via a known-good channel.",
      ],
      severityGuidance:
        "High by default given financial and reputational exposure. Critical if a payment was actually redirected/paid, or if the mailbox belongs to an executive or finance/payroll role.",
      evidenceToPreserve: [
        "Sign-in logs (source IP, device, location, MFA result) for the mailbox.",
        "Mail rule/forwarding configuration at time of discovery, before removal.",
        "Full text and headers of fraudulent messages sent and received.",
        "Any bank-detail-change requests and their delivery path.",
      ],
      initialQuestions: [
        "Was the mailbox actually compromised (valid sign-in from unfamiliar location/device) or only spoofed?",
        "What financial or sensitive requests were sent, and to whom?",
        "Has any payment already been made based on a fraudulent instruction?",
        "Does the account holder have delegate access others could also be affected by?",
      ],
      decisionPoints: [
        "Engage the bank/payment provider immediately if a payment has already been sent — recall windows are short.",
        "Escalate to legal/privacy if customer or partner personal data was exposed via the mailbox.",
      ],
      approvalActions: [
        "Resetting credentials and revoking sessions for the affected account.",
        "Notifying external partners that they may have received fraudulent correspondence.",
        "Any request to a bank to recall or freeze a payment.",
      ],
      communicationsOwners: [
        "Finance owns payment recall/hold and bank contact.",
        "Security/IT owns technical containment and account recovery.",
        "Leadership if an executive mailbox was involved.",
      ],
      closureCriteria: [
        "Mailbox rules and forwarding confirmed clean.",
        "All fraudulent messages accounted for, with recipients notified.",
        "Any in-flight payment held, recalled, or accepted as loss with finance sign-off.",
      ],
      followUpImprovements: [
        "Add out-of-band verification requirement for bank-detail changes.",
        "Review conditional access / impossible-travel policy for finance and executive roles.",
      ],
      mitreTechniques: ["T1114.003", "T1586.002", "T1078.004", "T1564.008"],
      caseFieldsToCapture: [
        "Mailbox owner and role",
        "Confirmed compromise vs. spoof",
        "Fraudulent payment amount (if any)",
        "External recipients notified",
      ],
    },
  },
  {
    key: "malware_ransomware",
    name: "Malware and ransomware containment",
    description:
      "Contain a suspicious or confirmed malware/ransomware detection on an endpoint or server, collect evidence, and eradicate before recovery.",
    classification: "malware",
    defaultSeverity: "critical",
    tags: ["endpoint", "malware", "ransomware", "edr"],
    requiredObservableTypes: ["file_hash", "hostname", "ip"],
    steps: [
      {
        title: "Confirm detection and affected endpoint",
        description:
          "Validate host, user, detection name, process tree, and first-seen time from EDR/AV telemetry.",
        offsetMinutes: 15,
        isRequired: true,
        phase: "triage",
      },
      {
        title: "Isolate endpoint",
        description:
          "Network-contain the host (EDR isolation or switch port disable) while preserving remote response access.",
        offsetMinutes: 30,
        isRequired: true,
        phase: "containment",
        requiresApproval: true,
      },
      {
        title: "Collect volatile evidence",
        description:
          "Capture process list, network connections, loaded modules, suspicious files, and relevant logs before shutdown or reimage.",
        offsetMinutes: 90,
        isRequired: true,
        phase: "scoping",
      },
      {
        title: "Hunt for lateral movement and shared indicators",
        description:
          "Search for the same file hash, C2 IP/domain, parent process, or credential use on other hosts.",
        offsetMinutes: 150,
        isRequired: true,
        phase: "scoping",
      },
      {
        title: "Eradicate and re-scan",
        description:
          "Remove persistence, rebuild from known-good image where ransomware or destructive malware is confirmed, then run a full EDR/AV scan before returning to service.",
        offsetMinutes: 240,
        isRequired: true,
        phase: "eradication",
        requiresApproval: true,
      },
      {
        title: "Restore from backup and validate integrity",
        description:
          "For ransomware, restore affected data from a verified clean backup and confirm integrity before reconnecting to the network.",
        offsetMinutes: 360,
        isRequired: false,
        phase: "recovery",
        requiresApproval: true,
      },
      {
        title: "Confirm closure and document root cause",
        description:
          "Confirm no reinfection signals, document initial access vector, and close once recovery is verified.",
        offsetMinutes: 720,
        isRequired: true,
        phase: "closure",
      },
    ],
    content: {
      purpose:
        "Stop malware/ransomware from spreading, preserve enough evidence to understand initial access and blast radius, and safely return the environment to a known-good state.",
      triggers: [
        "EDR/AV alert for known malware family, ransomware behaviour, or suspicious encryption activity.",
        "User reports files renamed with an unfamiliar extension or a ransom note.",
        "Unusual outbound C2-like traffic from an endpoint or server.",
      ],
      exclusions: [
        "Confirmed false positive from an approved internal tool flagged by a signature update (verify before excluding).",
      ],
      severityGuidance:
        "High for a single contained endpoint with no signs of spread. Critical for confirmed ransomware, a server/domain controller, or any sign of lateral movement or data staging for exfiltration.",
      evidenceToPreserve: [
        "EDR/AV alert detail and detection name.",
        "Process tree, command lines, and loaded modules at time of detection.",
        "Sample/hash of the malicious file (submit to sandbox where policy allows).",
        "Network connection log (destination IP/domain, port, volume).",
        "Ransom note text and any leak-site reference, if present.",
      ],
      initialQuestions: [
        "Is this a workstation, server, or domain controller?",
        "Is there evidence of encryption in progress, or only detection/blocking?",
        "What is the earliest sign of compromise on this host (first-seen time)?",
        "Are there other hosts showing the same indicators right now?",
      ],
      decisionPoints: [
        "Escalate to full incident/crisis handling if ransomware has encrypted shared or backup storage.",
        "Decide whether to isolate proactively across a broader segment if lateral movement is suspected before scoping completes.",
        "Decide rebuild-from-image vs. clean-in-place based on malware class and criticality of the host.",
      ],
      approvalActions: [
        "Network isolation of a business-critical host or server.",
        "Taking a host offline for reimage/rebuild.",
        "Restoring from backup onto production infrastructure.",
        "Any decision involving a ransom note or attacker contact (route to leadership/legal — never engage unilaterally).",
      ],
      communicationsOwners: [
        "IT/security owns technical containment and recovery communication.",
        "Business owner of the affected system for downtime impact.",
        "Leadership/legal for any ransomware event with a ransom note or leak-site reference.",
      ],
      closureCriteria: [
        "Host rebuilt or verified clean via full scan, with persistence mechanisms removed.",
        "No reinfection or related indicators observed across a full monitoring cycle.",
        "Data restored (if applicable) and integrity verified.",
      ],
      followUpImprovements: [
        "Patch or remove the initial access vector (vulnerable service, exposed RDP, phishing lure).",
        "Verify backup isolation/immutability if ransomware reached backup infrastructure.",
      ],
      mitreTechniques: [
        "T1486",
        "T1490",
        "T1547.001",
        "T1021.001",
        "T1071.001",
      ],
      caseFieldsToCapture: [
        "Affected host(s) and criticality",
        "Malware family/detection name",
        "Confirmed lateral movement (yes/no)",
        "Backup restore required (yes/no)",
      ],
    },
  },
  {
    key: "account_takeover_signin_mfa_fatigue",
    name: "Account takeover, suspicious sign-in, and MFA fatigue",
    description:
      "Respond to a suspicious sign-in, impossible-travel alert, or a user reporting repeated unexpected MFA prompts (MFA fatigue/push-bombing).",
    classification: "unauthorised_access",
    defaultSeverity: "high",
    tags: ["identity", "account-compromise", "mfa", "sign-in"],
    requiredObservableTypes: ["username", "ip"],
    steps: [
      {
        title: "Validate the identity event",
        description:
          "Review the user, source IP, device, MFA outcome, impossible-travel signal, and app accessed for the flagged sign-in(s).",
        offsetMinutes: 15,
        isRequired: true,
        phase: "triage",
      },
      {
        title: "Revoke sessions and reset credentials",
        description:
          "Invalidate refresh tokens/active sessions, reset the password, and require MFA re-registration if compromise is confirmed or MFA fatigue led to an accepted prompt.",
        offsetMinutes: 45,
        isRequired: true,
        phase: "containment",
        requiresApproval: true,
      },
      {
        title: "Review mailbox and application activity since the event",
        description:
          "Check forwarding rules, OAuth grants, inbox rules, files accessed, and any administrative actions taken during the suspicious session.",
        offsetMinutes: 120,
        isRequired: true,
        phase: "scoping",
      },
      {
        title: "Block malicious infrastructure",
        description:
          "Add conditional access, firewall, proxy, and detection blocks for the confirmed malicious source IP/ASN where feasible.",
        offsetMinutes: 180,
        isRequired: false,
        phase: "containment",
      },
      {
        title: "Notify the user and document exposure",
        description:
          "Confirm with the account owner via a known-good channel, and record user impact, data accessed, and containment actions taken.",
        offsetMinutes: 240,
        isRequired: true,
        phase: "communications",
      },
      {
        title: "Confirm closure",
        description:
          "Confirm sessions revoked, credentials rotated, no persistence (mail rules/OAuth grants) remains, and no further suspicious sign-ins.",
        offsetMinutes: 360,
        isRequired: true,
        phase: "closure",
      },
    ],
    content: {
      purpose:
        "Cut off attacker access to an account quickly, understand what the attacker did while inside, and close any persistence they left behind.",
      triggers: [
        "Impossible-travel or unfamiliar-location sign-in alert.",
        "Multiple unexpected MFA push prompts reported by the user (push-bombing/MFA fatigue).",
        "Sign-in from a known-malicious IP or after a credential-stuffing wave.",
      ],
      exclusions: [
        "Confirmed legitimate travel or a new personal device the user recognises, with no other suspicious activity.",
      ],
      severityGuidance:
        "Medium if caught before any successful sign-in. High for a confirmed successful sign-in with no evidence of further action. Critical if the account is privileged or the attacker took further action (mail rule, OAuth grant, admin change, lateral movement).",
      evidenceToPreserve: [
        "Sign-in log entries: timestamp, source IP, ASN/geolocation, device, user agent, MFA result.",
        "Any mail rules, OAuth app grants, or admin actions created during the session.",
        "The user's own account of the MFA prompts (count, time, approved/denied).",
      ],
      initialQuestions: [
        "Did the user approve an MFA prompt they did not initiate?",
        "Is the account privileged (admin, finance, executive)?",
        "What did the session actually do — read-only access, or changes/exfil?",
        "Is the source IP associated with known-malicious infrastructure or a residential proxy?",
      ],
      decisionPoints: [
        "Escalate to business email compromise handling if fraudulent messages were sent from the mailbox.",
        "Escalate to privileged-account misuse handling if the account has administrative rights and made configuration changes.",
        "Escalate to cloud workload compromise handling if the account has access to cloud infrastructure and resources were touched.",
      ],
      approvalActions: [
        "Forcing a password reset and full session revocation.",
        "Disabling the account entirely if compromise is confirmed and ongoing.",
        "Blocking a source IP/ASN via conditional access.",
      ],
      communicationsOwners: [
        "Security/IT owns technical containment.",
        "Manager or HR involvement only if user behaviour (e.g. repeatedly approving prompts) needs a coaching conversation.",
      ],
      closureCriteria: [
        "All sessions for the account revoked and credentials rotated.",
        "No unexplained mail rules, OAuth grants, or admin actions remain.",
        "No further suspicious sign-ins observed for a full monitoring cycle.",
      ],
      followUpImprovements: [
        "Move the user to number-matching/phishing-resistant MFA if push-bombing was involved.",
        "Tighten conditional access (location, device compliance) for the affected account's role.",
      ],
      mitreTechniques: ["T1078", "T1621", "T1110.003", "T1556"],
      caseFieldsToCapture: [
        "Account/user affected",
        "Source IP and geolocation",
        "MFA outcome",
        "Confirmed unauthorised action taken (if any)",
      ],
    },
  },
  {
    key: "malicious_oauth_token_theft",
    name: "Malicious OAuth application or token/session theft",
    description:
      "Respond to a malicious or over-permissioned OAuth application grant, or evidence of stolen session/refresh tokens (token replay, adversary-in-the-middle) bypassing MFA.",
    classification: "unauthorised_access",
    defaultSeverity: "high",
    tags: ["identity", "oauth", "token-theft", "saas"],
    requiredObservableTypes: ["username", "other"],
    steps: [
      {
        title: "Identify the grant or token event",
        description:
          "Confirm the OAuth application name, publisher, requested scopes, granting user, and grant time — or, for token theft, the session/device fingerprint anomaly.",
        offsetMinutes: 15,
        isRequired: true,
        phase: "triage",
      },
      {
        title: "Revoke the application grant or session token",
        description:
          "Revoke the malicious OAuth application's access and/or the stolen session and refresh tokens immediately; this survives a password-only reset, which token theft otherwise bypasses.",
        offsetMinutes: 30,
        isRequired: true,
        phase: "containment",
        requiresApproval: true,
      },
      {
        title: "Reset credentials and re-issue MFA",
        description:
          "Reset the affected user's password and force MFA re-registration in case the underlying credential is also known to the attacker.",
        offsetMinutes: 45,
        isRequired: true,
        phase: "containment",
        requiresApproval: true,
      },
      {
        title: "Scope other users who granted the same application",
        description:
          "Search the tenant for any other user who has granted the same malicious application or shows the same anomalous token/device fingerprint.",
        offsetMinutes: 90,
        isRequired: true,
        phase: "scoping",
      },
      {
        title: "Review activity performed via the grant/session",
        description:
          "Check mailbox, file, and application activity performed while the malicious grant or stolen token was active.",
        offsetMinutes: 120,
        isRequired: true,
        phase: "eradication",
      },
      {
        title: "Confirm closure",
        description:
          "Confirm the grant/token is revoked tenant-wide, no other users remain affected, and no persistence remains.",
        offsetMinutes: 240,
        isRequired: true,
        phase: "closure",
      },
    ],
    content: {
      purpose:
        "Cut off attacker access that survives a normal password reset — a malicious OAuth grant or a stolen session/refresh token — before it is used for further access.",
      triggers: [
        "User consents to an OAuth application after a phishing lure (consent phishing).",
        "Identity provider or CASB alert for an unusual or high-risk OAuth application scope.",
        "Session/token anomaly: same session used from two implausible locations, or a token used after a reported device loss.",
      ],
      exclusions: [
        "A known, approved SaaS integration matching an existing vendor allowlist entry.",
      ],
      severityGuidance:
        "High by default given MFA is not sufficient to contain it. Critical if the application/token had access to mail, files, or admin-scoped resources, or if multiple users are affected.",
      evidenceToPreserve: [
        "OAuth application name, publisher/verification status, requested scopes, and consenting user(s).",
        "Session/token metadata: device fingerprint, IP, first/last seen.",
        "Activity log for actions performed under the grant or stolen token.",
      ],
      initialQuestions: [
        "What scopes did the application request (mail read, files, directory, admin)?",
        "Is the application newly registered/unverified, or from a known publisher?",
        "Has the same token or device fingerprint been used elsewhere in the tenant?",
        "What, if anything, did the attacker actually access using this grant/token?",
      ],
      decisionPoints: [
        "Escalate to business email compromise or data exfiltration handling based on what the grant/token was used to access.",
        "Decide whether to tenant-wide block the application (not just individual revocation) if it appears to be a targeted consent-phishing campaign.",
      ],
      approvalActions: [
        "Tenant-wide revocation/blocking of an OAuth application.",
        "Force sign-out and credential reset for every affected user.",
      ],
      communicationsOwners: [
        "Security/IT owns technical containment.",
        "Notify affected users individually if their mailbox/files were accessed.",
      ],
      closureCriteria: [
        "Application grant and/or stolen tokens fully revoked with no remaining active sessions.",
        "All affected users identified and remediated.",
        "Activity performed under the grant/token reviewed and any exposure documented.",
      ],
      followUpImprovements: [
        "Restrict end-user consent for third-party OAuth applications to admin-approved only.",
        "Enable continuous access evaluation / token binding where the identity provider supports it.",
      ],
      mitreTechniques: ["T1528", "T1550.001", "T1114.002", "T1098.001"],
      caseFieldsToCapture: [
        "Application name and publisher",
        "Scopes granted",
        "Users affected",
        "Activity performed under the grant/token",
      ],
    },
  },
  {
    key: "privileged_account_misuse",
    name: "Privileged-account misuse or unauthorised admin change",
    description:
      "Investigate a suspicious or unauthorised change made by an administrative account — new admin role grant, disabled security control, unexpected configuration change.",
    classification: "unauthorised_access",
    defaultSeverity: "critical",
    tags: ["identity", "privileged-access", "admin"],
    requiredObservableTypes: ["username", "hostname"],
    steps: [
      {
        title: "Confirm the change and who made it",
        description:
          "Identify the exact change (role grant, policy disabled, new admin created), the account that made it, and whether it was authorised.",
        offsetMinutes: 15,
        isRequired: true,
        phase: "triage",
      },
      {
        title: "Contain the privileged account",
        description:
          "If the change is unauthorised, disable or suspend the account and revoke active sessions while investigation continues.",
        offsetMinutes: 30,
        isRequired: true,
        phase: "containment",
        requiresApproval: true,
      },
      {
        title: "Revert the unauthorised change",
        description:
          "Restore the disabled control, remove the unauthorised role/admin grant, and confirm the environment is back to its intended configuration.",
        offsetMinutes: 60,
        isRequired: true,
        phase: "eradication",
        requiresApproval: true,
      },
      {
        title: "Review all actions taken by the account",
        description:
          "Audit every action the account took in the surrounding window, not just the flagged change, to find any other unauthorised activity.",
        offsetMinutes: 120,
        isRequired: true,
        phase: "scoping",
      },
      {
        title: "Check for new persistence created by the account",
        description:
          "Look for new admin accounts, service principals, API keys, or backdoor access created using the misused privilege.",
        offsetMinutes: 180,
        isRequired: true,
        phase: "eradication",
      },
      {
        title: "Escalate to leadership and confirm closure",
        description:
          "Brief leadership/HR if the account holder's own credentials were used deliberately (insider risk) rather than the account being compromised; close once all changes are reverted and validated.",
        offsetMinutes: 360,
        isRequired: true,
        phase: "closure",
      },
    ],
    content: {
      purpose:
        "Contain and reverse an unauthorised use of administrative privilege before it causes lasting damage to security controls or enables further compromise.",
      triggers: [
        "Security-control change alert (MFA policy disabled, audit logging disabled, firewall rule removed).",
        "New administrator/global-admin account created outside change management.",
        "Privileged account acting outside its normal pattern (time of day, resource, geography).",
      ],
      exclusions: [
        "A change confirmed against an approved change-management ticket, made by the assigned administrator.",
      ],
      severityGuidance:
        "Critical by default: privileged-account misuse can disable the very controls that would otherwise detect and contain other incidents. Downgrade only once confirmed authorised and low-impact.",
      evidenceToPreserve: [
        "Audit log entry for the change: actor, timestamp, before/after configuration.",
        "Sign-in details for the session that made the change.",
        "List of every other action taken by the account in the surrounding window.",
      ],
      initialQuestions: [
        "Was this change requested/approved through change management?",
        "Is this consistent with the account's normal role and working pattern?",
        "Could this be an account compromise (see account takeover playbook) rather than deliberate misuse?",
        "What security controls, if any, were weakened by the change?",
      ],
      decisionPoints: [
        "Treat as account takeover (not insider misuse) if sign-in evidence points to a compromised credential rather than the legitimate holder.",
        "Escalate to insider threat handling if evidence points to the account holder acting deliberately and without authorisation.",
        "Notify every team whose security control was disabled so they can independently verify no other exposure occurred during the gap.",
      ],
      approvalActions: [
        "Disabling or suspending a privileged/administrative account.",
        "Reverting a security-control configuration change.",
        "Removing an unauthorised admin role grant or service principal.",
      ],
      communicationsOwners: [
        "Security leadership owns the decision and stakeholder communication.",
        "HR/legal if the account holder appears to have acted deliberately.",
      ],
      closureCriteria: [
        "Unauthorised change fully reverted and verified.",
        "No other unauthorised action found in the account's activity window.",
        "Root cause determined: compromise, misuse, or process gap, with an owner for the fix.",
      ],
      followUpImprovements: [
        "Require a second approver (break-glass workflow) for high-impact security-control changes.",
        "Add alerting specifically for disablement of security controls, not just their misuse.",
      ],
      mitreTechniques: ["T1098", "T1562.001", "T1562.008", "T1078.003"],
      caseFieldsToCapture: [
        "Account and change made",
        "Change-management reference (if any)",
        "Security controls affected",
        "Confirmed compromise vs. deliberate misuse",
      ],
    },
  },
  {
    key: "exposed_secret_api_key",
    name: "Exposed secret or API key",
    description:
      "Respond to a credential, API key, or other secret exposed in a code repository, build log, ticket, chat message, or public location.",
    classification: "data_breach",
    defaultSeverity: "high",
    tags: ["secrets", "api-key", "credentials", "code-repo"],
    requiredObservableTypes: ["other"],
    steps: [
      {
        title: "Confirm the exposure and its scope",
        description:
          "Identify exactly what secret is exposed, where, since when, and who could have viewed it (public repo, internal-only, shared externally).",
        offsetMinutes: 15,
        isRequired: true,
        phase: "triage",
      },
      {
        title: "Revoke and rotate the secret immediately",
        description:
          "Revoke the exposed credential/API key at its issuing system and issue a replacement — do this before removing it from the exposed location, since removal alone does not invalidate a secret that may already be copied.",
        offsetMinutes: 30,
        isRequired: true,
        phase: "containment",
        requiresApproval: true,
      },
      {
        title: "Check for use by an unauthorised party",
        description:
          "Review the issuing system's access/audit logs for any use of the secret from an unfamiliar source since exposure began.",
        offsetMinutes: 60,
        isRequired: true,
        phase: "scoping",
      },
      {
        title: "Remove the exposure and purge history",
        description:
          "Remove the secret from the exposed location, including version-control history, cached copies, and any indexed/cached search results if it was public.",
        offsetMinutes: 90,
        isRequired: true,
        phase: "eradication",
      },
      {
        title: "Update dependent systems with the rotated secret",
        description:
          "Redeploy/update every service that used the old secret so nothing breaks after revocation, coordinating with the owning engineering team.",
        offsetMinutes: 150,
        isRequired: true,
        phase: "recovery",
      },
      {
        title: "Confirm closure",
        description:
          "Confirm the old secret is fully revoked, no unauthorised use occurred (or exposure is fully assessed if it did), and dependent systems are healthy on the new secret.",
        offsetMinutes: 240,
        isRequired: true,
        phase: "closure",
      },
    ],
    content: {
      purpose:
        "Revoke an exposed secret before it can be used, and confirm whether it already was.",
      triggers: [
        "Secret-scanning alert on a code repository, commit, or build log.",
        "A developer or third party reports a credential visible in a public location.",
        "A key/token appears in a support ticket, chat message, or shared document by mistake.",
      ],
      exclusions: [
        "A deliberately non-sensitive placeholder/example credential clearly marked as such and never valid.",
      ],
      severityGuidance:
        "Medium if caught immediately, exposure was internal-only, and revocation completes before any use. High if exposed publicly or for an extended period. Critical if there is confirmed unauthorised use, or the secret grants broad/administrative access.",
      evidenceToPreserve: [
        "Where the secret was found (repository, commit hash, log, message) and for how long it was exposed.",
        "Issuing system's access log entries around the exposure window.",
        "Confirmation of revocation time and new secret issuance.",
      ],
      initialQuestions: [
        "What does this secret grant access to?",
        "Was the exposure public (internet-indexable) or internal-only?",
        "How long was it exposed before detection?",
        "Is there any sign it has already been used by someone who shouldn't have it?",
      ],
      decisionPoints: [
        "Escalate to data exfiltration/exposure handling if the secret is confirmed to have been used to access or export data.",
        "Escalate to cloud workload compromise handling if the secret grants cloud infrastructure access and unauthorised use is confirmed.",
      ],
      approvalActions: [
        "Revoking a production credential/API key (coordinate timing with the owning team to avoid unplanned outage).",
        "Force-pushing to purge version-control history containing the secret.",
      ],
      communicationsOwners: [
        "Engineering/platform team owning the affected system.",
        "Security owns the incident record and confirms revocation/rotation completed.",
      ],
      closureCriteria: [
        "Old secret fully revoked and confirmed non-functional.",
        "No unauthorised use found, or all use investigated and documented.",
        "Dependent systems confirmed healthy on the rotated secret.",
      ],
      followUpImprovements: [
        "Add or tune pre-commit/CI secret scanning to catch this class of exposure earlier.",
        "Move the secret to a managed secrets store instead of static configuration if not already there.",
      ],
      mitreTechniques: ["T1552.001", "T1528", "T1078.004"],
      caseFieldsToCapture: [
        "Secret type and issuing system",
        "Exposure location and duration",
        "Confirmed unauthorised use (yes/no)",
        "Rotation completed at",
      ],
    },
  },
  {
    key: "data_exfiltration_exposure",
    name: "Data exfiltration or accidental public exposure",
    description:
      "Assess suspected data loss — deliberate exfiltration or an accidental public exposure (misconfigured share, storage bucket, or sent-to-wrong-recipient) — preserve facts, and support notification decisions.",
    classification: "data_breach",
    defaultSeverity: "critical",
    tags: ["data-loss", "privacy", "exfiltration"],
    requiredObservableTypes: ["url", "ip", "username"],
    steps: [
      {
        title: "Preserve source evidence",
        description:
          "Capture access logs, file names, recipient lists, and affected systems before anything is altered or auto-remediated.",
        offsetMinutes: 30,
        isRequired: true,
        phase: "triage",
      },
      {
        title: "Contain access",
        description:
          "Revoke sharing links, disable exposed credentials, close the misconfigured share/bucket, or otherwise cut off the exposure path.",
        offsetMinutes: 60,
        isRequired: true,
        phase: "containment",
        requiresApproval: true,
      },
      {
        title: "Classify the exposed data",
        description:
          "Determine data types, sensitivity, approximate record count, jurisdictions involved, and business owner.",
        offsetMinutes: 120,
        isRequired: true,
        phase: "scoping",
      },
      {
        title: "Determine who actually accessed the data",
        description:
          "Review access logs (not just exposure duration) to establish whether the data was actually viewed/downloaded, by whom, and from where.",
        offsetMinutes: 180,
        isRequired: true,
        phase: "scoping",
      },
      {
        title: "Escalate to legal and privacy owners",
        description:
          "Provide the facts needed for notification, contractual, and regulatory assessment — do not make notification decisions unilaterally.",
        offsetMinutes: 240,
        isRequired: true,
        phase: "communications",
        requiresApproval: true,
      },
      {
        title: "Prepare impact summary and confirm closure",
        description:
          "Document timeline, data involved, containment actions, residual risk, and next actions; close once legal/privacy has what it needs and containment is verified.",
        offsetMinutes: 480,
        isRequired: true,
        phase: "closure",
      },
    ],
    content: {
      purpose:
        "Establish the facts of a suspected data loss quickly and completely enough for legal/privacy to make an informed notification decision, while containing ongoing exposure.",
      triggers: [
        "DLP alert for large or sensitive data transfer.",
        "A misconfigured share, storage bucket, or export left publicly accessible.",
        "A user reports sending sensitive data to the wrong recipient or distribution list.",
      ],
      exclusions: [
        "A confirmed, policy-compliant data transfer to an approved partner under an existing agreement.",
      ],
      severityGuidance:
        "Medium for a narrow, quickly-contained accidental internal exposure. High for exposure involving personal or confidential business data outside the organisation. Critical for large-scale, publicly indexed exposure, regulated data categories, or confirmed external access/download.",
      evidenceToPreserve: [
        "Access/download logs for the exposed resource, before and during containment.",
        "Exact configuration that caused the exposure (share permissions, bucket policy, recipient list).",
        "File/record inventory and approximate volume.",
      ],
      initialQuestions: [
        "What data is involved, and how sensitive is it (personal data, credentials, financial, health)?",
        "How long was it exposed, and to whom (specific person, whole organisation, public internet)?",
        "Is there log evidence of actual access, or only potential exposure?",
        "Are there contractual or regulatory notification obligations that may apply?",
      ],
      decisionPoints: [
        "Legal/privacy decides on regulatory or customer notification — the case record should give them everything needed but the decision is theirs.",
        "Escalate to exposed-secret handling first if the exposure includes credentials/API keys, since those need immediate revocation independent of the broader assessment.",
      ],
      approvalActions: [
        "Revoking public/broad sharing on the exposed resource.",
        "Disabling an account or integration that caused the exposure.",
        "Any external or regulatory notification (owned by legal/privacy, not security).",
      ],
      communicationsOwners: [
        "Legal/privacy owns notification decisions and external communication.",
        "Data owner/business unit provides context on data sensitivity and impacted parties.",
        "Security owns technical containment and the factual case record.",
      ],
      closureCriteria: [
        "Exposure path fully closed and verified.",
        "Data classified and access reviewed.",
        "Legal/privacy has confirmed no further security input is needed for their assessment.",
      ],
      followUpImprovements: [
        "Add automated scanning/alerting for public sharing on sensitive data stores.",
        "Review default sharing permissions on the platform where the exposure occurred.",
      ],
      mitreTechniques: ["T1567", "T1530", "T1213"],
      caseFieldsToCapture: [
        "Data types and sensitivity",
        "Approximate record count",
        "Exposure duration and audience",
        "Confirmed access (yes/no)",
      ],
    },
  },
  {
    key: "lost_stolen_endpoint",
    name: "Lost or stolen endpoint",
    description:
      "Respond to a lost or stolen laptop, phone, or other endpoint that may hold organisation data or active credentials/sessions.",
    classification: "other",
    defaultSeverity: "medium",
    tags: ["endpoint", "device", "physical-security"],
    requiredObservableTypes: ["hostname", "other"],
    steps: [
      {
        title: "Confirm device, owner, and encryption state",
        description:
          "Identify the exact device, its owner, whether full-disk encryption was enabled, and whether it was locked/logged out at time of loss.",
        offsetMinutes: 15,
        isRequired: true,
        phase: "triage",
      },
      {
        title: "Revoke sessions and rotate credentials",
        description:
          "Revoke active sessions/tokens tied to the device and reset the owner's credentials as a precaution.",
        offsetMinutes: 30,
        isRequired: true,
        phase: "containment",
        requiresApproval: true,
      },
      {
        title: "Remote-lock or wipe the device",
        description:
          "Trigger a remote lock or wipe via MDM if enrolled; confirm last check-in location/time if available.",
        offsetMinutes: 45,
        isRequired: true,
        phase: "containment",
        requiresApproval: true,
      },
      {
        title: "Assess data exposure risk",
        description:
          "Determine what organisation data was stored locally or accessible via cached credentials, and whether encryption/lock state limits real exposure.",
        offsetMinutes: 90,
        isRequired: true,
        phase: "scoping",
      },
      {
        title: "Report loss/theft per policy",
        description:
          "Record the loss with the appropriate internal owner (asset management/security) and, for theft, note whether a police report was filed.",
        offsetMinutes: 120,
        isRequired: false,
        phase: "communications",
      },
      {
        title: "Confirm closure",
        description:
          "Confirm sessions revoked, device wiped/locked or written off, and data exposure risk assessed before closing.",
        offsetMinutes: 240,
        isRequired: true,
        phase: "closure",
      },
    ],
    content: {
      purpose:
        "Cut off any access the device still holds and establish the real (not theoretical) data-exposure risk from its loss.",
      triggers: [
        "User reports a lost or stolen laptop, phone, or tablet.",
        "MDM shows a device has gone offline unexpectedly outside of normal patterns.",
      ],
      exclusions: [
        "Device recovered by the owner within the same reporting conversation, with no indication anyone else accessed it.",
      ],
      severityGuidance:
        "Low if fully encrypted, locked, MDM-enrolled, and remote-wiped promptly with no sensitive local data. Medium as a sane default. High/critical if unencrypted, unlocked at time of loss, held privileged/cached credentials, or contained large amounts of sensitive data.",
      evidenceToPreserve: [
        "Device inventory record (owner, encryption state, MDM enrolment status).",
        "MDM last-check-in time/location and lock/wipe command confirmation.",
        "List of accounts/sessions active on the device at time of loss.",
      ],
      initialQuestions: [
        "Was the device encrypted and locked/logged out at the time of loss?",
        "Is it enrolled in MDM and reachable for remote lock/wipe?",
        "What organisation data or cached credentials were stored locally?",
        "Was it lost, or is theft suspected/confirmed?",
      ],
      decisionPoints: [
        "Escalate to data exfiltration/exposure handling if the device is confirmed unencrypted and held sensitive data at rest.",
        "Escalate to account takeover handling if there is evidence of sign-in activity from the device after the reported loss.",
      ],
      approvalActions: [
        "Remote wipe of a device (destructive; confirm the right device before triggering).",
        "Disabling the owner's accounts if further suspicious activity appears after the loss.",
      ],
      communicationsOwners: [
        "IT/security owns technical containment.",
        "Asset management owns the loss/theft record and any insurance or police-report follow-up.",
      ],
      closureCriteria: [
        "Sessions/credentials tied to the device revoked or rotated.",
        "Device locked, wiped, or confirmed unrecoverable and written off.",
        "Data exposure risk assessed and recorded, even if assessed as low.",
      ],
      followUpImprovements: [
        "Confirm full-disk encryption is enforced by policy on all endpoint classes.",
        "Review whether cached/offline credential lifetime on endpoints is appropriately short.",
      ],
      mitreTechniques: ["T1552.001", "T1078"],
      caseFieldsToCapture: [
        "Device type and owner",
        "Encryption/lock state at time of loss",
        "MDM remote action taken",
        "Data exposure risk assessment",
      ],
    },
  },
  {
    key: "insider_threat",
    name: "Insider threat",
    description:
      "Investigate suspected deliberate misuse of legitimate access by an employee, contractor, or partner — data theft, sabotage, policy circumvention, or unauthorised disclosure.",
    classification: "policy_violation",
    defaultSeverity: "high",
    tags: ["insider", "hr", "policy-violation"],
    requiredObservableTypes: ["username", "hostname"],
    steps: [
      {
        title: "Confirm the reported concern and legal basis to investigate",
        description:
          "Work with HR/legal from the outset to confirm the concern, applicable policy, and what monitoring/investigation is permitted before taking any technical action.",
        offsetMinutes: 30,
        isRequired: true,
        phase: "triage",
        requiresApproval: true,
      },
      {
        title: "Preserve evidence discreetly",
        description:
          "Collect access logs, file activity, and communications relevant to the concern without alerting the individual, per HR/legal guidance.",
        offsetMinutes: 60,
        isRequired: true,
        phase: "scoping",
      },
      {
        title: "Assess ongoing access risk",
        description:
          "Determine whether the individual currently has access that should be constrained while the investigation proceeds, balanced against tipping them off.",
        offsetMinutes: 120,
        isRequired: true,
        phase: "scoping",
      },
      {
        title: "Coordinate containment timing with HR/legal",
        description:
          "Any access restriction, suspension, or offboarding action is timed and approved jointly with HR/legal, not run unilaterally by security.",
        offsetMinutes: 180,
        isRequired: true,
        phase: "containment",
        requiresApproval: true,
      },
      {
        title: "Execute agreed containment",
        description:
          "Once approved, revoke or restrict access, collect device(s), and preserve all relevant evidence per the agreed plan.",
        offsetMinutes: 240,
        isRequired: true,
        phase: "eradication",
        requiresApproval: true,
      },
      {
        title: "Confirm closure",
        description:
          "Confirm the investigation concluded, access appropriately actioned, and the case record is retained per policy.",
        offsetMinutes: 480,
        isRequired: true,
        phase: "closure",
      },
    ],
    content: {
      purpose:
        "Investigate suspected deliberate misuse by someone with legitimate access, in a way that is defensible, proportionate, and coordinated with HR/legal from the start.",
      triggers: [
        "DLP or unusual-activity alert involving a departing or dissatisfied employee.",
        "A colleague or manager reports suspected data theft, sabotage, or policy violation.",
        "Unusual access pattern to sensitive systems inconsistent with the individual's role.",
      ],
      exclusions: [
        "Activity fully explained by an approved role change or legitimate project need.",
      ],
      severityGuidance:
        "Medium for a low-impact policy violation with no data risk. High as a sane default given reputational and legal sensitivity. Critical if large-scale data theft, sabotage of production systems, or safety risk is suspected.",
      evidenceToPreserve: [
        "Access and file-activity logs for the individual, scoped to what HR/legal has authorised.",
        "Timeline of the individual's role, access changes, and any relevant HR context (e.g. notice period) as provided by HR — do not investigate HR matters independently.",
      ],
      initialQuestions: [
        "What specifically triggered the concern, and who raised it?",
        "Is the individual currently employed, on notice, or already departed?",
        "What access does the individual currently hold, and is any of it unusually broad for their role?",
        "Has HR/legal confirmed what investigative steps are authorised?",
      ],
      decisionPoints: [
        "HR/legal decides whether and when to confront the individual, suspend access, or involve law enforcement — security provides facts, not the decision.",
        "Balance early containment (reduce risk) against evidence preservation (avoid tipping off the individual before evidence is secured).",
      ],
      approvalActions: [
        "Any access restriction, monitoring, or device collection targeting a specific named individual.",
        "Any suspension or offboarding action.",
      ],
      communicationsOwners: [
        "HR and legal jointly own the investigation and any action taken.",
        "Security provides technical evidence and containment only as directed.",
      ],
      closureCriteria: [
        "Investigation concluded with HR/legal sign-off.",
        "Access appropriately actioned (restricted, restored, or offboarding completed).",
        "Case record retained per the organisation's investigation retention policy.",
      ],
      followUpImprovements: [
        "Review access recertification cadence for roles with broad data access.",
        "Confirm offboarding checklists reliably revoke access same-day.",
      ],
      mitreTechniques: ["T1530", "T1213", "T1078.002"],
      caseFieldsToCapture: [
        "Individual's role and current access",
        "HR/legal authorisation reference",
        "Access actioned and when",
      ],
    },
  },
  {
    key: "cloud_workload_compromise",
    name: "Cloud workload or account compromise",
    description:
      "Respond to compromised cloud infrastructure credentials, an over-permissioned or leaked service principal, or unauthorised resource creation/access in a cloud account.",
    classification: "unauthorised_access",
    defaultSeverity: "critical",
    tags: ["cloud", "iam", "workload"],
    requiredObservableTypes: ["username", "ip", "hostname"],
    steps: [
      {
        title: "Confirm the compromised identity/resource",
        description:
          "Identify the specific IAM user, role, service principal, or workload identity involved, and what it has access to.",
        offsetMinutes: 15,
        isRequired: true,
        phase: "triage",
      },
      {
        title: "Revoke credentials and sessions",
        description:
          "Disable or rotate the compromised credential/key, and revoke active sessions or temporary security tokens issued under it.",
        offsetMinutes: 30,
        isRequired: true,
        phase: "containment",
        requiresApproval: true,
      },
      {
        title: "Contain affected workloads",
        description:
          "Isolate or quarantine affected compute instances/containers (network isolation, security-group lockdown) without destroying forensic evidence.",
        offsetMinutes: 60,
        isRequired: true,
        phase: "containment",
        requiresApproval: true,
      },
      {
        title: "Scope unauthorised resources and changes",
        description:
          "Review cloud audit logs for resources created, permissions changed, or data accessed/exported using the compromised identity.",
        offsetMinutes: 120,
        isRequired: true,
        phase: "scoping",
      },
      {
        title: "Remove unauthorised resources and persistence",
        description:
          "Delete attacker-created resources (new IAM users/keys, compute instances, storage buckets) and remove any backdoor access.",
        offsetMinutes: 180,
        isRequired: true,
        phase: "eradication",
        requiresApproval: true,
      },
      {
        title: "Confirm closure and cost/impact review",
        description:
          "Confirm no unauthorised resources remain, review unexpected billing/cost impact, and close once the environment is verified clean.",
        offsetMinutes: 360,
        isRequired: true,
        phase: "closure",
      },
    ],
    content: {
      purpose:
        "Contain compromised cloud credentials or workloads before they are used to create persistence, access data, or run up unauthorised resource usage.",
      triggers: [
        "Cloud provider security alert (leaked key, anomalous API activity, unfamiliar region usage).",
        "Unexpected spike in compute/storage costs suggesting unauthorised resource use (e.g. cryptomining).",
        "New IAM user/role or access-key creation not tied to a change record.",
      ],
      exclusions: [
        "Activity fully explained by an approved infrastructure change or scaling event.",
      ],
      severityGuidance:
        "High for a single compromised, narrowly-scoped credential caught quickly. Critical for a credential with broad/administrative IAM permissions, evidence of data access/exfiltration, or attacker-created persistence.",
      evidenceToPreserve: [
        "Cloud audit/API activity log (CloudTrail-equivalent) for the affected identity.",
        "IAM policy/role definition at time of compromise.",
        "List of resources created, modified, or deleted during the compromise window.",
        "Snapshot/image of affected compute resources before termination, where forensically relevant.",
      ],
      initialQuestions: [
        "What permissions did the compromised identity actually have?",
        "How was the credential likely obtained (leaked key, phished console access, exposed secret)?",
        "Were any resources created, data buckets accessed, or egress connections made?",
        "Is this identity used by automation that will break when revoked — who needs to know before containment?",
      ],
      decisionPoints: [
        "Escalate to exposed-secret handling first if the root cause is a leaked key found in code/config.",
        "Escalate to data exfiltration handling if storage/data access is confirmed.",
        "Decide whether to preserve a forensic snapshot before terminating a compromised instance.",
      ],
      approvalActions: [
        "Disabling/rotating a credential or key used by production automation.",
        "Terminating or isolating a running cloud workload.",
        "Deleting attacker-created IAM principals or resources.",
      ],
      communicationsOwners: [
        "Platform/cloud engineering owns technical containment and recovery.",
        "Finance/FinOps if there is a material unexpected cost impact.",
      ],
      closureCriteria: [
        "Compromised credential fully revoked/rotated with no remaining valid sessions.",
        "All attacker-created resources and persistence removed.",
        "Cost/impact assessed and any billing anomaly explained.",
      ],
      followUpImprovements: [
        "Move to short-lived credentials/workload identity instead of long-lived static keys.",
        "Add alerting for IAM principal creation and unfamiliar-region resource creation.",
      ],
      mitreTechniques: ["T1078.004", "T1098.001", "T1496", "T1530"],
      caseFieldsToCapture: [
        "Identity/resource compromised",
        "Cloud provider and account/subscription",
        "Resources created/accessed by the attacker",
        "Estimated cost impact",
      ],
    },
  },
  {
    key: "web_application_waf_attack",
    name: "Web application/WAF attack",
    description:
      "Respond to an attack against a public-facing web application — exploitation attempt, WAF-blocked attack wave, or a confirmed successful compromise (e.g. injection, deserialization, auth bypass).",
    classification: "unauthorised_access",
    defaultSeverity: "high",
    tags: ["web", "waf", "application"],
    requiredObservableTypes: ["ip", "url"],
    steps: [
      {
        title: "Confirm attack type and whether it succeeded",
        description:
          "Review WAF/application logs to identify the attack technique, targeted endpoint(s), and whether any request bypassed protection and reached the application/database.",
        offsetMinutes: 15,
        isRequired: true,
        phase: "triage",
      },
      {
        title: "Apply or tighten WAF/virtual-patch mitigation",
        description:
          "Add or tighten a WAF rule for the specific attack pattern, or temporarily restrict/disable the affected endpoint if actively exploited and unmitigated.",
        offsetMinutes: 30,
        isRequired: true,
        phase: "containment",
        requiresApproval: true,
      },
      {
        title: "Assess for successful compromise",
        description:
          "If any request appears to have succeeded, check application/database logs, file integrity, and error logs for evidence of code execution, data access, or a planted web shell.",
        offsetMinutes: 60,
        isRequired: true,
        phase: "scoping",
      },
      {
        title: "Patch the underlying vulnerability",
        description:
          "Work with the application owner to patch or fix the underlying vulnerability, not just the WAF rule masking it.",
        offsetMinutes: 240,
        isRequired: true,
        phase: "eradication",
        requiresApproval: true,
      },
      {
        title: "Remove any planted persistence",
        description:
          "If a web shell or unauthorised code was found, remove it, rotate any credentials it could have accessed, and verify application integrity.",
        offsetMinutes: 300,
        isRequired: false,
        phase: "eradication",
        requiresApproval: true,
      },
      {
        title: "Confirm closure",
        description:
          "Confirm the vulnerability is patched, mitigation is validated, and no persistence remains before closing.",
        offsetMinutes: 480,
        isRequired: true,
        phase: "closure",
      },
    ],
    content: {
      purpose:
        "Stop an in-progress web application attack, confirm whether it succeeded, and fix the underlying weakness rather than relying only on the WAF block.",
      triggers: [
        "WAF alert for a blocked attack wave (injection, path traversal, known CVE exploitation attempt).",
        "Application error logs or anomalous response codes suggesting exploitation attempts.",
        "A scanner/bug-bounty report of a confirmed vulnerability being actively exploited.",
      ],
      exclusions: [
        "Authorised penetration test or vulnerability scan traffic from an approved source.",
      ],
      severityGuidance:
        "Medium for blocked attempts with no evidence of success. High as a sane default for an internet-facing application under active attack. Critical for confirmed successful exploitation, data access, or remote code execution.",
      evidenceToPreserve: [
        "WAF/application access logs for the attack window (source IP, payload, targeted endpoint).",
        "Application/database error logs and any stack traces exposed.",
        "File integrity/timestamps for application code if a web shell is suspected.",
      ],
      initialQuestions: [
        "Which endpoint(s) were targeted, and what does that endpoint do (auth, file upload, admin function)?",
        "Did any request bypass the WAF and reach the application?",
        "Is there a known CVE or vulnerability class this maps to?",
        "Is the application internet-facing, and does it hold sensitive data?",
      ],
      decisionPoints: [
        "Escalate to data exfiltration handling if a successful attack accessed or exported data.",
        "Escalate to cloud workload compromise handling if the application runs on compromised cloud infrastructure with broader access.",
        "Decide whether to take the application offline temporarily if unmitigated active exploitation continues.",
      ],
      approvalActions: [
        "Temporarily disabling or restricting a production application/endpoint.",
        "Emergency patch deployment outside the normal release cadence.",
      ],
      communicationsOwners: [
        "Application/engineering owner for patching and deployment.",
        "Security owns WAF mitigation and the incident record.",
      ],
      closureCriteria: [
        "Underlying vulnerability patched (not just WAF-masked).",
        "No evidence of successful compromise, or all resulting exposure investigated and documented.",
        "Mitigation validated against the original attack pattern.",
      ],
      followUpImprovements: [
        "Add the vulnerability class to routine security testing/SAST-DAST coverage.",
        "Review whether the affected endpoint needs additional authentication or rate limiting.",
      ],
      mitreTechniques: ["T1190", "T1505.003", "T1059"],
      caseFieldsToCapture: [
        "Targeted endpoint(s)",
        "Attack technique/CVE reference",
        "Confirmed successful exploitation (yes/no)",
        "Patch/mitigation status",
      ],
    },
  },
  {
    key: "denial_of_service",
    name: "Denial of service or service disruption",
    description:
      "Coordinate response to a denial-of-service attack or another cause of critical service unavailability.",
    classification: "dos",
    defaultSeverity: "high",
    tags: ["availability", "dos", "network"],
    requiredObservableTypes: ["ip", "url"],
    steps: [
      {
        title: "Confirm impact and affected service",
        description:
          "Identify user impact, service owner, affected region, symptom, and start time.",
        offsetMinutes: 15,
        isRequired: true,
        phase: "triage",
      },
      {
        title: "Collect traffic and health signals",
        description:
          "Review WAF, CDN, load balancer, firewall, DNS, and application telemetry to characterise the attack (volumetric, protocol, or application-layer).",
        offsetMinutes: 30,
        isRequired: true,
        phase: "scoping",
      },
      {
        title: "Apply mitigation",
        description:
          "Enable rate limits, WAF/DDoS rules, upstream scrubbing/filtering, or failover as appropriate to the attack pattern.",
        offsetMinutes: 60,
        isRequired: true,
        phase: "containment",
        requiresApproval: true,
      },
      {
        title: "Open provider or infrastructure escalation",
        description:
          "Engage ISP, cloud, CDN, or platform support with evidence and the requested mitigation action.",
        offsetMinutes: 90,
        isRequired: false,
        phase: "containment",
      },
      {
        title: "Communicate service status",
        description:
          "Keep an incident communications owner updating internal stakeholders and, if customer-facing, a status page separate from the technical mitigation work.",
        offsetMinutes: 120,
        isRequired: true,
        phase: "communications",
      },
      {
        title: "Monitor recovery and document residual risk",
        description:
          "Track service health, customer impact, mitigation side effects, and follow-up work before closing.",
        offsetMinutes: 180,
        isRequired: true,
        phase: "recovery",
      },
    ],
    content: {
      purpose:
        "Restore service availability as quickly as possible and capture enough evidence to tune defences against a repeat attack.",
      triggers: [
        "Sudden, sustained spike in traffic/errors correlated with a specific service.",
        "CDN/DDoS provider alert for an active mitigation event.",
        "Users or monitoring report a service is unreachable or severely degraded.",
      ],
      exclusions: [
        "A confirmed capacity/deployment issue with no attack indicators (route to standard incident/change process instead).",
      ],
      severityGuidance:
        "Medium for a brief, low-impact disruption fully absorbed by existing mitigation. High as a sane default for a customer-visible outage. Critical for an extended outage of a business-critical service or one affecting safety/compliance obligations.",
      evidenceToPreserve: [
        "Traffic/telemetry samples showing the attack pattern (source distribution, protocol, request characteristics).",
        "Timeline of impact start, mitigation applied, and recovery.",
        "Provider/vendor correspondence and ticket references.",
      ],
      initialQuestions: [
        "Which service(s) are affected, and what is the user-facing impact?",
        "Is this volumetric (network-layer) or application-layer (e.g. targeted at a specific expensive endpoint)?",
        "Is existing DDoS/CDN protection engaged, and is it holding?",
        "Is there a plausible motive (extortion note, coincides with another event) worth noting for the case record?",
      ],
      decisionPoints: [
        "Decide whether to fail over to a secondary region/provider versus riding out mitigation in place.",
        "Escalate to leadership/communications if the outage is customer-visible and prolonged.",
      ],
      approvalActions: [
        "Enabling aggressive rate limiting or geo-blocking that may affect legitimate users.",
        "Failover to alternate infrastructure or provider.",
      ],
      communicationsOwners: [
        "Incident communications owner (separate from the engineer doing technical mitigation) for status updates.",
        "Customer support/communications for any customer-visible status page update.",
      ],
      closureCriteria: [
        "Service restored to normal performance for a sustained period.",
        "Mitigation confirmed effective against the observed attack pattern.",
        "Residual risk and any mitigation side effects documented.",
      ],
      followUpImprovements: [
        "Tune DDoS/WAF thresholds based on the observed attack profile.",
        "Review capacity/scaling headroom for the affected service.",
      ],
      mitreTechniques: ["T1498", "T1499"],
      caseFieldsToCapture: [
        "Affected service(s) and region",
        "Attack pattern (volumetric/protocol/application-layer)",
        "Mitigation applied",
        "Outage duration",
      ],
    },
  },
  {
    key: "dns_domain_compromise",
    name: "DNS or domain compromise",
    description:
      "Respond to unauthorised changes to DNS records, domain registrar account compromise, or evidence of DNS hijacking/typosquatting affecting the organisation.",
    classification: "unauthorised_access",
    defaultSeverity: "high",
    tags: ["dns", "domain", "registrar"],
    requiredObservableTypes: ["domain", "ip"],
    steps: [
      {
        title: "Confirm the unauthorised change",
        description:
          "Identify exactly which DNS record(s) or registrar settings changed, when, and from which account/session.",
        offsetMinutes: 15,
        isRequired: true,
        phase: "triage",
      },
      {
        title: "Secure the registrar/DNS account",
        description:
          "Reset credentials, revoke sessions, and confirm/enable registry lock and MFA on the registrar and DNS provider accounts.",
        offsetMinutes: 30,
        isRequired: true,
        phase: "containment",
        requiresApproval: true,
      },
      {
        title: "Revert unauthorised DNS/registrar changes",
        description:
          "Restore correct DNS records (MX, A/AAAA, NS, TXT/SPF-DKIM-DMARC) and registrar contact/nameserver settings.",
        offsetMinutes: 60,
        isRequired: true,
        phase: "eradication",
        requiresApproval: true,
      },
      {
        title: "Assess downstream impact",
        description:
          "Check whether mail delivery, TLS certificates, or dependent services were affected or could have been intercepted during the change window.",
        offsetMinutes: 120,
        isRequired: true,
        phase: "scoping",
      },
      {
        title: "Notify affected teams and monitor propagation",
        description:
          "Alert application/email owners of the change and monitor DNS propagation and certificate validity as records take effect globally.",
        offsetMinutes: 180,
        isRequired: false,
        phase: "communications",
      },
      {
        title: "Confirm closure",
        description:
          "Confirm DNS/registrar records are correct and stable, account access is secured, and no downstream service remains affected.",
        offsetMinutes: 360,
        isRequired: true,
        phase: "closure",
      },
    ],
    content: {
      purpose:
        "Restore correct, authoritative DNS and registrar control quickly — a short DNS hijack window can intercept mail and traffic for the whole domain.",
      triggers: [
        "Registrar/DNS provider alert for a configuration or account change.",
        "Unexpected mail delivery failures or certificate warnings suggesting DNS tampering.",
        "A report of the organisation's domain resolving to unfamiliar infrastructure.",
      ],
      exclusions: [
        "A DNS change confirmed against an approved change-management ticket.",
      ],
      severityGuidance:
        "Medium for a quickly caught, narrow record change with no evidence of traffic interception. High as a sane default given blast radius. Critical if mail (MX) or the primary web record was hijacked, especially if traffic was demonstrably intercepted.",
      evidenceToPreserve: [
        "DNS zone/registrar change log (before/after values, actor, timestamp).",
        "Sign-in log for the registrar/DNS provider account.",
        "Any evidence of intercepted mail or traffic during the change window.",
      ],
      initialQuestions: [
        "Which records changed, and what do they control (mail, web, verification, subdomains)?",
        "Was the registrar/DNS account itself compromised, or was this an authorised-looking change from a compromised session?",
        "Is registry lock/transfer lock and MFA enabled on the account now?",
        "Could mail or web traffic have been intercepted during the change window?",
      ],
      decisionPoints: [
        "Escalate to business email compromise handling if MX records were changed and mail may have been intercepted.",
        "Escalate to data exfiltration handling if traffic interception is confirmed to have exposed data in transit.",
      ],
      approvalActions: [
        "Reverting production DNS records.",
        "Resetting registrar account credentials (may require coordinating with the registrar's support/verification process).",
      ],
      communicationsOwners: [
        "Security/IT owns technical remediation.",
        "Application/email owners need to know once records are reverted so they can confirm normal operation.",
      ],
      closureCriteria: [
        "All DNS/registrar records confirmed correct and stable.",
        "Registrar/DNS account secured with MFA and registry lock where supported.",
        "Downstream impact (mail, certificates, dependent services) assessed and resolved.",
      ],
      followUpImprovements: [
        "Enable registry lock/transfer lock if not already active.",
        "Add monitoring/alerting for authoritative DNS record changes.",
      ],
      mitreTechniques: ["T1584.001", "T1071.004", "T1557"],
      caseFieldsToCapture: [
        "Domain and records affected",
        "Registrar/DNS provider",
        "Change window duration",
        "Downstream services impacted",
      ],
    },
  },
  {
    key: "third_party_vendor_compromise",
    name: "Third-party or vendor compromise",
    description:
      "Assess and respond to a security incident at a third-party vendor, supplier, or service provider that has access to organisation systems or data.",
    classification: "other",
    defaultSeverity: "high",
    tags: ["vendor", "supply-chain", "third-party"],
    requiredObservableTypes: ["domain", "ip", "other"],
    steps: [
      {
        title: "Confirm the vendor's disclosure and scope",
        description:
          "Gather the vendor's notification, affected systems/data, timeline, and what access that vendor has into the organisation's environment.",
        offsetMinutes: 30,
        isRequired: true,
        phase: "triage",
      },
      {
        title: "Contain the vendor's access as a precaution",
        description:
          "Disable or restrict the vendor's integration, API keys, VPN access, or account access pending assessment, balanced against business impact of doing so.",
        offsetMinutes: 60,
        isRequired: true,
        phase: "containment",
        requiresApproval: true,
      },
      {
        title: "Assess exposure on our side",
        description:
          "Review what organisation data or systems the vendor could reach, and check logs for any unusual activity via the vendor's access/integration.",
        offsetMinutes: 120,
        isRequired: true,
        phase: "scoping",
      },
      {
        title: "Rotate shared credentials and secrets",
        description:
          "Rotate any API keys, passwords, or certificates shared with or known to the vendor.",
        offsetMinutes: 180,
        isRequired: true,
        phase: "eradication",
        requiresApproval: true,
      },
      {
        title: "Coordinate with the vendor and internal stakeholders",
        description:
          "Track the vendor's remediation status, request evidence relevant to your exposure, and keep the business owner of the vendor relationship informed.",
        offsetMinutes: 240,
        isRequired: true,
        phase: "communications",
      },
      {
        title: "Confirm closure",
        description:
          "Confirm shared credentials rotated, no unusual activity found via the vendor's access (or all found activity investigated), and the vendor has confirmed remediation.",
        offsetMinutes: 480,
        isRequired: true,
        phase: "closure",
      },
    ],
    content: {
      purpose:
        "Contain the organisation's exposure to a third party's security incident, independent of when (or whether) the vendor fully remediates on their end.",
      triggers: [
        "A vendor discloses a security incident that may affect shared data or access.",
        "News/threat-intel report of a breach at a vendor or supplier used by the organisation.",
        "Unusual activity observed via a vendor integration, API key, or account.",
      ],
      exclusions: [
        "A vendor advisory confirmed not to involve any system, data, or integration used by the organisation.",
      ],
      severityGuidance:
        "Medium if the vendor's access/data footprint with the organisation is narrow and low-sensitivity. High as a sane default given limited visibility into the vendor's environment. Critical if the vendor holds broad access, sensitive data, or there is evidence the compromise reached the organisation's own environment.",
      evidenceToPreserve: [
        "The vendor's disclosure/notification and any evidence they provide.",
        "Inventory of what access, data, and integrations the vendor has with the organisation.",
        "Internal log review for unusual activity tied to the vendor's access.",
      ],
      initialQuestions: [
        "What access does this vendor have into our environment (API, VPN, SSO, data feed)?",
        "What data of ours could the vendor's compromise have exposed?",
        "Is there any sign the compromise reached into our own environment via that access?",
        "What is the vendor's remediation timeline and point of contact?",
      ],
      decisionPoints: [
        "Decide whether to suspend the vendor integration/access before full assessment completes, weighed against business disruption.",
        "Escalate to data exfiltration/exposure handling if the vendor confirms our data was accessed or exported.",
        "Escalate to legal/procurement if contractual security obligations were breached.",
      ],
      approvalActions: [
        "Suspending or restricting a vendor's access/integration.",
        "Rotating credentials shared with the vendor.",
      ],
      communicationsOwners: [
        "Business owner of the vendor relationship for coordination and contract terms.",
        "Security owns technical exposure assessment and containment.",
        "Legal/procurement if contractual notification or remedy applies.",
      ],
      closureCriteria: [
        "Shared credentials/secrets rotated.",
        "No unusual activity found via the vendor's access, or all findings investigated.",
        "Vendor has confirmed remediation, or access remains restricted pending that confirmation.",
      ],
      followUpImprovements: [
        "Add the vendor's incident to the next vendor risk review cycle.",
        "Review whether the vendor's access scope can be narrowed going forward.",
      ],
      mitreTechniques: ["T1195.002", "T1199", "T1078.002"],
      caseFieldsToCapture: [
        "Vendor name and system/service",
        "Access/data the vendor can reach",
        "Vendor remediation status",
        "Internal exposure assessment outcome",
      ],
    },
  },
  {
    key: "malicious_ioc_match",
    name: "Confirmed malicious IP, URL, domain, or file-hash match",
    description:
      "Handle a confirmed match between organisation activity (network traffic, endpoint, or file) and a known-malicious IP, URL, domain, or file hash from threat intelligence.",
    classification: "malware",
    defaultSeverity: "medium",
    tags: ["threat-intel", "ioc", "match"],
    requiredObservableTypes: ["ip", "url", "domain", "file_hash"],
    steps: [
      {
        title: "Confirm the match and its context",
        description:
          "Verify the indicator, its threat-intel source/confidence, and exactly where the match occurred (which host, user, connection, or file).",
        offsetMinutes: 15,
        isRequired: true,
        phase: "triage",
      },
      {
        title: "Determine direction and stage of activity",
        description:
          "Establish whether this was inbound (attack attempt), outbound (possible C2/beaconing), or a static file match, and whether the connection/execution succeeded or was blocked.",
        offsetMinutes: 30,
        isRequired: true,
        phase: "scoping",
      },
      {
        title: "Contain the affected host/account",
        description:
          "If the match indicates active compromise (successful outbound C2, executed malicious file), isolate the host and/or contain the account per the malware or account-takeover playbook as appropriate.",
        offsetMinutes: 60,
        isRequired: true,
        phase: "containment",
        requiresApproval: true,
      },
      {
        title: "Search for the same indicator elsewhere",
        description:
          "Check whether the same IP/URL/domain/hash appears anywhere else in the environment to establish full scope.",
        offsetMinutes: 90,
        isRequired: true,
        phase: "scoping",
      },
      {
        title: "Block the indicator organisation-wide",
        description:
          "Add the confirmed indicator to firewall/proxy/EDR/mail blocklists so it cannot be reached or executed again.",
        offsetMinutes: 120,
        isRequired: true,
        phase: "containment",
      },
      {
        title: "Confirm closure",
        description:
          "Confirm the indicator is blocked everywhere relevant, any affected host/account is remediated, and no further matches appear.",
        offsetMinutes: 240,
        isRequired: true,
        phase: "closure",
      },
    ],
    content: {
      purpose:
        "Turn a threat-intelligence match into a fast, consistent decision: is this just noise that was already blocked, or does it indicate a live compromise that needs full incident handling?",
      triggers: [
        "Firewall/proxy/EDR blocks a connection to a known-malicious IP, URL, or domain.",
        "A file hash matches a known-malicious hash in threat intelligence.",
        "An external threat-intel feed or partner reports the organisation's infrastructure matched against a known indicator.",
      ],
      exclusions: [
        "A stale/expired indicator confirmed to no longer be malicious (verify against the source before excluding, never assume).",
      ],
      severityGuidance:
        "Low/medium when the connection or file was blocked before any effect and there is no other suspicious activity on the host. High/critical when the connection succeeded, the file executed, or the indicator is tied to a known high-impact campaign (ransomware C2, targeted actor).",
      evidenceToPreserve: [
        "The matched indicator (IP, URL, domain, or file hash) and its threat-intel source/confidence.",
        "The specific host, user, or connection log entry that produced the match.",
        "Whether the connection/execution was blocked or succeeded.",
      ],
      initialQuestions: [
        "Was the activity blocked, or did the connection/execution succeed?",
        "What is the confidence and context of the threat-intel source (known campaign, generic scanning, high-confidence C2)?",
        "Does this host/account have any other suspicious activity around the same time?",
        "Has the same indicator been seen elsewhere in the environment?",
      ],
      decisionPoints: [
        "Escalate to full malware/ransomware containment handling if the match reflects a successful connection or executed file, not just a blocked attempt.",
        "Escalate to account takeover handling if the match involves a user's credentials or session rather than a host/file.",
        "Close quickly (with the indicator blocked) when the activity was blocked pre-execution and no other signal supports further investigation.",
      ],
      approvalActions: [
        "Isolating a host where the indicator match indicates active compromise.",
        "Organisation-wide blocking of an indicator that could affect legitimate business traffic (rare, but verify before blocking a shared/CDN IP).",
      ],
      communicationsOwners: [
        "Security/IT owns the technical response.",
        "No external communication required unless escalated to a broader incident.",
      ],
      closureCriteria: [
        "Indicator confirmed blocked across relevant control points.",
        "Any affected host/account fully investigated and remediated if compromise is confirmed.",
        "No further matches for the same indicator observed for a full monitoring cycle.",
      ],
      followUpImprovements: [
        "Confirm the indicator is retained in the organisation's threat-intelligence store with the case reference.",
        "If this indicator recurs often, review whether an upstream control (DNS filtering, egress proxy) should block it earlier.",
      ],
      mitreTechniques: ["T1071", "T1105", "T1204.002"],
      caseFieldsToCapture: [
        "Indicator type and value",
        "Threat-intel source and confidence",
        "Blocked vs. succeeded",
        "Other systems matching the same indicator",
      ],
    },
  },
];

/**
 * One case template per baseline scenario, each linked to its playbook via
 * `playbookKey`. Seeding resolves `playbookKey` to the actual playbook id
 * created (or already present) for the organisation.
 */
export const BASELINE_TEMPLATES: BaselineTemplate[] = [
  {
    key: "reported_phishing",
    playbookKey: "reported_phishing",
    name: "Reported phishing",
    classification: "phishing",
    defaultSeverity: "medium",
    defaultTlp: "amber",
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
    key: "business_email_compromise",
    playbookKey: "business_email_compromise",
    name: "Business email compromise",
    classification: "unauthorised_access",
    defaultSeverity: "high",
    defaultTlp: "amber_strict",
    defaultTags: ["email", "fraud"],
    defaultDataClassificationTags: ["financial", "credentials"],
    summaryTemplate:
      "Reported on {{date}} by {{reporter}}.\n\nMailbox:\nCompromise or spoof:\nFraudulent request sent:\nPayment impact:\n\nImmediate actions:",
    defaultTasks: [
      {
        title: "Confirm whether any payment was made on the fraudulent instruction",
        description: "Contact finance/payroll through a known-good channel immediately.",
      },
    ],
  },
  {
    key: "malware_ransomware",
    playbookKey: "malware_ransomware",
    name: "Endpoint malware or ransomware",
    classification: "malware",
    defaultSeverity: "high",
    defaultTlp: "amber",
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
    key: "account_takeover_signin_mfa_fatigue",
    playbookKey: "account_takeover_signin_mfa_fatigue",
    name: "Suspicious account activity",
    classification: "unauthorised_access",
    defaultSeverity: "high",
    defaultTlp: "amber",
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
    key: "malicious_oauth_token_theft",
    playbookKey: "malicious_oauth_token_theft",
    name: "Malicious OAuth grant or token theft",
    classification: "unauthorised_access",
    defaultSeverity: "high",
    defaultTlp: "amber",
    defaultTags: ["identity", "oauth"],
    defaultDataClassificationTags: ["credentials"],
    summaryTemplate:
      "Reported on {{date}} by {{reporter}}.\n\nApplication/token:\nScopes or access:\nUsers affected:\nActivity observed:\n\nImmediate actions:",
    defaultTasks: [
      {
        title: "Revoke the application grant or session token",
        description: "Do this before or alongside a password reset — a reset alone does not revoke it.",
      },
    ],
  },
  {
    key: "privileged_account_misuse",
    playbookKey: "privileged_account_misuse",
    name: "Privileged-account misuse or unauthorised admin change",
    classification: "unauthorised_access",
    defaultSeverity: "critical",
    defaultTlp: "amber_strict",
    defaultTags: ["identity", "privileged-access"],
    defaultDataClassificationTags: ["internal"],
    summaryTemplate:
      "Reported on {{date}} by {{reporter}}.\n\nAccount:\nChange made:\nAuthorised (yes/no):\nSecurity controls affected:\n\nImmediate actions:",
    defaultTasks: [
      {
        title: "Confirm whether the change matches an approved change-management record",
        description: "Check before assuming the change was unauthorised.",
      },
    ],
  },
  {
    key: "exposed_secret_api_key",
    playbookKey: "exposed_secret_api_key",
    name: "Exposed secret or API key",
    classification: "data_breach",
    defaultSeverity: "high",
    defaultTlp: "amber",
    defaultTags: ["secrets", "code-repo"],
    defaultDataClassificationTags: ["credentials"],
    summaryTemplate:
      "Reported on {{date}} by {{reporter}}.\n\nSecret type:\nExposure location:\nExposure duration:\nSystems affected:\n\nRevocation status:",
    defaultTasks: [
      {
        title: "Revoke the exposed secret at its issuing system",
        description: "Revoke and rotate before removing it from the exposed location.",
      },
    ],
  },
  {
    key: "data_exfiltration_exposure",
    playbookKey: "data_exfiltration_exposure",
    name: "Potential data exposure",
    classification: "data_breach",
    defaultSeverity: "critical",
    defaultTlp: "amber_strict",
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
    key: "lost_stolen_endpoint",
    playbookKey: "lost_stolen_endpoint",
    name: "Lost or stolen endpoint",
    classification: "other",
    defaultSeverity: "medium",
    defaultTlp: "amber",
    defaultTags: ["endpoint", "device"],
    defaultDataClassificationTags: ["internal"],
    summaryTemplate:
      "Reported on {{date}} by {{reporter}}.\n\nDevice:\nOwner:\nEncrypted (yes/no):\nMDM enrolled (yes/no):\nLast known location/time:\n\nActions taken:",
    defaultTasks: [
      {
        title: "Trigger remote lock or wipe via MDM",
        description: "Confirm the device's enrolment status before attempting.",
      },
    ],
  },
  {
    key: "insider_threat",
    playbookKey: "insider_threat",
    name: "Insider threat investigation",
    classification: "policy_violation",
    defaultSeverity: "high",
    defaultTlp: "red",
    defaultTags: ["insider", "hr"],
    defaultDataClassificationTags: ["confidential", "legal-privileged"],
    summaryTemplate:
      "Reported on {{date}} by {{reporter}}.\n\nIndividual's role:\nConcern raised:\nHR/legal contact:\nAuthorisation to investigate confirmed (yes/no):\n\nNotes:",
    defaultTasks: [
      {
        title: "Confirm HR/legal authorisation before any technical investigation step",
        description: "Do not collect evidence on a named individual without this confirmed first.",
      },
    ],
  },
  {
    key: "cloud_workload_compromise",
    playbookKey: "cloud_workload_compromise",
    name: "Cloud workload or account compromise",
    classification: "unauthorised_access",
    defaultSeverity: "critical",
    defaultTlp: "amber",
    defaultTags: ["cloud", "iam"],
    defaultDataClassificationTags: ["internal"],
    summaryTemplate:
      "Reported on {{date}} by {{reporter}}.\n\nCloud provider/account:\nIdentity/resource affected:\nResources created or accessed:\nEstimated cost impact:\n\nImmediate actions:",
    defaultTasks: [
      {
        title: "Identify what the compromised identity had permission to access",
        description: "Pull the current IAM policy/role definition before revoking, for the investigation record.",
      },
    ],
  },
  {
    key: "web_application_waf_attack",
    playbookKey: "web_application_waf_attack",
    name: "Web application or WAF attack",
    classification: "unauthorised_access",
    defaultSeverity: "high",
    defaultTlp: "amber",
    defaultTags: ["web", "application"],
    defaultDataClassificationTags: ["internal"],
    summaryTemplate:
      "Reported on {{date}} by {{reporter}}.\n\nApplication/endpoint:\nAttack technique:\nBlocked or succeeded:\nData/systems at risk:\n\nMitigation applied:",
    defaultTasks: [
      {
        title: "Notify the application owner",
        description: "The underlying vulnerability needs a real fix, not just a WAF rule.",
      },
    ],
  },
  {
    key: "denial_of_service",
    playbookKey: "denial_of_service",
    name: "Critical service outage or denial of service",
    classification: "dos",
    defaultSeverity: "high",
    defaultTlp: "amber",
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
  {
    key: "dns_domain_compromise",
    playbookKey: "dns_domain_compromise",
    name: "DNS or domain compromise",
    classification: "unauthorised_access",
    defaultSeverity: "high",
    defaultTlp: "amber",
    defaultTags: ["dns", "domain"],
    defaultDataClassificationTags: ["internal"],
    summaryTemplate:
      "Reported on {{date}} by {{reporter}}.\n\nDomain:\nRecords changed:\nRegistrar/DNS provider:\nChange window:\n\nImmediate actions:",
    defaultTasks: [
      {
        title: "Confirm registry lock and MFA status on the registrar account",
        description: "Enable both immediately if not already active.",
      },
    ],
  },
  {
    key: "third_party_vendor_compromise",
    playbookKey: "third_party_vendor_compromise",
    name: "Third-party or vendor compromise",
    classification: "other",
    defaultSeverity: "high",
    defaultTlp: "amber",
    defaultTags: ["vendor", "supply-chain"],
    defaultDataClassificationTags: ["internal"],
    summaryTemplate:
      "Reported on {{date}} by {{reporter}}.\n\nVendor:\nAccess/data the vendor holds:\nVendor's disclosed timeline:\nOur exposure assessment:\n\nActions taken:",
    defaultTasks: [
      {
        title: "Inventory the vendor's access and integrations into our environment",
        description: "Needed before deciding whether/how much to restrict while assessing exposure.",
      },
    ],
  },
  {
    key: "malicious_ioc_match",
    playbookKey: "malicious_ioc_match",
    name: "Confirmed malicious indicator match",
    classification: "malware",
    defaultSeverity: "medium",
    defaultTlp: "amber",
    defaultTags: ["threat-intel", "ioc"],
    defaultDataClassificationTags: ["internal"],
    summaryTemplate:
      "Reported on {{date}} by {{reporter}}.\n\nIndicator:\nSource host/user:\nBlocked or succeeded:\nOther matches found:\n\nActions taken:",
    defaultTasks: [
      {
        title: "Confirm whether the connection/execution succeeded or was blocked",
        description: "This determines whether full malware or account-takeover handling is needed.",
      },
    ],
  },
];

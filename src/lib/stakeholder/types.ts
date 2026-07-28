/**
 * Restricted stakeholder portal types (issue #63).
 *
 * External collaborators never become org members. Access is invitation +
 * session scoped to one case and one purpose, with TLP/PAP ceilings.
 */

export const STAKEHOLDER_ROLES = [
  "update_reader",
  "evidence_provider",
  "respondent",
  "approver",
] as const;

export type StakeholderRole = (typeof STAKEHOLDER_ROLES)[number];

export const STAKEHOLDER_CAPABILITIES = [
  "view_updates",
  "read_receipt",
  "view_evidence_requests",
  "upload_evidence",
  "view_questions",
  "respond",
  "view_approvals",
  "approve",
] as const;

export type StakeholderCapability = (typeof STAKEHOLDER_CAPABILITIES)[number];

/** Discrete role templates — not cumulative ranks. */
export const ROLE_CAPABILITIES: Record<
  StakeholderRole,
  readonly StakeholderCapability[]
> = {
  update_reader: ["view_updates", "read_receipt"],
  evidence_provider: [
    "view_updates",
    "read_receipt",
    "view_evidence_requests",
    "upload_evidence",
  ],
  respondent: [
    "view_updates",
    "read_receipt",
    "view_questions",
    "respond",
  ],
  approver: [
    "view_updates",
    "read_receipt",
    "view_approvals",
    "approve",
  ],
};

export function roleHasCapability(
  role: StakeholderRole,
  capability: StakeholderCapability,
): boolean {
  return (ROLE_CAPABILITIES[role] as readonly string[]).includes(capability);
}

export const TLP_ORDER = [
  "clear",
  "green",
  "amber",
  "amber_strict",
  "red",
] as const;
export type StakeholderTlp = (typeof TLP_ORDER)[number];

export const PAP_ORDER = ["clear", "green", "amber", "red"] as const;
export type StakeholderPap = (typeof PAP_ORDER)[number];

export function tlpRank(tlp: string): number {
  const idx = (TLP_ORDER as readonly string[]).indexOf(tlp);
  return idx < 0 ? TLP_ORDER.length : idx;
}

export function papRank(pap: string): number {
  const idx = (PAP_ORDER as readonly string[]).indexOf(pap);
  return idx < 0 ? PAP_ORDER.length : idx;
}

export function withinTlpCeiling(value: string, maxTlp: StakeholderTlp): boolean {
  return tlpRank(value) <= tlpRank(maxTlp);
}

export function withinPapCeiling(value: string, maxPap: StakeholderPap): boolean {
  return papRank(value) <= papRank(maxPap);
}

export class StakeholderError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "StakeholderError";
    this.status = status;
  }
}

/** Safe redacted case summary shown to external parties. */
export type ExternalCaseView = {
  caseNumber: string;
  title: string;
  status: string;
  severity: string;
  tlp: string;
  pap: string;
  purpose: string;
  role: StakeholderRole;
  maxTlp: StakeholderTlp;
  maxPap: StakeholderPap;
  /** True when classification was redacted below case ceiling. */
  classificationRedacted: boolean;
};

export type ExternalUpdateView = {
  id: string;
  title: string;
  body: string;
  publishedAt: string;
  tlp: string;
  pap: string;
  read: boolean;
};

export type ExternalEvidenceRequestView = {
  id: string;
  title: string;
  instructions: string;
  status: string;
  dueAt: string | null;
  fulfilledAt: string | null;
};

export type ExternalApprovalView = {
  id: string;
  title: string;
  description: string;
  status: string;
  decisionNote: string | null;
  decidedAt: string | null;
};

export type ExternalPortalView = {
  case: ExternalCaseView;
  updates: ExternalUpdateView[];
  evidenceRequests: ExternalEvidenceRequestView[];
  approvals: ExternalApprovalView[];
  responses: Array<{
    id: string;
    body: string;
    createdAt: string;
    attribution: string;
  }>;
  capabilities: StakeholderCapability[];
  collaborator: {
    displayName: string;
    email: string;
    organisationLabel: string | null;
  };
};

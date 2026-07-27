export const AUTOMATION_TRIGGERS = [
  "case.created",
  "case.status_changed",
] as const;

export type AutomationTrigger = (typeof AUTOMATION_TRIGGERS)[number];

export const AUTOMATION_CONDITION_FIELDS = [
  "severity",
  "classification",
  "status",
  "tag",
  "source_system",
] as const;

export type AutomationConditionField =
  (typeof AUTOMATION_CONDITION_FIELDS)[number];

export type AutomationCondition = {
  field: AutomationConditionField;
  operator: "equals" | "not_equals" | "contains";
  value: string;
};

export type AutomationCaseSnapshot = {
  id: string;
  caseNumber: string;
  version: number;
  status: string;
  severity: string;
  classification: string;
  tlp: string;
  pap: string;
  tags: string[];
  sourceSystem: string | null;
};

export type MusterTriggerEnvelope = {
  version: "kelpie.agent-trigger.v1";
  event_id: string;
  event: AutomationTrigger;
  occurred_at: string;
  kelpie_org_ref: string;
  trace_id: string;
  target_profile: string;
  case: {
    id: string;
    number: string;
    version: number;
    status: string;
    severity: string;
    classification: string;
    tlp: string;
    pap: string;
    tags: string[];
    source_ref: string | null;
  };
  rule: {
    id: string;
    revision: number;
  };
};

import crypto from "node:crypto";
import type {
  AutomationCaseSnapshot,
  AutomationTrigger,
  MusterTriggerEnvelope,
} from "./types";

export function buildMusterTriggerEnvelope(input: {
  eventId: string;
  event: AutomationTrigger;
  occurredAt: Date;
  organisationId: string;
  traceId: string;
  targetProfile: string;
  ruleId: string;
  ruleRevision: number;
  snapshot: AutomationCaseSnapshot;
}): MusterTriggerEnvelope {
  return {
    version: "kelpie.agent-trigger.v1",
    event_id: input.eventId,
    event: input.event,
    occurred_at: input.occurredAt.toISOString(),
    kelpie_org_ref: input.organisationId,
    trace_id: input.traceId,
    target_profile: input.targetProfile,
    case: {
      id: input.snapshot.id,
      number: input.snapshot.caseNumber,
      version: input.snapshot.version,
      status: input.snapshot.status,
      severity: input.snapshot.severity,
      classification: input.snapshot.classification,
      tlp: input.snapshot.tlp,
      pap: input.snapshot.pap,
      tags: input.snapshot.tags,
      source_ref: input.snapshot.sourceSystem,
    },
    rule: {
      id: input.ruleId,
      revision: input.ruleRevision,
    },
  };
}

export function signAutomationEnvelope(body: string, secret: string): string {
  return `sha256=${crypto.createHmac("sha256", secret).update(body).digest("hex")}`;
}

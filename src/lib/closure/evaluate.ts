/**
 * Shared case-closure requirement evaluator (issue #57).
 *
 * `evaluateClosureRequirements` is pure over a pre-loaded context so UI,
 * REST, bulk/automation, and tests all share one implementation. Loading
 * lives in `loadClosureEvaluationContext` / `evaluateCaseClosure`.
 */
import { db } from "@/db";
import {
  alerts,
  caseAlerts,
  caseClosurePolicies,
  caseClosurePolicyVersions,
  caseRelationships,
  caseTasks,
  cases,
  customFieldDefinitions,
  customFieldValues,
  evidenceItems,
  responseActionRuns,
  type Case,
} from "@/db/schema";
import { and, eq, inArray, ne, or } from "drizzle-orm";
import type { CaseClassification, CaseSeverity } from "@/lib/cases-core";
import {
  BUILTIN_CLOSURE_REQUIREMENTS,
  CLOSURE_DETERMINATIONS,
  CLOSURE_DISPOSITIONS,
  CLOSURE_REQUIREMENT_TYPES,
  type ClosureDispositionInput,
  type ClosureEvaluation,
  type ClosureRequirementConfig,
  type ClosureRequirementResult,
  type ClosureRequirementType,
  type ResolvedClosurePolicy,
} from "./types";

const OPEN_RESPONSE_STATUSES = ["awaiting_approval", "running", "pending"] as const;

export type ClosureEvaluationContext = {
  case: Pick<
    Case,
    | "id"
    | "organisationId"
    | "status"
    | "severity"
    | "classification"
    | "templateId"
    | "containedAt"
    | "eradicatedAt"
    | "resolvedAt"
    | "closedAt"
  >;
  tasks: Array<{ id: string; title: string; status: string; isRequired: boolean }>;
  customFields: Array<{
    key: string;
    label: string;
    required: boolean;
    value: unknown;
  }>;
  alerts: Array<{ id: string; title: string; status: string; determination: string }>;
  evidenceItems: Array<{ id: string; type: string; value: string | null; verdict: string }>;
  openResponseActions: Array<{ id: string; status: string; target: string | null }>;
  relatedHighSeverity: Array<{
    id: string;
    caseNumber: string;
    severity: string;
    status: string;
  }>;
};

export function isClosureRequirementType(v: unknown): v is ClosureRequirementType {
  return (
    typeof v === "string" &&
    (CLOSURE_REQUIREMENT_TYPES as readonly string[]).includes(v)
  );
}

export function parseRequirementConfigs(raw: unknown): ClosureRequirementConfig[] {
  if (!Array.isArray(raw)) return [];
  const out: ClosureRequirementConfig[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    if (!isClosureRequirementType(row.type)) continue;
    switch (row.type) {
      case "required_custom_fields": {
        const fieldKeys = Array.isArray(row.fieldKeys)
          ? row.fieldKeys.filter((k): k is string => typeof k === "string" && k.trim().length > 0)
          : undefined;
        out.push({ type: "required_custom_fields", fieldKeys });
        break;
      }
      case "post_incident_review": {
        const severities = Array.isArray(row.severities)
          ? (row.severities.filter((s) =>
              ["low", "medium", "high", "critical"].includes(String(s)),
            ) as CaseSeverity[])
          : undefined;
        const classifications = Array.isArray(row.classifications)
          ? (row.classifications.filter((c) => typeof c === "string") as CaseClassification[])
          : undefined;
        out.push({ type: "post_incident_review", severities, classifications });
        break;
      }
      default:
        out.push({ type: row.type });
        break;
    }
  }
  return out;
}

function fieldPopulated(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  return true;
}

function labelFor(type: ClosureRequirementType): string {
  switch (type) {
    case "required_tasks_complete":
      return "Required tasks complete";
    case "required_custom_fields":
      return "Required custom fields populated";
    case "alerts_dispositioned":
      return "Every linked alert dispositioned";
    case "evidence_verdicts":
      return "Evidence verdicts recorded";
    case "containment_recorded":
      return "Containment status recorded";
    case "eradication_recorded":
      return "Eradication status recorded";
    case "recovery_recorded":
      return "Recovery status recorded";
    case "disposition":
      return "Closure classification and determination";
    case "root_cause_and_conclusion":
      return "Root cause and analyst conclusion";
    case "business_impact_and_lessons":
      return "Business impact and lessons learned";
    case "required_approver":
      return "Required approver";
    case "response_actions_resolved":
      return "Open response actions resolved";
    case "related_high_severity_reviewed":
      return "Related high-severity cases reviewed";
    case "post_incident_review":
      return "Post-incident review";
  }
}

function evaluateOne(
  config: ClosureRequirementConfig,
  ctx: ClosureEvaluationContext,
  input: ClosureDispositionInput,
): ClosureRequirementResult {
  const type = config.type;
  const label = labelFor(type);
  const missing: string[] = [];
  let detail: string | undefined;

  switch (config.type) {
    case "required_tasks_complete": {
      const incomplete = ctx.tasks.filter(
        (t) => t.isRequired && t.status !== "done",
      );
      for (const t of incomplete) missing.push(t.title);
      detail =
        incomplete.length > 0
          ? `${incomplete.length} required task(s) still open`
          : undefined;
      break;
    }
    case "required_custom_fields": {
      const keys = config.fieldKeys?.length
        ? new Set(config.fieldKeys)
        : null;
      if (keys) {
        // Explicit keys must exist on the org; stale/typo keys fail closed.
        for (const key of keys) {
          const field = ctx.customFields.find((f) => f.key === key);
          if (!field) {
            missing.push(`${key} (unknown field)`);
            continue;
          }
          if (!fieldPopulated(field.value)) missing.push(key);
        }
      } else {
        for (const f of ctx.customFields.filter((x) => x.required)) {
          if (!fieldPopulated(f.value)) missing.push(f.key);
        }
      }
      detail =
        missing.length > 0
          ? `Missing values for: ${missing.join(", ")}`
          : undefined;
      break;
    }
    case "alerts_dispositioned": {
      for (const a of ctx.alerts) {
        const terminal = a.status === "closed" || a.status === "dismissed";
        const determined = a.determination !== "unknown";
        if (!terminal || !determined) {
          missing.push(`${a.title || a.id} (${a.status}/${a.determination})`);
        }
      }
      detail =
        missing.length > 0
          ? `${missing.length} alert(s) still need disposition`
          : undefined;
      break;
    }
    case "evidence_verdicts": {
      for (const e of ctx.evidenceItems) {
        if (e.verdict === "unknown") {
          missing.push(e.value || e.type || e.id);
        }
      }
      detail =
        missing.length > 0
          ? `${missing.length} evidence item(s) lack a verdict`
          : undefined;
      break;
    }
    case "containment_recorded": {
      if (!ctx.case.containedAt) missing.push("containedAt");
      detail = missing.length ? "Case has no containment timestamp" : undefined;
      break;
    }
    case "eradication_recorded": {
      if (!ctx.case.eradicatedAt) missing.push("eradicatedAt");
      detail = missing.length ? "Case has no eradication timestamp" : undefined;
      break;
    }
    case "recovery_recorded": {
      if (!ctx.case.resolvedAt) missing.push("resolvedAt");
      detail = missing.length ? "Case has no recovery/resolved timestamp" : undefined;
      break;
    }
    case "disposition": {
      const disposition = input.disposition?.trim() ?? "";
      const conclusion = input.conclusion?.trim() ?? "";
      if (!disposition) missing.push("disposition");
      else if (
        !(CLOSURE_DISPOSITIONS as readonly string[]).includes(disposition)
      ) {
        missing.push(`disposition:${disposition}`);
      }
      if (!conclusion) missing.push("conclusion");
      if (input.determination != null && String(input.determination).trim()) {
        const det = String(input.determination).trim();
        if (!(CLOSURE_DETERMINATIONS as readonly string[]).includes(det)) {
          missing.push(`determination:${det}`);
        }
      }
      detail =
        missing.length > 0
          ? "Closure disposition and conclusion are required"
          : undefined;
      break;
    }
    case "root_cause_and_conclusion": {
      if (!input.rootCause?.trim()) missing.push("rootCause");
      if (!input.conclusion?.trim()) missing.push("conclusion");
      detail =
        missing.length > 0
          ? "Root cause and conclusion must both be recorded"
          : undefined;
      break;
    }
    case "business_impact_and_lessons": {
      if (!input.businessImpact?.trim()) missing.push("businessImpact");
      if (!input.lessonsLearned?.trim()) missing.push("lessonsLearned");
      detail =
        missing.length > 0
          ? "Business impact and lessons learned must both be recorded"
          : undefined;
      break;
    }
    case "required_approver": {
      if (!input.approverId?.trim()) missing.push("approverId");
      detail = missing.length
        ? "An approver distinct from the closer is required"
        : undefined;
      break;
    }
    case "response_actions_resolved": {
      for (const r of ctx.openResponseActions) {
        missing.push(`${r.target || r.id} (${r.status})`);
      }
      detail =
        missing.length > 0
          ? `${missing.length} response action run(s) still open`
          : undefined;
      break;
    }
    case "related_high_severity_reviewed": {
      const reviewed = new Set(input.reviewedRelatedCaseIds ?? []);
      for (const rel of ctx.relatedHighSeverity) {
        if (rel.status === "closed") continue;
        if (!reviewed.has(rel.id)) {
          missing.push(`${rel.caseNumber} (${rel.severity})`);
        }
      }
      detail =
        missing.length > 0
          ? `${missing.length} related high/critical case(s) need review`
          : undefined;
      break;
    }
    case "post_incident_review": {
      const severities = config.severities?.length
        ? config.severities
        : (["high", "critical"] as CaseSeverity[]);
      const classifications = config.classifications;
      const severityMatches = severities.includes(
        ctx.case.severity as CaseSeverity,
      );
      const classificationMatches =
        !classifications ||
        classifications.length === 0 ||
        classifications.includes(ctx.case.classification as CaseClassification);
      if (severityMatches && classificationMatches) {
        if (!input.postIncidentReviewCompleted) {
          missing.push("postIncidentReviewCompleted");
          detail = `PIR required for severity ${ctx.case.severity}${
            classifications?.length
              ? ` / classification ${ctx.case.classification}`
              : ""
          }`;
        }
      }
      break;
    }
  }

  return {
    type,
    label,
    passed: missing.length === 0,
    missing,
    detail,
  };
}

/**
 * Pure evaluation against a pre-loaded context. No I/O.
 */
export function evaluateClosureRequirements(
  requirements: ClosureRequirementConfig[],
  ctx: ClosureEvaluationContext,
  input: ClosureDispositionInput,
  meta: Pick<
    ResolvedClosurePolicy,
    | "policyId"
    | "policyVersionId"
    | "policyVersion"
    | "policyName"
    | "requireTwoPersonOverride"
  >,
): ClosureEvaluation {
  const results = requirements.map((r) => evaluateOne(r, ctx, input));
  const failed = results.filter((r) => !r.passed);
  return {
    ok: failed.length === 0,
    policyId: meta.policyId,
    policyVersionId: meta.policyVersionId,
    policyVersion: meta.policyVersion,
    policyName: meta.policyName,
    requireTwoPersonOverride: meta.requireTwoPersonOverride,
    requirements: results,
    failed,
  };
}

export async function resolveApplicableClosurePolicy(
  organisationId: string,
  templateId: string | null,
): Promise<ResolvedClosurePolicy> {
  // Prefer a template-scoped active policy when the case was opened from a template.
  if (templateId) {
    const [tplPolicy] = await db
      .select()
      .from(caseClosurePolicies)
      .where(
        and(
          eq(caseClosurePolicies.organisationId, organisationId),
          eq(caseClosurePolicies.templateId, templateId),
          eq(caseClosurePolicies.isActive, true),
        ),
      )
      .limit(1);
    if (tplPolicy) {
      return loadPolicyVersion(tplPolicy);
    }
  }

  const [defaultPolicy] = await db
    .select()
    .from(caseClosurePolicies)
    .where(
      and(
        eq(caseClosurePolicies.organisationId, organisationId),
        eq(caseClosurePolicies.isDefault, true),
        eq(caseClosurePolicies.isActive, true),
      ),
    )
    .limit(1);
  if (defaultPolicy) {
    return loadPolicyVersion(defaultPolicy);
  }

  return {
    policyId: null,
    policyVersionId: null,
    policyVersion: null,
    policyName: "Built-in default",
    requirements: BUILTIN_CLOSURE_REQUIREMENTS,
    requireTwoPersonOverride: false,
  };
}

async function loadPolicyVersion(
  policy: typeof caseClosurePolicies.$inferSelect,
): Promise<ResolvedClosurePolicy> {
  const [version] = await db
    .select()
    .from(caseClosurePolicyVersions)
    .where(
      and(
        eq(caseClosurePolicyVersions.policyId, policy.id),
        eq(caseClosurePolicyVersions.version, policy.currentVersion),
      ),
    )
    .limit(1);
  if (!version) {
    return {
      policyId: policy.id,
      policyVersionId: null,
      policyVersion: policy.currentVersion,
      policyName: policy.name,
      requirements: BUILTIN_CLOSURE_REQUIREMENTS,
      requireTwoPersonOverride: false,
    };
  }
  return {
    policyId: policy.id,
    policyVersionId: version.id,
    policyVersion: version.version,
    policyName: policy.name,
    requirements: parseRequirementConfigs(version.requirements),
    requireTwoPersonOverride: version.requireTwoPersonOverride,
  };
}

export async function loadClosureEvaluationContext(
  organisationId: string,
  caseId: string,
): Promise<ClosureEvaluationContext | null> {
  const [caseRow] = await db
    .select({
      id: cases.id,
      organisationId: cases.organisationId,
      status: cases.status,
      severity: cases.severity,
      classification: cases.classification,
      templateId: cases.templateId,
      containedAt: cases.containedAt,
      eradicatedAt: cases.eradicatedAt,
      resolvedAt: cases.resolvedAt,
      closedAt: cases.closedAt,
    })
    .from(cases)
    .where(and(eq(cases.id, caseId), eq(cases.organisationId, organisationId)))
    .limit(1);
  if (!caseRow) return null;

  const [taskRows, fieldDefs, linkedAlerts, evidenceRows, openActions, relEdges] =
    await Promise.all([
      db
        .select({
          id: caseTasks.id,
          title: caseTasks.title,
          status: caseTasks.status,
          isRequired: caseTasks.isRequired,
        })
        .from(caseTasks)
        .where(eq(caseTasks.caseId, caseId)),
      db
        .select({
          id: customFieldDefinitions.id,
          key: customFieldDefinitions.key,
          label: customFieldDefinitions.label,
          required: customFieldDefinitions.required,
        })
        .from(customFieldDefinitions)
        .where(
          and(
            eq(customFieldDefinitions.organisationId, organisationId),
            eq(customFieldDefinitions.entity, "case"),
            eq(customFieldDefinitions.isActive, true),
          ),
        ),
      db
        .select({
          id: alerts.id,
          title: alerts.title,
          status: alerts.status,
          determination: alerts.determination,
        })
        .from(caseAlerts)
        .innerJoin(alerts, eq(alerts.id, caseAlerts.alertId))
        .where(
          and(
            eq(caseAlerts.caseId, caseId),
            eq(caseAlerts.organisationId, organisationId),
          ),
        ),
      db
        .select({
          id: evidenceItems.id,
          type: evidenceItems.type,
          value: evidenceItems.value,
          verdict: evidenceItems.verdict,
        })
        .from(evidenceItems)
        .where(
          and(
            eq(evidenceItems.caseId, caseId),
            eq(evidenceItems.organisationId, organisationId),
          ),
        ),
      db
        .select({
          id: responseActionRuns.id,
          status: responseActionRuns.status,
          target: responseActionRuns.target,
        })
        .from(responseActionRuns)
        .where(
          and(
            eq(responseActionRuns.caseId, caseId),
            eq(responseActionRuns.organisationId, organisationId),
            inArray(responseActionRuns.status, [...OPEN_RESPONSE_STATUSES]),
          ),
        ),
      db
        .select({
          sourceCaseId: caseRelationships.sourceCaseId,
          targetCaseId: caseRelationships.targetCaseId,
        })
        .from(caseRelationships)
        .where(
          and(
            eq(caseRelationships.organisationId, organisationId),
            or(
              eq(caseRelationships.sourceCaseId, caseId),
              eq(caseRelationships.targetCaseId, caseId),
            ),
          ),
        ),
    ]);

  const relatedIds = [
    ...new Set(
      relEdges.map((e) =>
        e.sourceCaseId === caseId ? e.targetCaseId : e.sourceCaseId,
      ),
    ),
  ].filter((id) => id !== caseId);

  const related =
    relatedIds.length === 0
      ? []
      : await db
          .select({
            id: cases.id,
            caseNumber: cases.caseNumber,
            severity: cases.severity,
            status: cases.status,
          })
          .from(cases)
          .where(
            and(
              eq(cases.organisationId, organisationId),
              inArray(cases.id, relatedIds),
              inArray(cases.severity, ["high", "critical"]),
              ne(cases.id, caseId),
            ),
          );

  const values =
    fieldDefs.length > 0
      ? await db
          .select({
            fieldId: customFieldValues.fieldId,
            value: customFieldValues.value,
          })
          .from(customFieldValues)
          .where(
            and(
              eq(customFieldValues.entityId, caseId),
              inArray(
                customFieldValues.fieldId,
                fieldDefs.map((d) => d.id),
              ),
            ),
          )
      : [];
  const valueByField = new Map(values.map((v) => [v.fieldId, v.value]));

  return {
    case: caseRow,
    tasks: taskRows,
    customFields: fieldDefs.map((d) => ({
      key: d.key,
      label: d.label,
      required: d.required,
      value: valueByField.get(d.id) ?? null,
    })),
    alerts: linkedAlerts,
    evidenceItems: evidenceRows,
    openResponseActions: openActions,
    relatedHighSeverity: related,
  };
}

/**
 * End-to-end evaluation for a case: resolve applicable policy version + load
 * context + evaluate. Returns null when the case is not in the organisation.
 */
export async function evaluateCaseClosure(
  organisationId: string,
  caseId: string,
  input: ClosureDispositionInput,
): Promise<ClosureEvaluation | null> {
  const ctx = await loadClosureEvaluationContext(organisationId, caseId);
  if (!ctx) return null;
  const policy = await resolveApplicableClosurePolicy(
    organisationId,
    ctx.case.templateId,
  );
  return evaluateClosureRequirements(policy.requirements, ctx, input, policy);
}

/** Exported for tests that need the open-status list. */
export const CLOSURE_OPEN_RESPONSE_STATUSES = OPEN_RESPONSE_STATUSES;

import { db } from "@/db";
import {
  cases,
  observables,
  responseActions,
  responseActionRuns,
} from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { newId } from "@/lib/utils";
import { writeTimelineEvent } from "@/lib/timeline";
import { getActionHandler } from "./registry";
import type { CaseObservable } from "./types";

async function caseObservables(caseId: string): Promise<CaseObservable[]> {
  const rows = await db
    .select({ type: observables.type, value: observables.value })
    .from(observables)
    .where(eq(observables.caseId, caseId));
  return rows.map((r) => ({ type: r.type, value: r.value }));
}

export type AvailableAction = {
  id: string;
  kind: string;
  name: string;
  label: string;
  description: string;
  inputFields: ReturnType<
    NonNullable<ReturnType<typeof getActionHandler>>["inputFields"]
  >;
};

/**
 * Active actions for the org whose handler requirements are satisfied by the
 * observables currently on the case.
 */
export async function listAvailableActions(
  organisationId: string,
  caseId: string,
): Promise<AvailableAction[]> {
  const [configured, obs] = await Promise.all([
    db
      .select()
      .from(responseActions)
      .where(
        and(
          eq(responseActions.organisationId, organisationId),
          eq(responseActions.isActive, true),
        ),
      ),
    caseObservables(caseId),
  ]);
  const presentTypes = new Set(obs.map((o) => o.type));
  const out: AvailableAction[] = [];
  for (const a of configured) {
    const handler = getActionHandler(a.kind);
    if (!handler) continue;
    const requires = handler.requiresObservableTypes;
    const satisfied =
      requires.length === 0 || requires.some((t) => presentTypes.has(t));
    if (!satisfied) continue;
    out.push({
      id: a.id,
      kind: a.kind,
      name: a.name,
      label: handler.label,
      description: handler.description,
      inputFields: handler.inputFields(obs),
    });
  }
  return out;
}

export async function runResponseAction(
  organisationId: string,
  actorId: string,
  actionId: string,
  caseId: string,
  input: Record<string, string>,
): Promise<{ runId: string; ok: boolean; summary: string }> {
  const [action] = await db
    .select()
    .from(responseActions)
    .where(
      and(
        eq(responseActions.id, actionId),
        eq(responseActions.organisationId, organisationId),
      ),
    )
    .limit(1);
  if (!action) throw new Error("Action not found");
  if (!action.isActive) throw new Error("Action is disabled");

  const [c] = await db
    .select({ id: cases.id })
    .from(cases)
    .where(and(eq(cases.id, caseId), eq(cases.organisationId, organisationId)))
    .limit(1);
  if (!c) throw new Error("Case not found");

  const handler = getActionHandler(action.kind);
  if (!handler) throw new Error(`Unknown action kind: ${action.kind}`);

  const validationError = handler.validate(input);
  if (validationError) throw new Error(validationError);

  const runId = newId("car");
  await db.insert(responseActionRuns).values({
    id: runId,
    actionId: action.id,
    caseId,
    requestedBy: actorId,
    status: "running",
    request: input,
  });

  let result;
  try {
    result = await handler.execute({
      organisationId,
      caseId,
      config: (action.config as Record<string, unknown>) ?? {},
      input,
    });
  } catch (e) {
    result = {
      ok: false,
      summary: `Action threw: ${(e as Error).message}`,
      error: (e as Error).message,
    };
  }

  await db
    .update(responseActionRuns)
    .set({
      status: result.ok ? "succeeded" : "failed",
      target: result.target ?? null,
      response: {
        ok: result.ok,
        summary: result.summary,
        data: result.data ?? null,
        error: result.error ?? null,
      },
      completedAt: new Date(),
    })
    .where(eq(responseActionRuns.id, runId));

  await writeTimelineEvent({
    caseId,
    actorId,
    eventType: "response_action",
    payload: {
      action: action.name,
      kind: action.kind,
      target: result.target ?? null,
      status: result.ok ? "succeeded" : "failed",
      summary: result.summary,
    },
  });

  return { runId, ok: result.ok, summary: result.summary };
}

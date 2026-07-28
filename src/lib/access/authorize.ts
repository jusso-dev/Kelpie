/**
 * High-level authorize helpers used by routes and cores (issue #61).
 */

import {
  evaluateCasePermissions,
  hasPermission,
  canViewSensitiveObject,
  redactCaseListRow,
  redactSensitiveContent,
  ACCESS_NOT_FOUND,
  REDACTED_PLACEHOLDER,
} from "./evaluate";
import {
  loadCaseAccessContext,
  loadCaseAccessContexts,
} from "./load";
import type {
  AccessActor,
  AccessPermission,
  CaseAccessContext,
} from "./types";
import { accessCacheKey } from "./types";

export type AuthorizeCaseResult =
  | {
      ok: true;
      ctx: CaseAccessContext;
      permissions: Set<AccessPermission>;
      cacheKey: string;
    }
  | { ok: false; status: 404; error: string };

/**
 * Load policy and evaluate. Missing cases and unauthorized know_exists both
 * return the same 404 shape so callers cannot distinguish them.
 */
export async function authorizeCase(
  organisationId: string,
  caseId: string,
  actor: AccessActor,
  required: AccessPermission = "know_exists",
): Promise<AuthorizeCaseResult> {
  if (actor.organisationId !== organisationId) {
    return { ok: false, ...ACCESS_NOT_FOUND };
  }
  const ctx = await loadCaseAccessContext(organisationId, caseId);
  if (!ctx) {
    return { ok: false, ...ACCESS_NOT_FOUND };
  }
  const permissions = evaluateCasePermissions(ctx, actor);
  if (!hasPermission(permissions, required)) {
    // Deny by default; same status as missing to avoid existence oracle
    // except for export which has a dedicated message when the case is known.
    if (
      required === "export" &&
      hasPermission(permissions, "know_exists") &&
      hasPermission(permissions, "view_metadata")
    ) {
      return {
        ok: false,
        status: 404,
        error: ACCESS_NOT_FOUND.error,
      };
    }
    return { ok: false, ...ACCESS_NOT_FOUND };
  }
  return {
    ok: true,
    ctx,
    permissions,
    cacheKey: accessCacheKey({
      organisationId,
      actorId: actor.userId,
      caseId,
      policyVersion: ctx.accessPolicyVersion,
      permission: required,
    }),
  };
}

export async function authorizeCaseOrThrow(
  organisationId: string,
  caseId: string,
  actor: AccessActor,
  required: AccessPermission = "know_exists",
): Promise<{
  ctx: CaseAccessContext;
  permissions: Set<AccessPermission>;
  cacheKey: string;
}> {
  const result = await authorizeCase(organisationId, caseId, actor, required);
  if (!result.ok) {
    const err = new Error(result.error) as Error & { status: number };
    err.status = result.status;
    throw err;
  }
  return result;
}

/**
 * Filter and redact a list of case rows for the actor. Cases the actor must
 * not know exist are dropped entirely (no count leak of filtered items from
 * this helper — callers should apply SQL filters first for pagination).
 */
export async function filterCasesForActor<
  T extends { id: string } & Record<string, unknown>,
>(
  organisationId: string,
  actor: AccessActor,
  rows: T[],
): Promise<T[]> {
  if (rows.length === 0) return [];
  const contexts = await loadCaseAccessContexts(
    organisationId,
    rows.map((r) => r.id),
  );
  const out: T[] = [];
  for (const row of rows) {
    const ctx = contexts.get(row.id);
    if (!ctx) continue;
    const perms = evaluateCasePermissions(ctx, actor);
    if (!hasPermission(perms, "know_exists")) continue;
    out.push(redactCaseListRow(row, perms));
  }
  return out;
}

export function redactCustomFields(
  fields: Array<{
    id: string;
    key: string;
    label: string;
    type: string;
    options: string[];
    required: boolean;
    orderIndex: number;
    isActive: boolean;
    sensitive?: boolean;
    value: unknown;
  }>,
  permissions: Set<AccessPermission>,
  opts?: {
    actor?: AccessActor;
    grants?: CaseAccessContext["grants"];
  },
): Array<{
  id: string;
  key: string;
  label: string;
  type: string;
  options: string[];
  required: boolean;
  orderIndex: number;
  isActive: boolean;
  sensitive: boolean;
  value: unknown;
  redacted: boolean;
}> {
  return fields.map((f) => {
    const sensitive = Boolean(f.sensitive);
    let canView = !sensitive
      ? hasPermission(permissions, "view_metadata")
      : hasPermission(permissions, "view_sensitive");
    if (
      sensitive &&
      !canView &&
      opts?.actor &&
      opts.grants &&
      hasPermission(permissions, "view_metadata")
    ) {
      canView = canViewSensitiveObject(permissions, {
        sensitive: true,
        objectType: "custom_field",
        objectId: f.id,
        grants: opts.grants,
        actor: opts.actor,
      });
    }
    if (canView) {
      return { ...f, sensitive, value: f.value, redacted: false };
    }
    // Definition metadata stays; value redacted. Hidden relationship counts
    // are not exposed (value is always the same placeholder).
    return {
      ...f,
      sensitive,
      value: sensitive ? REDACTED_PLACEHOLDER : f.value,
      redacted: sensitive,
    };
  });
}

export function redactContentBlock<
  T extends {
    id: string;
    sensitive: boolean;
    content: string;
    contentStructured?: unknown;
    title: string;
  },
>(
  block: T,
  permissions: Set<AccessPermission>,
  opts?: {
    actor?: AccessActor;
    grants?: CaseAccessContext["grants"];
  },
): T & { redacted: boolean } {
  let canView = !block.sensitive
    ? hasPermission(permissions, "view_metadata")
    : hasPermission(permissions, "view_sensitive");
  if (
    block.sensitive &&
    !canView &&
    opts?.actor &&
    opts.grants &&
    hasPermission(permissions, "view_metadata")
  ) {
    canView = canViewSensitiveObject(permissions, {
      sensitive: true,
      objectType: "content_block",
      objectId: block.id,
      grants: opts.grants,
      actor: opts.actor,
    });
  }
  if (canView || !block.sensitive) {
    return { ...block, redacted: false };
  }
  return {
    ...redactSensitiveContent(block as T & Record<string, unknown>, [
      "content",
      "contentStructured",
    ] as (keyof T)[]),
    title: block.title, // title is metadata; still shown when view_metadata
    redacted: true,
  } as T & { redacted: boolean };
}

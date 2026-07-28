import type { AccessActor } from "@/lib/access";
import type { ScopeValue } from "@/lib/scopes";
import type { z } from "zod";

/** How the UI should render a command result. */
export type ResultRenderer = "table" | "json" | "markdown";

/** Read is default; write requires approval before any side effect. */
export type AccessClass = "read" | "write";

export type ParamFieldType =
  | "string"
  | "enum"
  | "number"
  | "boolean"
  | "entity_value";

export type ParamField = {
  key: string;
  label: string;
  type: ParamFieldType;
  required: boolean;
  description?: string;
  enumValues?: string[];
  /** When true, values are redacted before persistence/display. */
  redact?: boolean;
};

export type InvestigationContext = {
  organisationId: string;
  actorId: string | null;
  /**
   * Access actor for compartment filtering inside handlers (e.g. previous
   * cases). Never a system_internal actor on user request paths.
   */
  accessActor: AccessActor;
  caseId?: string | null;
  entityId?: string | null;
  evidenceId?: string | null;
  alertId?: string | null;
  /** Abort when the operator cancels or the command times out. */
  signal: AbortSignal;
};

export type CommandResult = {
  ok: boolean;
  /** Preferred renderer for this result payload. */
  renderer: ResultRenderer;
  /**
   * Structured, size-bounded payload. Handlers must not return credentials
   * or raw provider secrets. Core redacts again before persistence.
   */
  data: unknown;
  /** Short human summary for history lists and timeline. */
  summary: string;
  /** Provider correlation id when available. */
  providerRequestId?: string | null;
  error?: string;
};

/**
 * Trusted investigation command handler. Only handlers registered in
 * `registry.ts` may ever run. There is no shell, script, or arbitrary-URL
 * surface — outbound HTTP is only allowed via approved handler code that
 * builds fixed destination URLs (and uses safeFetch where applicable).
 */
export type InvestigationCommandHandler = {
  /** Stable dotted name, e.g. `kelpie.previous_cases`. */
  name: string;
  /** Semver-ish version frozen at execution time. */
  version: string;
  label: string;
  description: string;
  accessClass: AccessClass;
  /** Scopes the token must hold (fail closed). */
  requiredScopes: ScopeValue[];
  /** Parameter field catalog for UI + docs. */
  parameters: ParamField[];
  /** Zod schema for server-side validation. */
  paramSchema: z.ZodType<Record<string, unknown>>;
  /** Supported result renderers (first is default). */
  resultRenderers: ResultRenderer[];
  /** Hard wall-clock timeout in milliseconds. */
  timeoutMs: number;
  /** Max result payload bytes after JSON serialisation. */
  maxResultBytes: number;
  /** Max executions per organisation per minute for this command. */
  rateLimitPerMinute: number;
  /**
   * Write-class approval policy. Read commands must leave this false.
   * Write commands with `approvalRequired: true` enter `awaiting_approval`
   * and never run until a different administrator approves.
   */
  approvalRequired: boolean;
  /**
   * Parameter keys whose values are always redacted before persistence,
   * even if not marked on the field (defense in depth).
   */
  redactParamKeys?: string[];
  /**
   * Execute the trusted command. Must honour `ctx.signal` for cancel/timeout.
   * Must never invoke a shell, eval user code, or fetch an arbitrary URL.
   */
  execute(
    params: Record<string, unknown>,
    ctx: InvestigationContext,
  ): Promise<CommandResult>;
};

export type PublicCommandDescriptor = {
  name: string;
  version: string;
  label: string;
  description: string;
  accessClass: AccessClass;
  requiredScopes: ScopeValue[];
  parameters: ParamField[];
  resultRenderers: ResultRenderer[];
  timeoutMs: number;
  maxResultBytes: number;
  rateLimitPerMinute: number;
  approvalRequired: boolean;
};

export const INVESTIGATION_APPROVAL_WINDOW_MS = 15 * 60 * 1000;

/** Inline result summary cap (bytes of JSON). Larger payloads use storage. */
export const INLINE_RESULT_SUMMARY_BYTES = 8 * 1024;

/** Absolute ceiling for any stored result (handler caps may be lower). */
export const ABSOLUTE_MAX_RESULT_BYTES = 512 * 1024;

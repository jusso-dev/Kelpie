import type {
  InvestigationCommandHandler,
  PublicCommandDescriptor,
} from "./types";
import { previousCasesHandler } from "./handlers/previous-cases";
import { virusTotalReportHandler } from "./handlers/virustotal-report";
import { flagEntityReviewedHandler } from "./handlers/flag-entity-reviewed";

/**
 * Trusted handler registry. Only these commands may ever execute.
 * There is no dynamic registration from user input, plugins, or scripts.
 */
const HANDLERS: InvestigationCommandHandler[] = [
  previousCasesHandler,
  virusTotalReportHandler,
  flagEntityReviewedHandler,
];

const BY_NAME = new Map(HANDLERS.map((h) => [h.name, h]));

export function listInvestigationHandlers(): InvestigationCommandHandler[] {
  return HANDLERS.slice();
}

export function getInvestigationHandler(
  name: string,
): InvestigationCommandHandler | null {
  return BY_NAME.get(name) ?? null;
}

/** Test-only: register an ephemeral handler (never called from production routes). */
export function __registerHandlerForTests(
  handler: InvestigationCommandHandler,
): void {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Test handler registration is disabled in production");
  }
  HANDLERS.push(handler);
  BY_NAME.set(handler.name, handler);
}

export function __unregisterHandlerForTests(name: string): void {
  if (process.env.NODE_ENV === "production") return;
  const idx = HANDLERS.findIndex((h) => h.name === name);
  if (idx >= 0) HANDLERS.splice(idx, 1);
  BY_NAME.delete(name);
}

export function listPublicCommands(): PublicCommandDescriptor[] {
  return HANDLERS.map((h) => ({
    name: h.name,
    version: h.version,
    label: h.label,
    description: h.description,
    accessClass: h.accessClass,
    requiredScopes: h.requiredScopes,
    parameters: h.parameters,
    resultRenderers: h.resultRenderers,
    timeoutMs: h.timeoutMs,
    maxResultBytes: h.maxResultBytes,
    rateLimitPerMinute: h.rateLimitPerMinute,
    approvalRequired: h.approvalRequired,
  }));
}

/**
 * Hard prohibition surface: these names/patterns must never resolve to a
 * handler even if someone tries to smuggle them through the execute API.
 */
const PROHIBITED_NAMES =
  /^(?:shell|exec|eval|script|python|bash|sh|powershell|cmd|system|raw_http|fetch_url|http_request|sql|query_db)$/i;

export function isProhibitedCommandName(name: string): boolean {
  return PROHIBITED_NAMES.test(name.trim());
}

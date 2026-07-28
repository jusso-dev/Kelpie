/**
 * Centralized case compartment / field-level sensitivity authorization
 * (issue #61). All surfaces — REST, MCP, jobs, webhooks, reports, search,
 * notifications — should call these helpers rather than re-implementing
 * visibility checks.
 */

export * from "./types";
export * from "./evaluate";
export {
  loadCaseAccessContext,
  loadCaseAccessContexts,
  loadUserTeamIds,
  resolveUserActor,
  resolveTokenActor,
  systemInternalActor,
  caseKnowExistsSql,
  bumpAccessPolicyVersion,
  listOrgAdminEmails,
} from "./load";
export {
  AccessError,
  createAccessGrant,
  revokeAccessGrant,
  breakGlassAccess,
  setCaseVisibility,
  listAccessGrants,
  listAccessHistory,
  getCaseAccessSummary,
  type CreateGrantInput,
  type SetVisibilityInput,
} from "./grants";
export {
  authorizeCase,
  authorizeCaseOrThrow,
  filterCasesForActor,
  redactCustomFields,
  redactContentBlock,
  redactTimelineEventPayload,
  type AuthorizeCaseResult,
} from "./authorize";

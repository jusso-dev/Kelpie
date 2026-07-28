/**
 * Shared case mutation errors. Kept free of DB / core imports so domain
 * modules (cases-core, closure) can share them without circular deps.
 */

export class CaseVersionConflictError extends Error {
  current: Record<string, unknown>;
  constructor(current: Record<string, unknown>) {
    super("case_version_conflict");
    this.name = "CaseVersionConflictError";
    this.current = current;
  }
}

export type ActionFieldType =
  | "string"
  | "password"
  | "select"
  | "textarea";

export type ActionField = {
  key: string;
  label: string;
  type: ActionFieldType;
  required: boolean;
  placeholder?: string;
  help?: string;
  options?: Array<{ value: string; label: string }>;
};

export type ActionExecuteContext = {
  organisationId: string;
  caseId: string;
  /** Stored configuration for the action (credentials etc). */
  config: Record<string, unknown>;
  /** Runtime input from the run form. */
  input: Record<string, string>;
};

export type ActionResult = {
  ok: boolean;
  /** Short human summary written to the timeline. */
  summary: string;
  /** Primary target the action acted on (IP, username, hostname). */
  target?: string;
  /** Provider response, stored on the run for audit and rollback hints. */
  data?: Record<string, unknown>;
  /** Provider-side id useful for audit and rollback. Never a credential. */
  providerExternalId?: string;
  error?: string;
};

export type CaseObservable = { type: string; value: string };

export interface ActionHandler {
  kind: string;
  label: string;
  description: string;
  /** High-impact actions require a distinct administrator before execution. */
  approvalRequired: boolean;
  /**
   * Observable types that must be present on the case for the action to be
   * offered. Empty means always available.
   */
  requiresObservableTypes: string[];
  /** Credential / configuration fields stored on the response_actions row. */
  configFields: ActionField[];
  /**
   * Build the run-time input form fields. Receives the case observables so the
   * handler can pre-populate a select of candidate targets.
   */
  inputFields(observables: CaseObservable[]): ActionField[];
  /** Exact external target retained with approval request. */
  target(input: Record<string, string>): string | null;
  /** Case observable which proves the target belongs to this case. */
  evidenceTarget?(input: Record<string, string>): string | null;
  /** Returns an error string when the input is invalid, otherwise null. */
  validate(input: Record<string, string>): string | null;
  execute(ctx: ActionExecuteContext): Promise<ActionResult>;
}

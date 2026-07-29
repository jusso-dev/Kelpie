/**
 * Kelpie ↔ Brolga integration contract.
 *
 * Brolga (https://github.com/jusso-dev/Brolga) will centralise TI ingest,
 * graph, and context packs. Kelpie consumes compact packs for case
 * enrichment — it does not re-implement MISP/TAXII/AbuseIPDB pipelines.
 *
 * These types are Kelpie's *consumer* contract, and Brolga now serves it.
 *
 * Wire path: `POST {baseUrl}/api/v1/context`
 * Auth: `Authorization: Bearer <token>` — Brolga refuses to bind a reachable
 * address without a token, so one is always required off loopback.
 * Content-Type: `application/json`
 *
 * Brolga serves detail level L1 today. It reports the level it *actually*
 * served and notes the shortfall in `exclusions`, so a pack never claims more
 * depth than it has. Progressive disclosure beyond L1 and `expansion_handles`
 * remain roadmap.
 *
 * `disposition: "unknown"` means Brolga has not heard of the subject. It does
 * not mean benign, and must not be rendered as one.
 */

/** Schema id for the request body Kelpie sends. */
export const BROLGA_CONTEXT_REQUEST_SCHEMA = "kelpie.brolga.context_request/1.0";

/** Schema id Kelpie expects on a successful pack. */
export const BROLGA_CONTEXT_PACK_SCHEMA = "brolga.context_pack/1.0";

/** Purposes Brolga will support; Kelpie uses case enrichment first. */
export const BROLGA_PURPOSES = [
  "case_enrichment",
  "incident_triage",
  "threat_hunting",
  "raw_research",
] as const;

export type BrolgaPurpose = (typeof BROLGA_PURPOSES)[number];

/** Progressive disclosure levels from disposition through source expansion. */
export const BROLGA_DETAIL_LEVELS = [
  "L0",
  "L1",
  "L2",
  "L3",
  "L4",
  "L5",
] as const;

export type BrolgaDetailLevel = (typeof BROLGA_DETAIL_LEVELS)[number];

/** Observable kinds Kelpie may ask about (maps onto Brolga observables). */
export const BROLGA_SUBJECT_KINDS = [
  "ip",
  "ipv4",
  "ipv6",
  "domain",
  "url",
  "file_hash",
  "email",
  "hostname",
] as const;

export type BrolgaSubjectKind = (typeof BROLGA_SUBJECT_KINDS)[number];

export type BrolgaContextSubject = {
  kind: BrolgaSubjectKind | string;
  value: string;
};

export type BrolgaContextBudgets = {
  /** Soft cap on objects in the pack. */
  max_objects?: number;
  /** Soft cap on UTF-8 bytes of the serialised pack. */
  max_bytes?: number;
  /** Soft cap on relationship fan-out. */
  max_relationships?: number;
};

/**
 * Request Kelpie POSTs to Brolga.
 * Extra fields are allowed for forward compatibility.
 */
export type BrolgaContextRequest = {
  schema_version: typeof BROLGA_CONTEXT_REQUEST_SCHEMA;
  subject: BrolgaContextSubject;
  purpose: BrolgaPurpose;
  detail_level: BrolgaDetailLevel;
  budgets?: BrolgaContextBudgets;
  /** Optional case id for operator audit on the Brolga side. */
  case_id?: string;
  /** Kelpie organisation id (tenant hint; Brolga may ignore if single-tenant). */
  organisation_id?: string;
};

export type BrolgaEvidenceRef = {
  source_object_id?: string;
  content_hash?: string;
  locator?: string;
  label?: string;
};

export type BrolgaClaimSummary = {
  predicate?: string;
  object?: string;
  confidence?: number;
  status?: string;
  evidence?: BrolgaEvidenceRef[];
};

export type BrolgaEntitySummary = {
  id?: string;
  kind?: string;
  name?: string;
};

/**
 * Context pack body Kelpie will render.
 * Fields optional so partial/future packs still decode.
 */
export type BrolgaContextPack = {
  schema_version: string;
  fingerprint?: string;
  subject?: BrolgaContextSubject;
  purpose?: string;
  detail_level?: string;
  disposition?: string;
  confidence?: number;
  temporal_state?: string;
  uncertainty?: string[];
  entities?: BrolgaEntitySummary[];
  claims?: BrolgaClaimSummary[];
  relationships?: Array<Record<string, unknown>>;
  contradictions?: Array<Record<string, unknown>>;
  gaps?: string[];
  pivots?: string[];
  evidence?: BrolgaEvidenceRef[];
  markings?: Record<string, unknown>;
  budget?: {
    requested?: BrolgaContextBudgets;
    consumed?: BrolgaContextBudgets;
  };
  exclusions?: Array<{ category?: string; reason?: string }>;
  expansion_handles?: Array<{ id?: string; level?: string }>;
  /** Escape hatch for additive Brolga fields. */
  [key: string]: unknown;
};

export type BrolgaClientStatus =
  | "unconfigured"
  | "unavailable"
  | "ok"
  | "error";

export type BrolgaLookupResult =
  | {
      status: "unconfigured" | "unavailable";
      message: string;
    }
  | {
      status: "error";
      message: string;
      httpStatus?: number;
    }
  | {
      status: "ok";
      pack: BrolgaContextPack;
      latencyMs: number;
    };

export function mapObservableTypeToBrolgaKind(
  type: string,
): BrolgaSubjectKind | string {
  switch (type) {
    case "ip":
      return "ip";
    case "domain":
    case "hostname":
      return type === "hostname" ? "hostname" : "domain";
    case "url":
      return "url";
    case "file_hash":
      return "file_hash";
    case "email":
      return "email";
    default:
      return type;
  }
}

export function isBrolgaContextPack(value: unknown): value is BrolgaContextPack {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const schema = (value as { schema_version?: unknown }).schema_version;
  return typeof schema === "string" && schema.length > 0;
}

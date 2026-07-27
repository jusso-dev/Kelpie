/**
 * Identity, labelling and validation rules for the `source_system` value that
 * imported cases carry.
 *
 * Two families of source system exist, and they are deliberately kept disjoint:
 *
 * - **Managed connectors** that Kelpie polls (Microsoft Sentinel, Defender
 *   XDR). They own a `case_sources` row and namespace themselves as
 *   `<kind>:<sourceId>`, so their identifier always contains a colon.
 * - **Push producers** such as Tawny, which deliver alerts to
 *   `POST /api/v1/cases` with a `cases:write` token. They use a bare slug with
 *   no colon.
 *
 * Because the shapes cannot overlap, a token holder cannot mint a
 * `source_system` that collides with a managed connector's organisation-scoped
 * idempotency key, nor claim Sentinel/Defender provenance on the case page.
 */

export const TAWNY_SOURCE_SYSTEM = "tawny";

export const MAX_SOURCE_SYSTEM_LENGTH = 64;
export const MAX_SOURCE_REFERENCE_LENGTH = 200;

/** Bare lowercase slug: no colon, so it can never look like `<kind>:<id>`. */
const PUSH_SOURCE_SYSTEM_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;

/** Connector kinds that only Kelpie's own pollers may write. */
const MANAGED_CONNECTOR_LABELS: Record<string, string> = {
  microsoft_sentinel: "Microsoft Sentinel",
  microsoft_defender_xdr: "Microsoft Defender XDR",
};

/** Push producers Kelpie recognises by name. */
const PUSH_SOURCE_LABELS: Record<string, string> = {
  [TAWNY_SOURCE_SYSTEM]: "Tawny",
};

/**
 * Source systems offered as first-class filters in the UI and API. Cases from
 * unlisted push producers are still accepted and still filterable by their
 * exact slug.
 */
export const KNOWN_PUSH_SOURCE_SYSTEMS = Object.keys(PUSH_SOURCE_LABELS);

/**
 * True when a caller-supplied `sourceSystem` may be accepted by the public
 * Cases API. Managed-connector namespaces are reserved.
 */
export function isApiIngestableSourceSystem(value: string): boolean {
  if (value.length === 0 || value.length > MAX_SOURCE_SYSTEM_LENGTH) {
    return false;
  }
  if (!PUSH_SOURCE_SYSTEM_PATTERN.test(value)) return false;
  return !Object.prototype.hasOwnProperty.call(MANAGED_CONNECTOR_LABELS, value);
}

/**
 * Human label for a stored `source_system`. Managed connectors resolve by the
 * `<kind>` before the colon; known push producers resolve by exact slug; any
 * other value is title-cased so an unknown source is never mislabelled as one
 * Kelpie does know.
 */
export function sourceSystemLabel(
  value: string | null | undefined,
): string | null {
  if (!value) return null;
  const kind = value.includes(":") ? value.slice(0, value.indexOf(":")) : value;
  const managed = MANAGED_CONNECTOR_LABELS[kind];
  if (managed) return managed;
  const push = PUSH_SOURCE_LABELS[value];
  if (push) return push;
  const words = kind.split(/[_-]+/).filter(Boolean);
  if (words.length === 0) return null;
  return words.map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
}

/** True when the case originated from the Tawny push producer. */
export function isTawnySourceSystem(value: string | null | undefined): boolean {
  return value === TAWNY_SOURCE_SYSTEM;
}

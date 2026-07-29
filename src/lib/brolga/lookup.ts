import {
  mapObservableTypeToBrolgaKind,
  type BrolgaDetailLevel,
  type BrolgaLookupResult,
  type BrolgaPurpose,
} from "./types";
import { requestBrolgaContext } from "./client";

/**
 * Look up Brolga context for a case observable.
 * Safe to call when Brolga is offline — returns unconfigured/unavailable.
 */
export async function lookupBrolgaForObservable(input: {
  organisationId: string;
  type: string;
  value: string;
  caseId?: string;
  purpose?: BrolgaPurpose;
  detailLevel?: BrolgaDetailLevel;
}): Promise<BrolgaLookupResult> {
  return requestBrolgaContext(input.organisationId, {
    subject: {
      kind: mapObservableTypeToBrolgaKind(input.type),
      value: input.value.trim(),
    },
    purpose: input.purpose ?? "case_enrichment",
    detail_level: input.detailLevel ?? "L1",
    case_id: input.caseId,
    budgets: {
      max_objects: 40,
      max_bytes: 24_000,
      max_relationships: 20,
    },
  });
}

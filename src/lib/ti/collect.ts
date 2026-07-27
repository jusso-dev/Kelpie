import {
  countSkip,
  INVALID_INDICATOR_VALUE,
  type TiIndicatorType,
  type TiSkipCounts,
} from "./indicator-types";
import { normaliseIndicatorValue } from "./indicator-limits";
import { resolveIndicatorType } from "./normalise";
import type { RawIndicator, TiFeedFetchResult } from "./types";

export type IndicatorCandidate = {
  value: string;
  /** Type label supplied by the feed. Blank means "derive from the value". */
  rawType?: string;
  confidence?: number;
  tags?: string[];
  attributes?: Record<string, unknown>;
};

export type IndicatorCollector = {
  add(candidate: IndicatorCandidate): void;
  result(): TiFeedFetchResult;
};

/**
 * Shared accumulator every feed handler uses so the strict indicator contract
 * is applied identically across sources, and every refusal is counted rather
 * than silently dropped.
 */
export function createIndicatorCollector(): IndicatorCollector {
  const indicators: RawIndicator[] = [];
  const skippedByType: TiSkipCounts = {};

  return {
    add(candidate) {
      const value = normaliseIndicatorValue(candidate.value ?? "");
      if (!value) {
        countSkip(skippedByType, INVALID_INDICATOR_VALUE);
        return;
      }
      const resolved = resolveIndicatorType(candidate.rawType ?? "", value);
      if (!resolved.ok) {
        countSkip(skippedByType, resolved.rejectedType);
        return;
      }
      const type: TiIndicatorType = resolved.type;
      indicators.push({
        value,
        type,
        confidence: candidate.confidence,
        tags: candidate.tags,
        attributes: candidate.attributes,
      });
    },
    result() {
      return { indicators, skippedByType };
    },
  };
}

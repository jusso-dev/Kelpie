/**
 * Pure duplicate/related-case scoring. No DB access here — callers (the
 * "core" module, live create-case suggestions) resolve candidate case data
 * first, then pass it through this module so the matching logic stays
 * unit-testable without a database.
 */

const DUPLICATE_THRESHOLD = 70;
export const SUGGESTION_SCORE_THRESHOLD = 30;

export type ScoringCaseInput = {
  title: string;
  summary?: string | null;
  tags: string[];
  observableValues: string[];
  vendorSlugs: string[];
};

export type MatchedSignals = {
  titleSimilarity: number;
  sharedObservables: string[];
  sharedTags: string[];
  sharedVendors: string[];
};

export type CaseRelationshipScore = {
  score: number;
  matchedSignals: MatchedSignals;
  suggestedType: "duplicate_of" | "related_to";
};

export function normalizeObservableValue(value: string): string {
  return value.trim().toLowerCase().replace(/\.$/, "");
}

function normalizeTitleText(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function bigrams(value: string): string[] {
  if (value.length < 2) return value.length === 1 ? [value] : [];
  const out: string[] = [];
  for (let i = 0; i < value.length - 1; i++) out.push(value.slice(i, i + 2));
  return out;
}

/** Sorensen-Dice coefficient over character bigrams: robust to word reordering and minor phrasing differences in short titles. */
export function diceCoefficient(a: string, b: string): number {
  const na = normalizeTitleText(a);
  const nb = normalizeTitleText(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const bigramsA = bigrams(na);
  const bigramsB = bigrams(nb);
  if (bigramsA.length === 0 || bigramsB.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const bg of bigramsA) counts.set(bg, (counts.get(bg) ?? 0) + 1);
  let overlap = 0;
  for (const bg of bigramsB) {
    const remaining = counts.get(bg) ?? 0;
    if (remaining > 0) {
      overlap++;
      counts.set(bg, remaining - 1);
    }
  }
  return (2 * overlap) / (bigramsA.length + bigramsB.length);
}

function jaccard<T>(a: Set<T>, b: Set<T>): { ratio: number; shared: T[] } {
  if (a.size === 0 || b.size === 0) return { ratio: 0, shared: [] };
  const shared = [...a].filter((v) => b.has(v));
  const unionSize = new Set([...a, ...b]).size;
  return { ratio: unionSize === 0 ? 0 : shared.length / unionSize, shared };
}

export function scoreCaseRelationship(
  candidate: ScoringCaseInput,
  target: ScoringCaseInput,
): CaseRelationshipScore {
  const titleSimilarity = diceCoefficient(
    `${candidate.title} ${candidate.summary ?? ""}`,
    `${target.title} ${target.summary ?? ""}`,
  );

  const observableSetA = new Set(
    candidate.observableValues.map(normalizeObservableValue),
  );
  const observableSetB = new Set(
    target.observableValues.map(normalizeObservableValue),
  );
  const observableOverlap = jaccard(observableSetA, observableSetB);

  const tagOverlap = jaccard(new Set(candidate.tags), new Set(target.tags));
  const vendorOverlap = jaccard(
    new Set(candidate.vendorSlugs),
    new Set(target.vendorSlugs),
  );

  const score = Math.round(
    titleSimilarity * 40 +
      observableOverlap.ratio * 35 +
      tagOverlap.ratio * 15 +
      vendorOverlap.ratio * 10,
  );

  return {
    score: Math.max(0, Math.min(100, score)),
    matchedSignals: {
      titleSimilarity: Math.round(titleSimilarity * 100) / 100,
      sharedObservables: observableOverlap.shared,
      sharedTags: tagOverlap.shared,
      sharedVendors: vendorOverlap.shared,
    },
    suggestedType: score >= DUPLICATE_THRESHOLD ? "duplicate_of" : "related_to",
  };
}

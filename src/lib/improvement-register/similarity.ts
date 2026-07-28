/**
 * Similarity suggestions for the improvement register (issue #66).
 * Pure helpers — never auto-merge. Callers present matches with explained fields.
 */

import type { ImprovementRegisterType } from "./types";

const STOP_WORDS = new Set([
  "a",
  "an",
  "the",
  "and",
  "or",
  "of",
  "to",
  "for",
  "in",
  "on",
  "at",
  "by",
  "with",
  "from",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "this",
  "that",
  "these",
  "those",
  "it",
  "its",
  "as",
  "not",
  "no",
  "missing",
  "lack",
  "gap",
  "issue",
  "problem",
]);

export function tokenise(text: string): Set<string> {
  const tokens = new Set<string>();
  for (const raw of text.toLowerCase().split(/[^a-z0-9_]+/g)) {
    if (raw.length < 3) continue;
    if (STOP_WORDS.has(raw)) continue;
    tokens.add(raw);
  }
  return tokens;
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let inter = 0;
  for (const t of a) {
    if (b.has(t)) inter += 1;
  }
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

export type SimilarityCandidate = {
  id: string;
  type: ImprovementRegisterType;
  title: string;
  description: string | null;
  status: string;
  severity: string;
  recurrenceCount: number;
};

export type SimilarityMatch = {
  improvement: SimilarityCandidate;
  score: number;
  matchedFields: Array<{
    field: "type" | "title" | "description";
    detail: string;
  }>;
};

/**
 * Rank existing improvements against a proposed title/description/type.
 * Type match is a strong signal; title/description use token Jaccard.
 * Never returns a match with score 0; does not merge or mutate records.
 */
export function rankSimilarImprovements(
  query: {
    type?: ImprovementRegisterType;
    title: string;
    description?: string | null;
  },
  candidates: SimilarityCandidate[],
  opts: { limit?: number; minScore?: number } = {},
): SimilarityMatch[] {
  const limit = opts.limit ?? 5;
  const minScore = opts.minScore ?? 0.15;
  const titleTokens = tokenise(query.title);
  const descTokens = tokenise(query.description ?? "");

  const ranked: SimilarityMatch[] = [];
  for (const c of candidates) {
    const matchedFields: SimilarityMatch["matchedFields"] = [];
    let score = 0;

    if (query.type && c.type === query.type) {
      score += 0.35;
      matchedFields.push({
        field: "type",
        detail: `Same improvement type: ${c.type}`,
      });
    }

    const cTitle = tokenise(c.title);
    const titleScore = jaccard(titleTokens, cTitle);
    if (titleScore > 0) {
      score += titleScore * 0.45;
      const overlap = [...titleTokens].filter((t) => cTitle.has(t));
      matchedFields.push({
        field: "title",
        detail: `Title token overlap (${Math.round(titleScore * 100)}%): ${overlap.slice(0, 8).join(", ")}`,
      });
    }

    if (descTokens.size > 0) {
      const cDesc = tokenise(c.description ?? "");
      const descScore = jaccard(descTokens, cDesc);
      if (descScore > 0) {
        score += descScore * 0.2;
        const overlap = [...descTokens].filter((t) => cDesc.has(t));
        matchedFields.push({
          field: "description",
          detail: `Description token overlap (${Math.round(descScore * 100)}%): ${overlap.slice(0, 8).join(", ")}`,
        });
      }
    }

    // Cap at 1.0 for readability.
    score = Math.min(1, score);
    if (score >= minScore && matchedFields.length > 0) {
      ranked.push({ improvement: c, score, matchedFields });
    }
  }

  ranked.sort((a, b) => b.score - a.score || a.improvement.id.localeCompare(b.improvement.id));
  return ranked.slice(0, limit);
}

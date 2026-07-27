"use client";

import { useCallback, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { getRelationshipSuggestionsForDraft } from "@/actions/case-relationships";
import type { SuggestionView } from "@/lib/case-relationships-core";

const DEBOUNCE_MS = 400;

/**
 * Wraps the title/summary fields of the new-case form (an uncontrolled,
 * server-action-submitted form) with a small client island that watches
 * those fields for changes and surfaces possibly-related existing cases.
 * Purely advisory: no dismiss/link actions, since the case doesn't exist yet.
 */
export default function RelatedCaseSuggestions({ children }: { children: React.ReactNode }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [suggestions, setSuggestions] = useState<SuggestionView[]>([]);
  const [checking, setChecking] = useState(false);
  const [isPending, startTransition] = useTransition();

  const handleInput = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);

    const titleEl = containerRef.current?.querySelector<HTMLInputElement>('[name="title"]');
    const summaryEl = containerRef.current?.querySelector<HTMLTextAreaElement>('[name="summary"]');
    const title = titleEl?.value.trim() ?? "";
    const summary = summaryEl?.value.trim() ?? "";

    if (!title) {
      setSuggestions([]);
      setChecking(false);
      return;
    }

    setChecking(true);
    timerRef.current = setTimeout(() => {
      startTransition(async () => {
        try {
          const results = await getRelationshipSuggestionsForDraft(title, summary, []);
          setSuggestions(results);
        } catch {
          setSuggestions([]);
        } finally {
          setChecking(false);
        }
      });
    }, DEBOUNCE_MS);
  }, []);

  const showChecking = checking || isPending;

  return (
    <div ref={containerRef} onInput={handleInput}>
      {children}
      {showChecking ? (
        <p className="text-xs text-slate-500 mt-2">Checking for related cases…</p>
      ) : suggestions.length > 0 ? (
        <div className="kelpie-field mt-2">
          <span className="kelpie-label">Possibly related</span>
          <ul className="space-y-1">
            {suggestions.map((suggestion) => (
              <li key={suggestion.candidateCase.id} className="text-xs">
                <Link href={`/cases/${suggestion.candidateCase.id}`} className="kelpie-link">
                  Possibly related: Case #{suggestion.candidateCase.caseNumber} —{" "}
                  {suggestion.candidateCase.title} ({suggestion.score}% match)
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

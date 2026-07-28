"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { searchAttackTechniques } from "@/actions/attack";

export type TechniqueOption = {
  techniqueId: string;
  name: string;
  tactics: Array<{ id: string; name: string }>;
  deprecated: boolean;
};

/**
 * Keyboard-navigable technique search combobox: ArrowUp/ArrowDown move the
 * active option, Enter selects it, Escape closes the list. Mirrors the
 * interaction pattern in `creatable-tag-input.tsx` (the only other
 * keyboard-navigable combobox in the app) rather than introducing a new one.
 */
export default function AttackTechniqueCombobox({
  onSelect,
  placeholder = "Search by technique id, name, or tactic…",
}: {
  onSelect: (technique: TechniqueOption) => void;
  placeholder?: string;
}) {
  const id = useId();
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<TechniqueOption[]>([]);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [debounceHandle, setDebounceHandle] = useState<ReturnType<typeof setTimeout> | null>(null);

  const showEmpty = open && !loading && !error && query.trim().length > 0 && options.length === 0;

  function runSearch(value: string) {
    setLoading(true);
    setError(null);
    searchAttackTechniques(value)
      .then((rows) => {
        setOptions(
          rows.map((r) => ({
            techniqueId: r.techniqueId,
            name: r.name,
            tactics: (r.tactics as Array<{ id: string; name: string }>) ?? [],
            deprecated: r.deprecated,
          })),
        );
        setActiveIndex(0);
      })
      .catch(() => {
        setError("Technique search failed. Try again.");
        setOptions([]);
      })
      .finally(() => setLoading(false));
  }

  function onChange(value: string) {
    setQuery(value);
    setOpen(true);
    if (debounceHandle) clearTimeout(debounceHandle);
    if (!value.trim()) {
      setOptions([]);
      return;
    }
    setDebounceHandle(setTimeout(() => runSearch(value), 200));
  }

  function select(option: TechniqueOption) {
    onSelect(option);
    setQuery("");
    setOptions([]);
    setOpen(false);
    router.refresh();
  }

  const listId = `${id}-listbox`;

  return (
    <div className="relative">
      <label htmlFor={`${id}-input`} className="kelpie-sr-only">
        Search ATT&CK techniques
      </label>
      <input
        id={`${id}-input`}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        className="kelpie-input"
        placeholder={placeholder}
        value={query}
        onFocus={() => {
          if (options.length > 0) setOpen(true);
        }}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && options.length > 0) {
            e.preventDefault();
            setOpen(true);
            setActiveIndex((i) => (i + 1) % options.length);
          } else if (e.key === "ArrowUp" && options.length > 0) {
            e.preventDefault();
            setActiveIndex((i) => (i - 1 + options.length) % options.length);
          } else if (e.key === "Enter" && options[activeIndex]) {
            e.preventDefault();
            select(options[activeIndex]);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
      />
      {open && (loading || error || options.length > 0 || showEmpty) ? (
        <div
          id={listId}
          role="listbox"
          className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded border border-[color:var(--color-navy-600)] bg-[color:var(--color-navy-800)] p-1 shadow-xl"
        >
          {loading ? <p className="px-3 py-2 text-xs text-slate-400">Searching…</p> : null}
          {error ? <p className="px-3 py-2 text-xs text-red-400" role="alert">{error}</p> : null}
          {showEmpty ? (
            <p className="px-3 py-2 text-xs text-slate-500">No matching techniques.</p>
          ) : null}
          {options.map((option, index) => (
            <button
              key={option.techniqueId}
              type="button"
              role="option"
              aria-selected={index === activeIndex}
              className={`flex w-full items-center justify-between gap-2 rounded px-3 py-2 text-left text-sm ${
                index === activeIndex
                  ? "bg-[color:var(--color-navy-700)] text-slate-100"
                  : "text-slate-300 hover:bg-[color:var(--color-navy-700)]"
              }`}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => select(option)}
            >
              <span className="flex items-center gap-2 truncate">
                <span className="font-mono text-xs text-slate-400">{option.techniqueId}</span>
                <span className="truncate">{option.name}</span>
                {option.deprecated ? (
                  <span className="kelpie-badge shrink-0 text-slate-500">deprecated</span>
                ) : null}
              </span>
              <span className="shrink-0 text-xs text-slate-500">
                {option.tactics.map((t) => t.name).join(", ")}
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

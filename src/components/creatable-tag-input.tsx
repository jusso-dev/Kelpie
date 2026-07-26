"use client";

import { useId, useMemo, useState } from "react";
import { normalizeTag, normalizeTags } from "@/lib/tags";

export default function CreatableTagInput({
  name,
  label,
  suggestions,
  help,
}: {
  name: string;
  label: string;
  suggestions: string[];
  help: string;
}) {
  const id = useId();
  const [tags, setTags] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const normalizedQuery = normalizeTag(query);
  const options = useMemo(
    () =>
      normalizeTags(suggestions)
        .filter((option) => !tags.includes(option))
        .filter((option) => option.includes(normalizedQuery))
        .slice(0, 8),
    [normalizedQuery, suggestions, tags],
  );
  const canCreate =
    normalizedQuery.length > 0 &&
    !tags.includes(normalizedQuery) &&
    !options.includes(normalizedQuery);
  const choices = canCreate
    ? [{ value: normalizedQuery, create: true }, ...options.map((value) => ({ value, create: false }))]
    : options.map((value) => ({ value, create: false }));

  function add(value: string) {
    const normalized = normalizeTag(value);
    if (!normalized || tags.includes(normalized)) return;
    setTags((current) => normalizeTags([...current, normalized]));
    setQuery("");
    setActiveIndex(0);
    setOpen(false);
  }

  function remove(value: string) {
    setTags((current) => current.filter((tag) => tag !== value));
  }

  return (
    <div className="kelpie-field">
      <label
        id={`${id}-label`}
        htmlFor={`${id}-input`}
        className="kelpie-label"
      >
        {label}
      </label>
      <input type="hidden" name={name} value={tags.join(",")} />
      <div className="relative">
        <div className="flex min-h-10 flex-wrap items-center gap-2 rounded-lg border border-[color:var(--color-navy-700)] bg-[color:var(--color-navy-950)] px-3 py-1.5 focus-within:border-[color:var(--color-tan-400)] focus-within:outline-2 focus-within:outline-offset-1 focus-within:outline-[color:color-mix(in_oklch,var(--color-tan-500)_55%,transparent)]">
          {tags.map((tag) => (
            <span key={tag} className="kelpie-badge flex items-center gap-1 text-slate-200">
              {tag}
              <button
                type="button"
                className="rounded px-1 text-slate-500 hover:text-slate-100"
                aria-label={`Remove ${tag}`}
                onClick={() => remove(tag)}
              >
                ×
              </button>
            </span>
          ))}
          <input
            id={`${id}-input`}
            role="combobox"
            aria-expanded={open}
            aria-controls={`${id}-options`}
            aria-labelledby={`${id}-label`}
            aria-autocomplete="list"
            className="min-w-36 flex-1 border-0 bg-transparent py-1 text-sm text-slate-100 outline-none placeholder:text-slate-600"
            value={query}
            placeholder={tags.length === 0 ? "Choose or type a tag…" : "Add another…"}
            onFocus={() => setOpen(true)}
            onBlur={() => setOpen(false)}
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveIndex(0);
              setOpen(true);
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown" && choices.length > 0) {
                event.preventDefault();
                setActiveIndex((index) => (index + 1) % choices.length);
              } else if (event.key === "ArrowUp" && choices.length > 0) {
                event.preventDefault();
                setActiveIndex(
                  (index) => (index - 1 + choices.length) % choices.length,
                );
              } else if (
                (event.key === "Enter" || event.key === ",") &&
                (choices[activeIndex] || normalizedQuery)
              ) {
                event.preventDefault();
                add(choices[activeIndex]?.value ?? normalizedQuery);
              } else if (
                event.key === "Backspace" &&
                !query &&
                tags.length > 0
              ) {
                remove(tags[tags.length - 1]);
              } else if (event.key === "Escape") {
                setOpen(false);
              }
            }}
          />
        </div>
        {open && choices.length > 0 ? (
          <div
            id={`${id}-options`}
            role="listbox"
            className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded border border-[color:var(--color-navy-600)] bg-[color:var(--color-navy-800)] p-1 shadow-xl"
          >
            {choices.map((choice, index) => (
              <button
                key={`${choice.create ? "create" : "existing"}-${choice.value}`}
                type="button"
                role="option"
                aria-selected={index === activeIndex}
                className={`flex w-full items-center justify-between rounded px-3 py-2 text-left text-sm ${
                  index === activeIndex
                    ? "bg-[color:var(--color-navy-700)] text-slate-100"
                    : "text-slate-300 hover:bg-[color:var(--color-navy-700)]"
                }`}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => add(choice.value)}
              >
                <span>{choice.value}</span>
                {choice.create ? (
                  <span className="text-xs text-slate-500">Create new</span>
                ) : null}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      <p className="kelpie-help">{help}</p>
    </div>
  );
}

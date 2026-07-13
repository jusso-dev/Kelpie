import Link from "next/link";
import { SearchX } from "lucide-react";

export default function MissingRecord({
  record,
  description,
  primaryHref,
  primaryLabel,
}: {
  record: string;
  description: string;
  primaryHref: string;
  primaryLabel: string;
}) {
  return (
    <section className="mx-auto max-w-2xl py-10 sm:py-16" aria-labelledby="missing-record-title">
      <div className="kelpie-card px-5 py-10 text-center sm:px-10">
        <SearchX className="mx-auto text-slate-500" size={30} aria-hidden="true" />
        <p className="mt-4 text-xs font-medium uppercase tracking-wider text-[color:var(--color-tan-300)]">
          Record unavailable
        </p>
        <h1 id="missing-record-title" className="mt-2 text-2xl font-semibold text-slate-50">
          {record} not found
        </h1>
        <p className="mx-auto mt-3 max-w-lg text-sm leading-6 text-slate-400">
          {description}
        </p>
        <div className="mt-6 flex flex-col justify-center gap-2 sm:flex-row">
          <Link href={primaryHref} className="kelpie-btn kelpie-btn-primary">
            {primaryLabel}
          </Link>
          <Link href="/dashboard" className="kelpie-btn kelpie-btn-secondary">
            Go to overview
          </Link>
        </div>
      </div>
    </section>
  );
}

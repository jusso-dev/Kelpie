import Link from "next/link";
import { Compass } from "lucide-react";

export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <section className="kelpie-card w-full max-w-lg px-6 py-12 text-center" aria-labelledby="not-found-title">
        <Compass className="mx-auto text-[color:var(--color-tan-300)]" size={32} aria-hidden="true" />
        <p className="mt-4 text-xs font-medium uppercase tracking-wider text-[color:var(--color-tan-300)]">
          404 · Page unavailable
        </p>
        <h1 id="not-found-title" className="mt-2 text-2xl font-semibold text-slate-50">
          That address does not lead anywhere
        </h1>
        <p className="mt-3 text-sm leading-6 text-slate-400">
          The link may be out of date. Return to Kelpie and continue from a known page.
        </p>
        <div className="mt-6 flex flex-col justify-center gap-2 sm:flex-row">
          <Link href="/" className="kelpie-btn kelpie-btn-primary">Return to Kelpie</Link>
          <Link href="/sign-in" className="kelpie-btn kelpie-btn-secondary">Sign in</Link>
        </div>
      </section>
    </main>
  );
}

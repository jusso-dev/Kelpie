import { ExternalLink, Newspaper } from "lucide-react";
import { formatDistanceToNowStrict } from "date-fns";
import { requireUser } from "@/lib/session";
import { getCyberNews } from "@/lib/cyber-news";

export default async function CyberBriefingPage() {
  await requireUser();
  const result = await getCyberNews();

  return (
    <div className="kelpie-page max-w-6xl">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-50">Cyber brief</h1>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-400">
            Recent reporting from public cyber authorities. Open the source and
            verify details before using them in a case.
          </p>
        </div>
        <p className="text-xs text-slate-500">
          Refreshed{" "}
          {formatDistanceToNowStrict(new Date(result.refreshedAt), {
            addSuffix: true,
          })}
        </p>
      </header>

      {result.failedSources.length ? (
        <div className="kelpie-notice kelpie-notice-warning" role="status">
          <strong>Some sources are temporarily unavailable.</strong>
          <span>
            Showing everything received successfully. Could not refresh{" "}
            {result.failedSources.join(", ")}.
          </span>
        </div>
      ) : null}

      {result.items.length === 0 ? (
        <div className="kelpie-empty">
          <Newspaper size={22} aria-hidden="true" />
          <h2>No brief available</h2>
          <p>The public feeds could not be read. Try again later.</p>
        </div>
      ) : (
        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {result.items.map((item) => (
            <article key={item.id} className="kelpie-card flex min-h-56 flex-col p-5">
              <div className="flex items-center justify-between gap-3">
                <a
                  href={item.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="kelpie-badge hover:text-slate-100"
                >
                  {item.source}
                </a>
                {item.publishedAt ? (
                  <time
                    dateTime={item.publishedAt}
                    className="shrink-0 text-xs text-slate-500"
                  >
                    {formatDistanceToNowStrict(new Date(item.publishedAt), {
                      addSuffix: true,
                    })}
                  </time>
                ) : null}
              </div>
              <h2 className="mt-4 text-base font-semibold leading-6 text-slate-100">
                {item.title}
              </h2>
              {item.summary ? (
                <p className="mt-2 line-clamp-4 text-sm leading-6 text-slate-400">
                  {item.summary}
                </p>
              ) : null}
              <a
                href={item.url}
                target="_blank"
                rel="noreferrer"
                className="kelpie-link mt-auto inline-flex items-center gap-1 pt-5 text-sm"
              >
                Read at source
                <ExternalLink size={14} aria-hidden="true" />
                <span className="sr-only">: {item.title}</span>
              </a>
            </article>
          ))}
        </section>
      )}
    </div>
  );
}

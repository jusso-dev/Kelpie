import Link from "next/link";
import { PAGE_HELP, type PageHelpKey } from "@/lib/page-help";

/**
 * Short-form page explainer under a title, with link into /guides.
 */
export default function PageExplainer({
  page,
  className = "mt-2 max-w-2xl",
}: {
  page: PageHelpKey;
  className?: string;
}) {
  const help = PAGE_HELP[page];
  return (
    <div className={className}>
      <p className="text-sm leading-6 text-slate-400">{help.summary}</p>
      <p className="mt-1 text-xs text-slate-500">
        <Link
          href={help.guideHref}
          className="font-medium text-[color:var(--color-tan-300)] hover:underline"
        >
          Full guide
        </Link>
        {help.tip ? (
          <>
            <span className="mx-1.5 text-slate-600" aria-hidden="true">
              ·
            </span>
            <span>{help.tip}</span>
          </>
        ) : null}
      </p>
    </div>
  );
}

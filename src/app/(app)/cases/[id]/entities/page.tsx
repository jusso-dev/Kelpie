import { requireUser } from "@/lib/session";
import { listEntitiesForCaseCore } from "@/lib/investigations/alerts-core";
import { listIdentifiersForEntity } from "@/lib/investigations/entities-core";
import { format } from "date-fns";

type Props = { params: Promise<{ id: string }> };

export default async function CaseEntitiesPage({ params }: Props) {
  const { id } = await params;
  const user = await requireUser();

  let entities: Awaited<ReturnType<typeof listEntitiesForCaseCore>>["items"] = [];
  let loadError: string | null = null;
  try {
    const page = await listEntitiesForCaseCore(user.organisationId, id, { limit: 100 });
    entities = page.items;
  } catch {
    loadError = "Entities could not be loaded. Try reloading this page.";
  }

  if (loadError) {
    return (
      <div className="kelpie-card p-8 text-center text-sm text-red-400" role="alert">
        {loadError}
      </div>
    );
  }

  if (entities.length === 0) {
    return (
      <div className="kelpie-card p-8 text-center text-sm text-slate-500">
        No entities linked to this case&apos;s alerts yet.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {await Promise.all(
        entities.map(async (entity) => {
          const identifiers = await listIdentifiersForEntity(entity.id, user.organisationId);
          return (
            <div key={entity.id} className="kelpie-card p-4" aria-label={`Entity: ${entity.displayName}`}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs uppercase tracking-wider text-slate-500">
                  {entity.type.replace(/_/g, " ")}
                </span>
                <span className="font-medium text-slate-100">{entity.displayName}</span>
                {entity.riskScore !== null ? (
                  <span className="kelpie-badge text-amber-400">risk {entity.riskScore}</span>
                ) : null}
                <span className="text-xs text-slate-500 sm:ml-auto">
                  last seen {format(entity.lastSeenAt, "PP p")}
                </span>
              </div>
              {identifiers.length > 0 ? (
                <ul className="mt-2 flex flex-wrap gap-2 text-xs">
                  {identifiers.map((ident) => (
                    <li
                      key={ident.id}
                      className="rounded border border-[color:var(--color-navy-700)] px-2 py-1 font-mono text-slate-300"
                    >
                      {ident.kind}: {ident.value}
                    </li>
                  ))}
                </ul>
              ) : null}
              {entity.notes ? (
                <p className="mt-2 text-sm text-slate-400">{entity.notes}</p>
              ) : null}
            </div>
          );
        }),
      )}
    </div>
  );
}

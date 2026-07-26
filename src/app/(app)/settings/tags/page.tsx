import Link from "next/link";
import { requireUser } from "@/lib/session";
import { getTeamTags } from "@/lib/team-tags";
import TeamTagSettings from "@/components/team-tag-settings";
import { TagBadge } from "@/components/badges";

export default async function TeamTagsSettingsPage() {
  const user = await requireUser();
  const tags = await getTeamTags(user.organisationId);
  const isAdmin = user.role === "admin";

  return (
    <div className="kelpie-page max-w-4xl">
      <header>
        <Link
          href="/settings"
          className="text-xs text-slate-400 hover:text-slate-200"
        >
          ← Settings
        </Link>
        <h1 className="mt-1 text-2xl font-semibold">Team tags</h1>
        <p>
          Maintain consistent case and data-handling labels for your
          organisation.
        </p>
      </header>

      <section className="kelpie-section">
        <div className="kelpie-section-header">
          <h2>Suggested tags</h2>
          <p>
            Analysts see these first when creating cases. They can still add a
            new tag when an investigation needs one.
          </p>
        </div>
        {isAdmin ? (
          <TeamTagSettings
            caseTags={tags.caseTags}
            dataClassificationTags={tags.dataClassificationTags}
          />
        ) : (
          <div className="space-y-4">
            <TagList label="Case tags" tags={tags.caseTags} />
            <TagList
              label="Data classification tags"
              tags={tags.dataClassificationTags}
            />
            <p className="text-xs text-slate-500">
              Only administrators can change team tags.
            </p>
          </div>
        )}
      </section>

      <p className="text-sm text-slate-400">
        Need examples?{" "}
        <Link
          href="/guides#tags-and-custom-fields"
          className="text-[color:var(--color-tan-300)] hover:underline"
        >
          Read the tags and custom fields guide
        </Link>
        .
      </p>
    </div>
  );
}

function TagList({ label, tags }: { label: string; tags: string[] }) {
  return (
    <div>
      <h2 className="text-sm font-medium text-slate-200">{label}</h2>
      <div className="mt-2 flex flex-wrap gap-2">
        {tags.length > 0 ? (
          tags.map((tag) => <TagBadge key={tag} value={tag} />)
        ) : (
          <span className="text-sm text-slate-500">None configured.</span>
        )}
      </div>
    </div>
  );
}

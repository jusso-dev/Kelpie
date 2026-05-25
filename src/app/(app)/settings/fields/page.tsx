import Link from "next/link";
import { requireUser } from "@/lib/session";
import { listFieldDefinitions } from "@/lib/custom-fields";
import CustomFieldSettings from "@/components/custom-field-settings";

export default async function CustomFieldsSettingsPage() {
  const user = await requireUser();
  const isAdmin = user.role === "admin";
  const fields = await listFieldDefinitions(user.organisationId, {
    entity: "case",
  });

  return (
    <div className="space-y-6 max-w-4xl">
      <header>
        <Link href="/settings" className="text-xs text-slate-400 hover:text-slate-200">
          ← Settings
        </Link>
        <h1 className="text-2xl font-semibold mt-1">Custom fields</h1>
        <p className="text-sm text-slate-400">
          Add fields to every case without code. They render on the case detail
          and are exposed on the API.
        </p>
      </header>

      <section className="kelpie-card p-5">
        <CustomFieldSettings
          fields={fields.map((f) => ({
            id: f.id,
            key: f.key,
            label: f.label,
            type: f.type,
            options: f.options,
            required: f.required,
            isActive: f.isActive,
          }))}
          isAdmin={isAdmin}
        />
      </section>
    </div>
  );
}

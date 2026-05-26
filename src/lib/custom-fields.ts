import { db } from "@/db";
import { customFieldDefinitions, customFieldValues } from "@/db/schema";
import { and, asc, eq, inArray } from "drizzle-orm";
import { newId } from "./utils";
import { writeTimelineEvent } from "./timeline";

export const CUSTOM_FIELD_TYPES = [
  "string",
  "number",
  "date",
  "select",
  "multi_select",
  "bool",
] as const;
export type CustomFieldType = (typeof CUSTOM_FIELD_TYPES)[number];

export type CustomFieldDefinitionView = {
  id: string;
  key: string;
  label: string;
  type: CustomFieldType;
  options: string[];
  required: boolean;
  orderIndex: number;
  isActive: boolean;
};

export type CustomFieldWithValue = CustomFieldDefinitionView & {
  value: unknown;
};

export async function listFieldDefinitions(
  organisationId: string,
  opts: { entity?: string; activeOnly?: boolean } = {},
): Promise<CustomFieldDefinitionView[]> {
  const entity = opts.entity ?? "case";
  const filters = [
    eq(customFieldDefinitions.organisationId, organisationId),
    eq(customFieldDefinitions.entity, entity),
  ];
  if (opts.activeOnly) filters.push(eq(customFieldDefinitions.isActive, true));
  const rows = await db
    .select()
    .from(customFieldDefinitions)
    .where(and(...filters))
    .orderBy(asc(customFieldDefinitions.orderIndex));
  return rows.map((r) => ({
    id: r.id,
    key: r.key,
    label: r.label,
    type: r.type as CustomFieldType,
    options: Array.isArray(r.options) ? (r.options as string[]) : [],
    required: r.required,
    orderIndex: r.orderIndex,
    isActive: r.isActive,
  }));
}

/** Definitions plus the current value for an entity, ready to render or serialise. */
export async function getCustomFieldsForEntity(
  organisationId: string,
  entityId: string,
  entity = "case",
): Promise<CustomFieldWithValue[]> {
  const defs = await listFieldDefinitions(organisationId, {
    entity,
    activeOnly: true,
  });
  if (defs.length === 0) return [];
  const values = await db
    .select()
    .from(customFieldValues)
    .where(
      and(
        eq(customFieldValues.entityId, entityId),
        inArray(
          customFieldValues.fieldId,
          defs.map((d) => d.id),
        ),
      ),
    );
  const byField = new Map(values.map((v) => [v.fieldId, v.value]));
  return defs.map((d) => ({ ...d, value: byField.get(d.id) ?? null }));
}

/** Serialise to the API shape: { [key]: value }. */
export async function customFieldsRecord(
  organisationId: string,
  entityId: string,
  entity = "case",
): Promise<Record<string, unknown>> {
  const fields = await getCustomFieldsForEntity(organisationId, entityId, entity);
  const out: Record<string, unknown> = {};
  for (const f of fields) out[f.key] = f.value;
  return out;
}

export function coerceValue(
  def: Pick<CustomFieldDefinitionView, "type" | "options" | "label" | "required">,
  raw: unknown,
): unknown {
  if (raw === null || raw === undefined || raw === "") {
    if (def.required) throw new Error(`${def.label} is required`);
    return null;
  }
  switch (def.type) {
    case "string":
      return String(raw);
    case "number": {
      const n = Number(raw);
      if (!Number.isFinite(n)) throw new Error(`${def.label} must be a number`);
      return n;
    }
    case "date": {
      const d = new Date(String(raw));
      if (Number.isNaN(d.getTime())) throw new Error(`${def.label} must be a date`);
      return d.toISOString().slice(0, 10);
    }
    case "bool":
      return raw === true || raw === "true" || raw === "on" || raw === "1";
    case "select": {
      const v = String(raw);
      if (!def.options.includes(v)) {
        throw new Error(`${def.label} must be one of: ${def.options.join(", ")}`);
      }
      return v;
    }
    case "multi_select": {
      const arr = Array.isArray(raw)
        ? raw.map(String)
        : String(raw)
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);
      for (const v of arr) {
        if (!def.options.includes(v)) {
          throw new Error(`${def.label}: ${v} is not an allowed option`);
        }
      }
      return arr;
    }
    default:
      return String(raw);
  }
}

async function loadDefinition(organisationId: string, fieldId: string) {
  const [def] = await db
    .select()
    .from(customFieldDefinitions)
    .where(
      and(
        eq(customFieldDefinitions.id, fieldId),
        eq(customFieldDefinitions.organisationId, organisationId),
      ),
    )
    .limit(1);
  return def ?? null;
}

export async function setCustomFieldValue(
  organisationId: string,
  actorId: string | null,
  entityId: string,
  fieldId: string,
  raw: unknown,
  opts: { writeTimeline?: boolean; entity?: string } = {},
): Promise<void> {
  const def = await loadDefinition(organisationId, fieldId);
  if (!def) throw new Error("Custom field not found");
  const view: CustomFieldDefinitionView = {
    id: def.id,
    key: def.key,
    label: def.label,
    type: def.type as CustomFieldType,
    options: Array.isArray(def.options) ? (def.options as string[]) : [],
    required: def.required,
    orderIndex: def.orderIndex,
    isActive: def.isActive,
  };
  const value = coerceValue(view, raw);

  await db
    .insert(customFieldValues)
    .values({
      id: newId("cfv"),
      entity: opts.entity ?? def.entity,
      entityId,
      fieldId,
      value: value as never,
    })
    .onConflictDoUpdate({
      target: [customFieldValues.entityId, customFieldValues.fieldId],
      set: { value: value as never },
    });

  if (opts.writeTimeline && (opts.entity ?? def.entity) === "case") {
    await writeTimelineEvent({
      caseId: entityId,
      actorId,
      eventType: "custom_field_changed",
      payload: { key: def.key, label: def.label, value },
    });
  }
}

/** Set values keyed by field key; used by the API PATCH and template apply. */
export async function setCustomFieldsByKey(
  organisationId: string,
  actorId: string | null,
  entityId: string,
  values: Record<string, unknown>,
  opts: { writeTimeline?: boolean; entity?: string } = {},
): Promise<void> {
  const defs = await listFieldDefinitions(organisationId, {
    entity: opts.entity ?? "case",
    activeOnly: true,
  });
  const byKey = new Map(defs.map((d) => [d.key, d]));
  for (const [key, raw] of Object.entries(values)) {
    const def = byKey.get(key);
    if (!def) continue;
    await setCustomFieldValue(organisationId, actorId, entityId, def.id, raw, opts);
  }
}

/** Case ids whose value for a field equals the given value (basic filter). */
export async function findEntitiesByFieldValue(
  organisationId: string,
  fieldId: string,
  value: string,
): Promise<string[]> {
  const def = await loadDefinition(organisationId, fieldId);
  if (!def) return [];
  const rows = await db
    .select({ entityId: customFieldValues.entityId, value: customFieldValues.value })
    .from(customFieldValues)
    .where(eq(customFieldValues.fieldId, fieldId));
  return rows
    .filter((r) => {
      if (Array.isArray(r.value)) return (r.value as unknown[]).map(String).includes(value);
      return String(r.value) === value;
    })
    .map((r) => r.entityId);
}

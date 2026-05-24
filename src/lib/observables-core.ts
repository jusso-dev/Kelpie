import { db } from "@/db";
import { cases, observables } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { newId } from "./utils";
import { writeTimelineEvent } from "./timeline";

const TYPES = [
  "ip",
  "domain",
  "url",
  "file_hash",
  "email",
  "hostname",
  "username",
  "registry_key",
  "other",
] as const;
const TLPS = ["clear", "green", "amber", "amber_strict", "red"] as const;

export const OBSERVABLE_TYPES = TYPES;
export const OBSERVABLE_TLPS = TLPS;
export type ObservableType = (typeof TYPES)[number];
export type ObservableTlp = (typeof TLPS)[number];

export async function addObservableCore(
  organisationId: string,
  actorId: string | null,
  caseId: string,
  input: {
    type: ObservableType;
    value: string;
    tlp?: ObservableTlp;
    description?: string | null;
    isIoc?: boolean;
    tags?: string[];
  },
): Promise<{ id: string }> {
  const [c] = await db
    .select({ id: cases.id })
    .from(cases)
    .where(and(eq(cases.id, caseId), eq(cases.organisationId, organisationId)))
    .limit(1);
  if (!c) throw new Error("Case not found");
  const id = newId("obs");
  await db.insert(observables).values({
    id,
    caseId,
    type: input.type,
    value: input.value,
    tlp: input.tlp ?? "amber",
    isIoc: input.isIoc ?? false,
    description: input.description ?? null,
    tags: input.tags ?? [],
    createdBy: actorId,
  });
  await writeTimelineEvent({
    caseId,
    actorId,
    eventType: "observable_added",
    payload: { observable_id: id, type: input.type, value: input.value, is_ioc: input.isIoc ?? false },
  });
  return { id };
}

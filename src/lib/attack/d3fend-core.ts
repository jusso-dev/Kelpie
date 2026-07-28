/**
 * Optional, versioned D3FEND countermeasure mappings, linked to this
 * organisation's own playbook steps and/or response actions. Entirely
 * administrator/analyst curated — Kelpie never infers or auto-populates a
 * countermeasure link.
 */
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  d3fendMappings,
  playbooks,
  responseActions,
  type D3fendMapping,
} from "@/db/schema";
import { newId } from "@/lib/utils";
import { D3FEND_CATALOG_VERSION } from "./d3fend-baseline";

export class D3fendMappingError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "D3fendMappingError";
    this.status = status;
  }
}

export type D3fendMappingInput = {
  catalogVersion?: string;
  d3fendTechniqueId: string;
  d3fendTechniqueName: string;
  attackTechniqueIds?: string[];
  playbookId?: string | null;
  playbookStepId?: string | null;
  responseActionId?: string | null;
  notes?: string | null;
};

export async function createD3fendMappingCore(
  organisationId: string,
  actorId: string | null,
  input: D3fendMappingInput,
): Promise<D3fendMapping> {
  const d3fendTechniqueId = input.d3fendTechniqueId.trim();
  const d3fendTechniqueName = input.d3fendTechniqueName.trim();
  if (!d3fendTechniqueId || !d3fendTechniqueName) {
    throw new D3fendMappingError("A D3FEND technique id and name are required");
  }
  if (!input.playbookId && !input.responseActionId) {
    throw new D3fendMappingError(
      "A D3FEND mapping must link to a playbook step or a response action",
    );
  }
  if (input.playbookId) {
    const [pb] = await db
      .select({ id: playbooks.id })
      .from(playbooks)
      .where(and(eq(playbooks.id, input.playbookId), eq(playbooks.organisationId, organisationId)))
      .limit(1);
    if (!pb) throw new D3fendMappingError("Playbook not found", 404);
  }
  if (input.responseActionId) {
    const [ra] = await db
      .select({ id: responseActions.id })
      .from(responseActions)
      .where(
        and(
          eq(responseActions.id, input.responseActionId),
          eq(responseActions.organisationId, organisationId),
        ),
      )
      .limit(1);
    if (!ra) throw new D3fendMappingError("Response action not found", 404);
  }

  const id = newId("d3fend");
  const [inserted] = await db
    .insert(d3fendMappings)
    .values({
      id,
      organisationId,
      catalogVersion: input.catalogVersion?.trim() || D3FEND_CATALOG_VERSION,
      d3fendTechniqueId,
      d3fendTechniqueName,
      attackTechniqueIds: (input.attackTechniqueIds ?? []).map((t) => t.trim().toUpperCase()),
      playbookId: input.playbookId ?? null,
      playbookStepId: input.playbookStepId ?? null,
      responseActionId: input.responseActionId ?? null,
      notes: input.notes?.trim() || null,
      createdBy: actorId,
    })
    .returning();
  if (!inserted) throw new D3fendMappingError("D3FEND mapping could not be created");
  return inserted;
}

export async function listD3fendMappingsCore(
  organisationId: string,
  filter: { playbookId?: string; responseActionId?: string } = {},
): Promise<D3fendMapping[]> {
  const filters = [eq(d3fendMappings.organisationId, organisationId)];
  if (filter.playbookId) filters.push(eq(d3fendMappings.playbookId, filter.playbookId));
  if (filter.responseActionId) {
    filters.push(eq(d3fendMappings.responseActionId, filter.responseActionId));
  }
  return db
    .select()
    .from(d3fendMappings)
    .where(and(...filters));
}

export async function removeD3fendMappingCore(
  organisationId: string,
  mappingId: string,
): Promise<void> {
  const [existing] = await db
    .select({ id: d3fendMappings.id })
    .from(d3fendMappings)
    .where(and(eq(d3fendMappings.id, mappingId), eq(d3fendMappings.organisationId, organisationId)))
    .limit(1);
  if (!existing) throw new D3fendMappingError("D3FEND mapping not found", 404);
  await db.delete(d3fendMappings).where(eq(d3fendMappings.id, mappingId));
}

import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import {
  attachments,
  cases,
  evidenceCollections,
  type Attachment,
  type EvidenceCollection,
} from "@/db/schema";
import { newId } from "@/lib/utils";
import { recordCustodyEvent } from "./custody";

export class EvidenceCollectionError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "EvidenceCollectionError";
    this.status = status;
  }
}

async function loadCaseInOrg(caseId: string, organisationId: string) {
  const [c] = await db
    .select({ id: cases.id })
    .from(cases)
    .where(and(eq(cases.id, caseId), eq(cases.organisationId, organisationId)))
    .limit(1);
  return c ?? null;
}

export async function createCollectionCore(opts: {
  organisationId: string;
  caseId: string;
  actorId: string;
  name: string;
  description?: string | null;
}): Promise<EvidenceCollection> {
  const name = opts.name.trim();
  if (!name) throw new EvidenceCollectionError("A collection name is required", 400);
  if (!(await loadCaseInOrg(opts.caseId, opts.organisationId))) {
    throw new EvidenceCollectionError("Case not found", 404);
  }
  const [existing] = await db
    .select({ id: evidenceCollections.id })
    .from(evidenceCollections)
    .where(and(eq(evidenceCollections.caseId, opts.caseId), eq(evidenceCollections.name, name)))
    .limit(1);
  if (existing) {
    throw new EvidenceCollectionError("A collection with this name already exists", 409);
  }
  const [row] = await db
    .insert(evidenceCollections)
    .values({
      id: newId("ecol"),
      organisationId: opts.organisationId,
      caseId: opts.caseId,
      name,
      description: opts.description?.trim() || null,
      createdBy: opts.actorId,
    })
    .returning();
  if (!row) throw new EvidenceCollectionError("Failed to create collection", 500);
  return row;
}

export async function listCollectionsForCase(
  caseId: string,
  organisationId: string,
): Promise<EvidenceCollection[]> {
  return db
    .select()
    .from(evidenceCollections)
    .where(
      and(
        eq(evidenceCollections.caseId, caseId),
        eq(evidenceCollections.organisationId, organisationId),
      ),
    );
}

async function loadEvidenceInOrg(evidenceId: string, organisationId: string) {
  const [row] = await db
    .select()
    .from(attachments)
    .where(
      and(
        eq(attachments.id, evidenceId),
        eq(attachments.organisationId, organisationId),
        isNull(attachments.deletedAt),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function addEvidenceToCollectionCore(opts: {
  collectionId: string;
  evidenceId: string;
  organisationId: string;
  actorId: string;
}): Promise<Attachment> {
  const [collection] = await db
    .select()
    .from(evidenceCollections)
    .where(
      and(
        eq(evidenceCollections.id, opts.collectionId),
        eq(evidenceCollections.organisationId, opts.organisationId),
      ),
    )
    .limit(1);
  if (!collection) throw new EvidenceCollectionError("Collection not found", 404);
  const evidence = await loadEvidenceInOrg(opts.evidenceId, opts.organisationId);
  if (!evidence) throw new EvidenceCollectionError("Evidence not found", 404);
  if (evidence.caseId !== collection.caseId) {
    throw new EvidenceCollectionError(
      "Evidence and collection must belong to the same case",
      400,
    );
  }
  const [updated] = await db
    .update(attachments)
    .set({ collectionId: opts.collectionId })
    .where(eq(attachments.id, opts.evidenceId))
    .returning();
  if (!updated) throw new EvidenceCollectionError("Evidence not found", 404);
  await recordCustodyEvent({
    evidenceId: opts.evidenceId,
    organisationId: opts.organisationId,
    actorId: opts.actorId,
    eventType: "collection_added",
    payload: { collection_id: opts.collectionId, collection_name: collection.name },
  });
  return updated;
}

export async function removeEvidenceFromCollectionCore(opts: {
  evidenceId: string;
  organisationId: string;
  actorId: string;
}): Promise<Attachment> {
  const evidence = await loadEvidenceInOrg(opts.evidenceId, opts.organisationId);
  if (!evidence) throw new EvidenceCollectionError("Evidence not found", 404);
  if (!evidence.collectionId) return evidence;
  const previousCollectionId = evidence.collectionId;
  const [updated] = await db
    .update(attachments)
    .set({ collectionId: null })
    .where(eq(attachments.id, opts.evidenceId))
    .returning();
  if (!updated) throw new EvidenceCollectionError("Evidence not found", 404);
  await recordCustodyEvent({
    evidenceId: opts.evidenceId,
    organisationId: opts.organisationId,
    actorId: opts.actorId,
    eventType: "collection_removed",
    payload: { collection_id: previousCollectionId },
  });
  return updated;
}

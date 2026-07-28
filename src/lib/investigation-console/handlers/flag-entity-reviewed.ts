import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { entities } from "@/db/schema";
import type { InvestigationCommandHandler } from "../types";

const paramSchema = z.object({
  entityId: z.string().trim().min(1).max(80),
  note: z.string().trim().min(1).max(500),
});

/**
 * Write-class stub: append a review note to an entity after dual-control
 * approval. No shell, no external HTTP — mutates only org-scoped entity notes.
 * Demonstrates approval gating for write investigation commands.
 */
export const flagEntityReviewedHandler: InvestigationCommandHandler = {
  name: "kelpie.flag_entity_reviewed",
  version: "1.0.0",
  label: "Flag entity reviewed",
  description:
    "Append a review note to an entity record. Write-class: requires a different administrator to approve before the note is applied.",
  accessClass: "write",
  requiredScopes: ["investigation:execute"],
  parameters: [
    {
      key: "entityId",
      label: "Entity ID",
      type: "string",
      required: true,
      description: "Organisation-scoped entity id",
    },
    {
      key: "note",
      label: "Review note",
      type: "string",
      required: true,
      description: "Short analyst review note (stored on the entity)",
    },
  ],
  paramSchema: paramSchema as z.ZodType<Record<string, unknown>>,
  resultRenderers: ["json", "markdown"],
  timeoutMs: 5_000,
  maxResultBytes: 16 * 1024,
  rateLimitPerMinute: 10,
  approvalRequired: true,
  async execute(params, ctx) {
    const entityId = String(params.entityId ?? "").trim();
    const note = String(params.note ?? "").trim();

    if (ctx.signal.aborted) {
      return {
        ok: false,
        renderer: "json",
        data: {},
        summary: "Cancelled",
        error: "cancelled",
      };
    }

    const [entity] = await db
      .select({
        id: entities.id,
        displayName: entities.displayName,
        notes: entities.notes,
        organisationId: entities.organisationId,
      })
      .from(entities)
      .where(
        and(
          eq(entities.id, entityId),
          eq(entities.organisationId, ctx.organisationId),
        ),
      )
      .limit(1);

    if (!entity) {
      return {
        ok: false,
        renderer: "json",
        data: {},
        summary: "Entity not found in this organisation",
        error: "not_found",
      };
    }

    const stamp = new Date().toISOString();
    const actor = ctx.actorId ?? "system";
    const line = `[reviewed ${stamp} by ${actor}] ${note}`;
    const nextNotes = entity.notes ? `${entity.notes}\n${line}` : line;

    await db
      .update(entities)
      .set({ notes: nextNotes, updatedAt: new Date() })
      .where(
        and(
          eq(entities.id, entity.id),
          eq(entities.organisationId, ctx.organisationId),
        ),
      );

    return {
      ok: true,
      renderer: "json",
      summary: `Marked entity ${entity.displayName} as reviewed`,
      providerRequestId: `kelpie-entity:${entity.id}:${stamp}`,
      data: {
        entityId: entity.id,
        displayName: entity.displayName,
        noteApplied: line,
      },
    };
  },
};

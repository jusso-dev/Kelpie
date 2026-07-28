import { and, desc, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { cases, observables } from "@/db/schema";
import {
  entityValueSchema,
  observableTypeSchema,
} from "../params";
import type { InvestigationCommandHandler } from "../types";

const paramSchema = z.object({
  value: entityValueSchema,
  type: observableTypeSchema.optional(),
  limit: z.number().int().min(1).max(50).optional(),
});

/**
 * Search previous Kelpie cases that share an observable value (tenant-scoped).
 * Pure DB query — no outbound network, no shell.
 */
export const previousCasesHandler: InvestigationCommandHandler = {
  name: "kelpie.previous_cases",
  version: "1.0.0",
  label: "Previous cases for entity",
  description:
    "Find other cases in this organisation that share the given observable or entity value.",
  accessClass: "read",
  requiredScopes: ["investigation:execute"],
  parameters: [
    {
      key: "value",
      label: "Value",
      type: "entity_value",
      required: true,
      description: "Observable or entity value to search (IP, domain, email, hash, …)",
    },
    {
      key: "type",
      label: "Observable type",
      type: "enum",
      required: false,
      enumValues: [
        "ip",
        "domain",
        "url",
        "file_hash",
        "email",
        "hostname",
        "username",
        "registry_key",
        "other",
      ],
    },
    {
      key: "limit",
      label: "Limit",
      type: "number",
      required: false,
      description: "Max matching cases (1–50, default 20)",
    },
  ],
  paramSchema: paramSchema as z.ZodType<Record<string, unknown>>,
  resultRenderers: ["table", "json"],
  timeoutMs: 10_000,
  maxResultBytes: 64 * 1024,
  rateLimitPerMinute: 30,
  approvalRequired: false,
  async execute(params, ctx) {
    const value = String(params.value ?? "").trim();
    const type =
      typeof params.type === "string" ? params.type : undefined;
    const limit =
      typeof params.limit === "number" && Number.isFinite(params.limit)
        ? Math.min(50, Math.max(1, Math.floor(params.limit)))
        : 20;

    if (ctx.signal.aborted) {
      return {
        ok: false,
        renderer: "table",
        data: { rows: [] },
        summary: "Cancelled",
        error: "cancelled",
      };
    }

    const conditions = [
      eq(cases.organisationId, ctx.organisationId),
      eq(observables.value, value),
    ];
    if (type) {
      conditions.push(
        eq(
          observables.type,
          type as
            | "ip"
            | "domain"
            | "url"
            | "file_hash"
            | "email"
            | "hostname"
            | "username"
            | "registry_key"
            | "other",
        ),
      );
    }
    if (ctx.caseId) {
      conditions.push(ne(cases.id, ctx.caseId));
    }

    const rows = await db
      .select({
        caseId: cases.id,
        caseNumber: cases.caseNumber,
        title: cases.title,
        status: cases.status,
        severity: cases.severity,
        observableType: observables.type,
        observableValue: observables.value,
        openedAt: cases.openedAt,
      })
      .from(observables)
      .innerJoin(cases, eq(observables.caseId, cases.id))
      .where(and(...conditions))
      .orderBy(desc(cases.openedAt))
      .limit(limit);

    // Deduplicate by case (an observable may appear once per type).
    const seen = new Set<string>();
    const unique = [];
    for (const row of rows) {
      if (seen.has(row.caseId)) continue;
      seen.add(row.caseId);
      unique.push({
        caseId: row.caseId,
        caseNumber: row.caseNumber,
        title: row.title,
        status: row.status,
        severity: row.severity,
        matchedType: row.observableType,
        matchedValue: row.observableValue,
        openedAt: row.openedAt?.toISOString?.() ?? row.openedAt,
      });
    }

    return {
      ok: true,
      renderer: "table",
      summary: `Found ${unique.length} previous case(s) for ${value}`,
      providerRequestId: `kelpie-db:${ctx.organisationId}:${Date.now()}`,
      data: {
        columns: [
          "caseNumber",
          "title",
          "status",
          "severity",
          "matchedType",
          "openedAt",
        ],
        rows: unique,
        query: { value, type: type ?? null, limit },
      },
    };
  },
};

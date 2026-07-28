import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateApiTokenWithScope } from "@/lib/api-tokens";
import { runContextImport } from "@/lib/asset-context/import-core";
import {
  mapDefenderDevices,
  mapEntraUsers,
  mapCmdbRecords,
  type CmdbRecord,
  type DefenderDevicePayload,
  type EntraUserPayload,
} from "@/lib/asset-context/providers";
import { AssetContextError } from "@/lib/asset-context/types";

const schema = z.discriminatedUnion("source", [
  z.object({
    source: z.literal("csv"),
    dryRun: z.boolean().optional().default(true),
    csvText: z.string().min(1).max(5_000_000),
  }),
  z.object({
    source: z.literal("entra"),
    dryRun: z.boolean().optional().default(true),
    users: z.array(z.record(z.string(), z.unknown())).min(1).max(10_000),
  }),
  z.object({
    source: z.literal("defender"),
    dryRun: z.boolean().optional().default(true),
    devices: z.array(z.record(z.string(), z.unknown())).min(1).max(10_000),
  }),
  z.object({
    source: z.literal("cmdb"),
    dryRun: z.boolean().optional().default(true),
    records: z.array(z.record(z.string(), z.unknown())).min(1).max(10_000),
  }),
]);

export async function POST(req: Request) {
  const auth = await authenticateApiTokenWithScope(req, "asset_context:write");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid payload", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const orgId = auth.token.organisationId;
  const actorId = auth.token.createdBy ?? null;
  const dryRun = parsed.data.dryRun;

  try {
    let result;
    if (parsed.data.source === "csv") {
      result = await runContextImport({
        organisationId: orgId,
        source: "csv",
        actorId,
        dryRun,
        csvText: parsed.data.csvText,
      });
    } else if (parsed.data.source === "entra") {
      const rows = mapEntraUsers(
        orgId,
        parsed.data.users as EntraUserPayload[],
      );
      result = await runContextImport({
        organisationId: orgId,
        source: "entra",
        actorId,
        dryRun,
        rows,
      });
    } else if (parsed.data.source === "defender") {
      const rows = mapDefenderDevices(
        orgId,
        parsed.data.devices as DefenderDevicePayload[],
      );
      result = await runContextImport({
        organisationId: orgId,
        source: "defender",
        actorId,
        dryRun,
        rows,
      });
    } else {
      const rows = mapCmdbRecords(orgId, parsed.data.records as CmdbRecord[]);
      result = await runContextImport({
        organisationId: orgId,
        source: "cmdb",
        actorId,
        dryRun,
        rows,
      });
    }

    return NextResponse.json({
      run: result.run,
      errors: result.errors,
      validRowCount: result.rows.length,
    });
  } catch (err) {
    if (err instanceof AssetContextError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}

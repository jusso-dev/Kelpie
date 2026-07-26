"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { vendorWatchlist } from "@/db/schema";
import { VENDOR_CATALOG } from "@/data/vendor-catalog";
import { requireRole } from "@/lib/session";
import { newId } from "@/lib/utils";

function vendorAliases(entry: (typeof VENDOR_CATALOG)[number]): string[] {
  let hostname = "";
  try {
    hostname = new URL(entry.website).hostname
      .replace(/^www\./, "")
      .split(".")[0];
  } catch {
    // Catalog validation below still rejects malformed or missing entries.
  }
  return [
    entry.displayName,
    entry.name,
    entry.slug.replaceAll("-", " "),
    hostname,
  ]
    .map((value) => value.trim().toLocaleLowerCase())
    .filter((value, index, values) => value.length >= 3 && values.indexOf(value) === index);
}

export async function watchVendor(catalogSlug: string) {
  const user = await requireRole(["admin", "analyst"]);
  const entry = VENDOR_CATALOG.find((vendor) => vendor.slug === catalogSlug);
  if (!entry) throw new Error("Vendor is not in the Kelpie catalog.");

  const inserted = await db
    .insert(vendorWatchlist)
    .values({
      id: newId("vnd"),
      organisationId: user.organisationId,
      catalogSlug: entry.slug,
      displayName: entry.displayName,
      legalName: entry.name,
      website: entry.website,
      category: entry.category,
      aliases: vendorAliases(entry),
      createdBy: user.id,
    })
    .onConflictDoNothing()
    .returning({ id: vendorWatchlist.id });

  revalidatePath("/briefing");
  revalidatePath("/briefing/vendors");
  return { added: inserted.length > 0, name: entry.displayName };
}

export async function unwatchVendor(id: string) {
  const user = await requireRole(["admin", "analyst"]);
  const removed = await db
    .delete(vendorWatchlist)
    .where(
      and(
        eq(vendorWatchlist.id, id),
        eq(vendorWatchlist.organisationId, user.organisationId),
      ),
    )
    .returning({ name: vendorWatchlist.displayName });
  if (!removed[0]) throw new Error("Watched vendor was not found.");

  revalidatePath("/briefing");
  revalidatePath("/briefing/vendors");
  return { name: removed[0].name };
}

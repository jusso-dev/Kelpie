import type { CyberNewsItem } from "@/lib/cyber-news";

export type WatchedVendor = {
  id: string;
  catalogSlug: string;
  displayName: string;
  website: string;
  category: string;
  aliases: unknown;
};

function normalise(value: string): string {
  return ` ${value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[^a-z0-9.+#]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()} `;
}

export function matchingVendors(
  item: Pick<CyberNewsItem, "title" | "summary">,
  vendors: WatchedVendor[],
): WatchedVendor[] {
  const haystack = normalise(`${item.title} ${item.summary}`);
  return vendors.filter((vendor) => {
    const aliases = Array.isArray(vendor.aliases)
      ? vendor.aliases.filter(
          (alias): alias is string =>
            typeof alias === "string" && alias.trim().length >= 3,
        )
      : [vendor.displayName];
    return aliases.some((alias) => {
      const term = normalise(alias).trim();
      return term.length >= 3 && haystack.includes(` ${term} `);
    });
  });
}

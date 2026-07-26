import { NextResponse } from "next/server";
import { VENDOR_CATALOG } from "@/data/vendor-catalog";
import { buildVendorLogoSources } from "@/lib/vendor-logo-sources";

function colorFromSlug(slug: string): string {
  const palette = [
    "#0f766e",
    "#1d4ed8",
    "#b45309",
    "#7c3aed",
    "#be123c",
    "#047857",
  ];
  let hash = 0;
  for (const char of slug) hash = (hash + char.charCodeAt(0)) % palette.length;
  return palette[hash];
}

function escapeSvgText(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function fallbackIcon(slug: string, label: string): NextResponse {
  const initials = escapeSvgText(
    label
      .split(/\s+/)
      .map((part) => part[0])
      .filter(Boolean)
      .slice(0, 2)
      .join("")
      .toUpperCase(),
  );
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96"><rect width="96" height="96" rx="24" fill="${colorFromSlug(slug)}"/><text x="48" y="57" text-anchor="middle" font-family="Arial,sans-serif" font-size="28" font-weight="700" fill="white">${initials}</text></svg>`;
  return new NextResponse(svg, {
    headers: {
      "content-type": "image/svg+xml",
      "cache-control": "public, max-age=86400, s-maxage=86400",
      "x-content-type-options": "nosniff",
    },
  });
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const entry = VENDOR_CATALOG.find((vendor) => vendor.slug === slug);
  if (!entry) return fallbackIcon(slug, slug.replaceAll("-", " "));

  const sources = buildVendorLogoSources({
    slug: entry.slug,
    website: entry.website,
    logoDevToken: process.env.KELPIE_LOGO_DEV_TOKEN,
  });
  for (const source of sources) {
    try {
      const response = await fetch(source, {
        headers: { "user-agent": "Kelpie/0.2" },
        cache: "force-cache",
        signal: AbortSignal.timeout(5_000),
      });
      if (!response.ok) continue;
      const contentType = response.headers.get("content-type")?.toLowerCase();
      if (!contentType?.startsWith("image/")) continue;
      const bytes = await response.arrayBuffer();
      if (bytes.byteLength === 0 || bytes.byteLength > 2_000_000) continue;
      return new NextResponse(bytes, {
        headers: {
          "content-type": contentType,
          "cache-control": "public, max-age=86400, s-maxage=86400",
          "x-content-type-options": "nosniff",
        },
      });
    } catch {
      // Try next trusted logo provider.
    }
  }

  return fallbackIcon(entry.slug, entry.displayName);
}

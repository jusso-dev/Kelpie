/**
 * Shared with `src/db/schema.ts` (which re-exports these) and safe to import
 * from client components — no database or server-only code here, just the
 * closed category list a playbook step's guidance can be tagged with.
 */
export const PLAYBOOK_GUIDANCE_CATEGORIES = [
  "investigation",
  "detection",
  "containment",
  "recovery",
] as const;
export type PlaybookGuidanceCategory = (typeof PLAYBOOK_GUIDANCE_CATEGORIES)[number];

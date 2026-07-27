import { db } from "@/db";
import { comments } from "@/db/schema";
import { writeTimelineEvent } from "@/lib/timeline";
import { newId } from "@/lib/utils";
import { lookupIndicatorValues } from "./core";
import { guessIndicatorType } from "./normalise";

const URL_PATTERN = /https?:\/\/[^\s<>"']+/gi;
const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const IPV4_PATTERN = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
const HASH_PATTERN = /\b(?:[a-f0-9]{64}|[a-f0-9]{40}|[a-f0-9]{32})\b/gi;
const DOMAIN_PATTERN =
  /\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}\b/gi;
const MAX_VALUES = 50;

function validIpv4(value: string): boolean {
  return value.split(".").every((part) => {
    const number = Number(part);
    return Number.isInteger(number) && number >= 0 && number <= 255;
  });
}

function trimUrl(value: string): string {
  return value.replace(/[),.;:!?]+$/g, "");
}

export function extractCaseIndicators(title: string, summary?: string | null): string[] {
  const text = `${title}\n${summary ?? ""}`;
  const values = new Set<string>();
  const emails = text.match(EMAIL_PATTERN)?.map((value) => value.toLowerCase()) ?? [];
  const urls = text.match(URL_PATTERN)?.map(trimUrl) ?? [];

  for (const value of urls) {
    values.add(value);
    try {
      values.add(new URL(value).hostname.toLowerCase());
    } catch {
      // Regex is permissive; malformed URLs are ignored after exact-value lookup.
    }
  }
  // emails themselves are not TI indicators; the pattern is only used below
  // to exclude an email's own domain part from the domain matches.
  for (const value of text.match(IPV4_PATTERN) ?? []) {
    if (validIpv4(value)) values.add(value);
  }
  for (const value of text.match(HASH_PATTERN) ?? []) values.add(value.toLowerCase());
  for (const value of text.match(DOMAIN_PATTERN) ?? []) {
    const lower = value.toLowerCase();
    if (!emails.some((email) => email.endsWith(`@${lower}`))) values.add(lower);
  }
  // Only the four supported indicator types are ever checked against the TI store.
  return [...values].filter((value) => guessIndicatorType(value) !== null).slice(0, MAX_VALUES);
}

function buildComment(
  values: string[],
  matches: Awaited<ReturnType<typeof lookupIndicatorValues>>,
): string {
  if (values.length === 0) {
    return [
      "**Automated threat intelligence enrichment**",
      "",
      "No supported indicators were found in the case title or summary.",
    ].join("\n");
  }
  if (matches.length === 0) {
    return [
      "**Automated threat intelligence enrichment**",
      "",
      `Checked ${values.length} indicator${values.length === 1 ? "" : "s"} against local threat intelligence feeds. No matches found.`,
      "",
      ...values.map((value) => `- \`${value}\``),
    ].join("\n");
  }
  const matchedValues = new Set(matches.map((match) => match.value));
  const lines = matches.map((match) => {
    const tags = match.tags.length > 0 ? `; tags: ${match.tags.join(", ")}` : "";
    return `- \`${match.value}\` matched **${match.feedName}** (${match.type}, confidence ${match.confidence}%${tags})`;
  });
  const unmatched = values.filter((value) => !matchedValues.has(value));
  return [
    "**Automated threat intelligence enrichment**",
    "",
    `${matches.length} feed match${matches.length === 1 ? "" : "es"} found across ${values.length} checked indicator${values.length === 1 ? "" : "s"}.`,
    "",
    ...lines,
    ...(unmatched.length > 0
      ? [
          "",
          `No local feed match for ${unmatched.length} other checked indicator${unmatched.length === 1 ? "" : "s"}.`,
        ]
      : []),
  ].join("\n");
}

export async function enrichNewCaseWithThreatIntel(input: {
  caseId: string;
  organisationId: string;
  title: string;
  summary?: string | null;
}): Promise<void> {
  const values = extractCaseIndicators(input.title, input.summary);
  const matches = await lookupIndicatorValues(input.organisationId, values);
  const commentId = newId("cmt");
  await db.insert(comments).values({
    id: commentId,
    caseId: input.caseId,
    authorId: null,
    source: "system",
    body: buildComment(values, matches),
    mentions: [],
  });
  await writeTimelineEvent({
    caseId: input.caseId,
    actorId: null,
    eventType: "ti_enrichment",
    payload: {
      comment_id: commentId,
      checked: values.length,
      matches: matches.length,
    },
  });
}

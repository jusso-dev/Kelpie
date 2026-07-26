export type AttackPair = {
  originCode: string;
  originName: string;
  targetCode: string;
  targetName: string;
  percentage: number;
};

export type CountryActivity = {
  code: string;
  name: string;
  percentage: number;
  rank: number;
};

export type ThreatBreakdownItem = {
  key: string;
  label: string;
  percentage: number;
};

export type RadarAnnotation = {
  description: string;
  eventType: string;
  startDate: string | null;
  endDate: string | null;
  linkedUrl: string | null;
};

export type ThreatLandscapeData = {
  configured: boolean;
  error: string | null;
  lastUpdated: string | null;
  confidenceLevel: number | null;
  windowStart: string | null;
  windowEnd: string | null;
  pairs: AttackPair[];
  origins: CountryActivity[];
  targets: CountryActivity[];
  breakdowns: {
    mitigationProducts: ThreatBreakdownItem[];
    httpMethods: ThreatBreakdownItem[];
    httpVersions: ThreatBreakdownItem[];
    ipVersions: ThreatBreakdownItem[];
    verticals: ThreatBreakdownItem[];
    managedRules: ThreatBreakdownItem[];
  };
  annotations: RadarAnnotation[];
  warnings: string[];
};

type RadarPair = {
  originCountryAlpha2?: unknown;
  originCountryName?: unknown;
  targetCountryAlpha2?: unknown;
  targetCountryName?: unknown;
  value?: unknown;
};

type RadarLocation = {
  originCountryAlpha2?: unknown;
  originCountryName?: unknown;
  targetCountryAlpha2?: unknown;
  targetCountryName?: unknown;
  value?: unknown;
  rank?: unknown;
};

type RadarMeta = {
  confidenceInfo?: {
    level?: unknown;
    annotations?: Array<{
      description?: unknown;
      eventType?: unknown;
      startDate?: unknown;
      endDate?: unknown;
      linkedUrl?: unknown;
    }>;
  } | null;
  dateRange?:
    | Array<{ startTime?: unknown; endTime?: unknown }>
    | { startTime?: unknown; endTime?: unknown };
  lastUpdated?: unknown;
};

type RadarResult = Record<string, unknown> & { meta?: RadarMeta };

type RadarResponse = {
  success?: boolean;
  result?: RadarResult;
};

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function emptyBreakdowns(): ThreatLandscapeData["breakdowns"] {
  return {
    mitigationProducts: [],
    httpMethods: [],
    httpVersions: [],
    ipVersions: [],
    verticals: [],
    managedRules: [],
  };
}

function emptyData(
  configured: boolean,
  error: string | null,
): ThreatLandscapeData {
  return {
    configured,
    error,
    lastUpdated: null,
    confidenceLevel: null,
    windowStart: null,
    windowEnd: null,
    pairs: [],
    origins: [],
    targets: [],
    breakdowns: emptyBreakdowns(),
    annotations: [],
    warnings: [],
  };
}

function aggregate(
  pairs: AttackPair[],
  side: "origin" | "target",
): CountryActivity[] {
  const values = new Map<string, CountryActivity>();
  for (const pair of pairs) {
    const code = side === "origin" ? pair.originCode : pair.targetCode;
    const name = side === "origin" ? pair.originName : pair.targetName;
    const existing = values.get(code);
    values.set(code, {
      code,
      name,
      percentage: (existing?.percentage ?? 0) + pair.percentage,
      rank: 0,
    });
  }
  return [...values.values()]
    .sort((a, b) => b.percentage - a.percentage)
    .map((item, index) => ({ ...item, rank: index + 1 }));
}

function rows<T>(result: RadarResult, key: string): T[] {
  const value = result[key];
  return Array.isArray(value) ? (value as T[]) : [];
}

function parsePairs(result: RadarResult): AttackPair[] {
  return rows<RadarPair>(result, "top_0").flatMap((row) => {
    const originCode = text(row.originCountryAlpha2).toUpperCase();
    const targetCode = text(row.targetCountryAlpha2).toUpperCase();
    const percentage = Number(row.value);
    if (
      !/^[A-Z]{2}$/.test(originCode) ||
      !/^[A-Z]{2}$/.test(targetCode) ||
      !Number.isFinite(percentage)
    ) {
      return [];
    }
    return [
      {
        originCode,
        originName: text(row.originCountryName) || originCode,
        targetCode,
        targetName: text(row.targetCountryName) || targetCode,
        percentage: Math.max(0, percentage),
      },
    ];
  });
}

function parseLocations(
  result: RadarResult,
  side: "origin" | "target",
): CountryActivity[] {
  return rows<RadarLocation>(result, "top_0").flatMap((row, index) => {
    const code = text(
      side === "origin"
        ? row.originCountryAlpha2
        : row.targetCountryAlpha2,
    ).toUpperCase();
    const name =
      text(
        side === "origin"
          ? row.originCountryName
          : row.targetCountryName,
      ) || code;
    const percentage = Number(row.value);
    const rank = Number(row.rank);
    if (!/^[A-Z]{2}$/.test(code) || !Number.isFinite(percentage)) return [];
    return [
      {
        code,
        name,
        percentage: Math.max(0, percentage),
        rank: Number.isFinite(rank) ? rank : index + 1,
      },
    ];
  });
}

const LABELS: Record<string, string> = {
  ACCESS_RULES: "Access rules",
  API_SHIELD: "API Shield",
  BOT_MANAGEMENT: "Bot management",
  DATA_LOSS_PREVENTION: "Data loss prevention",
  DDOS: "DDoS protection",
  IP_REPUTATION: "IP reputation",
  WAF: "Web application firewall",
  UNKNOWN: "Unknown",
};

function breakdownLabel(key: string): string {
  if (LABELS[key]) return LABELS[key];
  if (!/^[A-Z0-9_]+$/.test(key)) return key;
  const lower = key.replaceAll("_", " ").toLocaleLowerCase();
  return lower.replace(/\b\p{L}/gu, (letter) => letter.toLocaleUpperCase());
}

function parseBreakdown(
  result: RadarResult,
  limit = Number.POSITIVE_INFINITY,
): ThreatBreakdownItem[] {
  const value = result.summary_0;
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.entries(value)
    .flatMap(([key, rawValue]) => {
      const percentage = Number(rawValue);
      if (!Number.isFinite(percentage) || percentage <= 0) return [];
      return [{ key, label: breakdownLabel(key), percentage }];
    })
    .sort((a, b) => b.percentage - a.percentage)
    .slice(0, limit);
}

function parseAnnotations(meta: RadarMeta | undefined): RadarAnnotation[] {
  return (meta?.confidenceInfo?.annotations ?? []).flatMap((annotation) => {
    const description = text(annotation.description);
    if (!description) return [];
    const linkedUrl = text(annotation.linkedUrl);
    return [
      {
        description,
        eventType: text(annotation.eventType) || "GENERAL",
        startDate: text(annotation.startDate) || null,
        endDate: text(annotation.endDate) || null,
        linkedUrl: /^https?:\/\//i.test(linkedUrl) ? linkedUrl : null,
      },
    ];
  });
}

async function radarRequest(
  token: string,
  path: string,
  parameters: Record<string, string>,
): Promise<RadarResult> {
  const url = new URL(`https://api.cloudflare.com/client/v4/radar/${path}`);
  for (const [key, value] of Object.entries(parameters)) {
    url.searchParams.set(key, value);
  }
  url.searchParams.set("format", "JSON");
  const response = await fetch(url, {
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/json",
    },
    next: { revalidate: 60 },
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) {
    throw new Error(
      response.status === 401 || response.status === 403
        ? "The Cloudflare Radar token was rejected. Check its Account Radar Read permission."
        : `Cloudflare Radar returned HTTP ${response.status}.`,
    );
  }
  const payload = (await response.json()) as RadarResponse;
  if (!payload.success || !payload.result) {
    throw new Error("Cloudflare Radar returned an incomplete response.");
  }
  return payload.result;
}

export async function getThreatLandscapeData(): Promise<ThreatLandscapeData> {
  const token = process.env.CLOUDFLARE_RADAR_API_TOKEN?.trim();
  if (!token) return emptyData(false, null);

  try {
    const baseParameters = { dateRange: "1d" };
    const summaryDefinitions = [
      ["MITIGATION_PRODUCT", "mitigationProducts", 7, "Mitigation product"],
      ["HTTP_METHOD", "httpMethods", 6, "HTTP method"],
      ["HTTP_VERSION", "httpVersions", 3, "HTTP version"],
      ["IP_VERSION", "ipVersions", 2, "IP version"],
      ["VERTICAL", "verticals", 8, "Targeted sector"],
      ["MANAGED_RULES", "managedRules", 8, "Managed-rule signal"],
    ] as const;
    const [pairResult, enrichmentResults] = await Promise.all([
      radarRequest(token, "attacks/layer7/top/attacks", {
        ...baseParameters,
        limit: "100",
        limitPerLocation: "8",
      }),
      Promise.allSettled([
        radarRequest(token, "attacks/layer7/top/locations/target", {
          ...baseParameters,
          limit: "100",
        }),
        radarRequest(token, "attacks/layer7/top/locations/origin", {
          ...baseParameters,
          limit: "100",
        }),
        ...summaryDefinitions.map(([dimension, , limit]) =>
          radarRequest(token, `attacks/layer7/summary/${dimension}`, {
            ...baseParameters,
            ...(dimension === "VERTICAL" || dimension === "MANAGED_RULES"
              ? { limitPerGroup: String(limit) }
              : {}),
          }),
        ),
      ]),
    ]);

    const pairs = parsePairs(pairResult);
    const targetResult = enrichmentResults[0];
    const originResult = enrichmentResults[1];
    const warnings: string[] = [];
    const targets =
      targetResult.status === "fulfilled"
        ? parseLocations(targetResult.value, "target")
        : aggregate(pairs, "target");
    const origins =
      originResult.status === "fulfilled"
        ? parseLocations(originResult.value, "origin")
        : aggregate(pairs, "origin");
    if (targetResult.status === "rejected") {
      warnings.push(
        "Target-location enrichment is unavailable; map values use top route data.",
      );
    }
    if (originResult.status === "rejected") {
      warnings.push(
        "Origin-location enrichment is unavailable; map values use top route data.",
      );
    }

    const breakdowns = emptyBreakdowns();
    summaryDefinitions.forEach(([, key, limit, label], index) => {
      const result = enrichmentResults[index + 2];
      if (result.status === "fulfilled") {
        breakdowns[key] = parseBreakdown(result.value, limit);
      } else {
        warnings.push(`${label} enrichment is unavailable.`);
      }
    });

    const ranges = pairResult.meta?.dateRange;
    const range = Array.isArray(ranges) ? ranges[0] : ranges;
    const confidence = Number(pairResult.meta?.confidenceInfo?.level);
    return {
      configured: true,
      error: null,
      lastUpdated: text(pairResult.meta?.lastUpdated) || null,
      confidenceLevel: Number.isFinite(confidence) ? confidence : null,
      windowStart: text(range?.startTime) || null,
      windowEnd: text(range?.endTime) || null,
      pairs,
      origins,
      targets,
      breakdowns,
      annotations: parseAnnotations(pairResult.meta),
      warnings,
    };
  } catch (error) {
    return emptyData(
      true,
      error instanceof Error
        ? error.message
        : "Cloudflare Radar data could not be loaded.",
    );
  }
}

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
};

export type WarRoomData = {
  configured: boolean;
  error: string | null;
  lastUpdated: string | null;
  confidenceLevel: number | null;
  windowStart: string | null;
  windowEnd: string | null;
  pairs: AttackPair[];
  origins: CountryActivity[];
  targets: CountryActivity[];
};

type RadarPair = {
  originCountryAlpha2?: unknown;
  originCountryName?: unknown;
  targetCountryAlpha2?: unknown;
  targetCountryName?: unknown;
  value?: unknown;
};

type RadarResponse = {
  success?: boolean;
  result?: {
    meta?: {
      confidenceInfo?: { level?: unknown } | null;
      dateRange?: Array<{ startTime?: unknown; endTime?: unknown }>;
      lastUpdated?: unknown;
    };
    top_0?: RadarPair[];
  };
};

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
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
    });
  }
  return [...values.values()].sort((a, b) => b.percentage - a.percentage);
}

export async function getWarRoomData(): Promise<WarRoomData> {
  const token = process.env.CLOUDFLARE_RADAR_API_TOKEN?.trim();
  if (!token) {
    return {
      configured: false,
      error: null,
      lastUpdated: null,
      confidenceLevel: null,
      windowStart: null,
      windowEnd: null,
      pairs: [],
      origins: [],
      targets: [],
    };
  }

  try {
    const url = new URL(
      "https://api.cloudflare.com/client/v4/radar/attacks/layer7/top/attacks",
    );
    url.searchParams.set("dateRange", "1d");
    url.searchParams.set("limit", "50");
    url.searchParams.set("limitPerLocation", "5");
    const response = await fetch(url, {
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/json",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) {
      throw new Error(
        response.status === 401 || response.status === 403
          ? "The Cloudflare Radar token was rejected. Check its User Details Read permission."
          : `Cloudflare Radar returned HTTP ${response.status}.`,
      );
    }
    const payload = (await response.json()) as RadarResponse;
    if (!payload.success || !payload.result) {
      throw new Error("Cloudflare Radar returned an incomplete response.");
    }
    const pairs = (payload.result.top_0 ?? []).flatMap((row) => {
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
    const range = payload.result.meta?.dateRange?.[0];
    const confidence = Number(payload.result.meta?.confidenceInfo?.level);
    return {
      configured: true,
      error: null,
      lastUpdated: text(payload.result.meta?.lastUpdated) || null,
      confidenceLevel: Number.isFinite(confidence) ? confidence : null,
      windowStart: text(range?.startTime) || null,
      windowEnd: text(range?.endTime) || null,
      pairs,
      origins: aggregate(pairs, "origin"),
      targets: aggregate(pairs, "target"),
    };
  } catch (error) {
    return {
      configured: true,
      error:
        error instanceof Error
          ? error.message
          : "Cloudflare Radar data could not be loaded.",
      lastUpdated: null,
      confidenceLevel: null,
      windowStart: null,
      windowEnd: null,
      pairs: [],
      origins: [],
      targets: [],
    };
  }
}

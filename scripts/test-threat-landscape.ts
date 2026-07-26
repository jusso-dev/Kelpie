import assert from "node:assert/strict";
import { getThreatLandscapeData } from "../src/lib/threat-landscape";

const originalFetch = globalThis.fetch;
const originalToken = process.env.CLOUDFLARE_RADAR_API_TOKEN;

const meta = {
  confidenceInfo: {
    level: 1,
    annotations: [
      {
        description: "Provider maintenance window",
        eventType: "PIPELINE",
        startDate: "2026-07-26T00:00:00Z",
        endDate: "2026-07-26T01:00:00Z",
        linkedUrl: "https://example.com/provider-note",
      },
    ],
  },
  dateRange: [
    {
      startTime: "2026-07-25T00:00:00Z",
      endTime: "2026-07-26T00:00:00Z",
    },
  ],
  lastUpdated: "2026-07-26T00:05:00Z",
};

function radarResponse(data: Record<string, unknown>): Response {
  return Response.json({ success: true, result: { ...data, meta } });
}

process.env.CLOUDFLARE_RADAR_API_TOKEN = "test-token";
globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = new URL(
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input
        : input.url,
  );
  const path = url.pathname;
  if (path.endsWith("/top/attacks")) {
    return radarResponse({
      top_0: [
        {
          originCountryAlpha2: "US",
          originCountryName: "United States",
          targetCountryAlpha2: "AU",
          targetCountryName: "Australia",
          value: "12.5",
          rank: 1,
        },
      ],
    });
  }
  if (path.endsWith("/top/locations/target")) {
    return radarResponse({
      top_0: [
        {
          targetCountryAlpha2: "AU",
          targetCountryName: "Australia",
          value: "18.25",
          rank: 2,
        },
      ],
    });
  }
  if (path.endsWith("/top/locations/origin")) {
    return radarResponse({
      top_0: [
        {
          originCountryAlpha2: "US",
          originCountryName: "United States",
          value: "22.75",
          rank: 1,
        },
      ],
    });
  }

  const dimension = path.split("/").at(-1);
  const summaries: Record<string, Record<string, string>> = {
    MITIGATION_PRODUCT: { WAF: "70", DDOS: "30" },
    HTTP_METHOD: { GET: "65", POST: "35" },
    HTTP_VERSION: { "HTTP/2": "80", "HTTP/3": "20" },
    IP_VERSION: { IPv4: "90", IPv6: "10" },
    VERTICAL: { Finance: "55", Healthcare: "45" },
    MANAGED_RULES: { SQLi: "60", XSS: "40" },
  };
  if (dimension && summaries[dimension]) {
    return radarResponse({ summary_0: summaries[dimension] });
  }
  return new Response(null, { status: 404 });
}) as typeof fetch;

async function main() {
  try {
    const result = await getThreatLandscapeData();
    assert.equal(result.configured, true);
    assert.equal(result.error, null);
    assert.equal(result.pairs.length, 1);
    assert.deepEqual(result.targets[0], {
      code: "AU",
      name: "Australia",
      percentage: 18.25,
      rank: 2,
    });
    assert.deepEqual(result.origins[0], {
      code: "US",
      name: "United States",
      percentage: 22.75,
      rank: 1,
    });
    assert.equal(
      result.breakdowns.mitigationProducts[0].label,
      "Web application firewall",
    );
    assert.equal(result.breakdowns.httpVersions[0].label, "HTTP/2");
    assert.equal(result.breakdowns.verticals[0].label, "Finance");
    assert.equal(result.breakdowns.managedRules[0].label, "SQLi");
    assert.equal(result.annotations[0].eventType, "PIPELINE");
    assert.deepEqual(result.warnings, []);
    console.log("threat landscape enrichment test passed");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalToken === undefined) {
      delete process.env.CLOUDFLARE_RADAR_API_TOKEN;
    } else {
      process.env.CLOUDFLARE_RADAR_API_TOKEN = originalToken;
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

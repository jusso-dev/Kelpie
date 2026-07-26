import assert from "node:assert/strict";
import { testVirusTotalConnection } from "../src/lib/enrichment/providers/virustotal";

const originalFetch = globalThis.fetch;

async function main() {
  try {
    globalThis.fetch = (async (_input, init) => {
      const headers = new Headers(init?.headers);
      assert.equal(headers.get("x-apikey"), "test-virustotal-key");
      return Response.json({
        data: {
          id: "1.1.1.1",
          attributes: {
            last_analysis_stats: {
              malicious: 2,
              suspicious: 1,
              harmless: 70,
              undetected: 20,
              timeout: 0,
            },
          },
        },
      });
    }) as typeof fetch;

    assert.deepEqual(
      await testVirusTotalConnection("test-virustotal-key"),
      {
        malicious: 2,
        suspicious: 1,
        harmless: 70,
        undetected: 20,
      },
    );

    globalThis.fetch = (async () =>
      new Response(null, { status: 401 })) as typeof fetch;
    await assert.rejects(
      testVirusTotalConnection("rejected-key"),
      /VirusTotal rejected this API key/,
    );
    console.log("VirusTotal configuration test passed");
  } finally {
    globalThis.fetch = originalFetch;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

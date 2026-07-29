/**
 * Ad-hoc check against a real Brolga. Not part of the test suite: it needs a
 * reachable instance and a token, which CI has neither of.
 */
import assert from "node:assert/strict";
import { configurationFromSettings } from "../src/lib/brolga/config.ts";
import { brolgaUrl } from "../src/lib/brolga/client.ts";
import { safeFetch } from "../src/lib/outbound-request.ts";

async function main() {
  const base = process.env.BROLGA_BASE_URL;
  const token = process.env.BROLGA_API_TOKEN;
  assert.ok(base && token, "set BROLGA_BASE_URL and BROLGA_API_TOKEN");

  const config = configurationFromSettings({
    brolga_base_url: base,
    brolga_api_token: token,
    brolga_enabled: true,
  });

  const healthUrl = brolgaUrl(config, config.healthPath);
  const contextUrl = brolgaUrl(config, config.contextPath);
  console.log("health url :", healthUrl);
  console.log("context url:", contextUrl);

  const health = await safeFetch(healthUrl);
  assert.equal(health.status, 200, `health returned ${health.status}`);
  console.log("health     :", await health.text());

  const res = await safeFetch(contextUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      schema_version: "kelpie.brolga.context_request/1.0",
      subject: { kind: "ip", value: "203.0.113.42" },
      purpose: "case_enrichment",
      detail_level: "L1",
      case_id: "case-demo-1",
    }),
  });
  assert.equal(res.status, 200, `context returned ${res.status}`);
  const pack = await res.json();

  assert.equal(pack.schema_version, "brolga.context_pack/1.0");
  assert.equal(pack.disposition, "malicious");
  assert.ok(Array.isArray(pack.evidence) && pack.evidence.length > 0, "no evidence");
  console.log("disposition:", pack.disposition);
  console.log("entities   :", pack.entities.map((e: {name: string}) => e.name));
  console.log("evidence   :", pack.evidence.length, "source object(s)");
  console.log("gaps       :", pack.gaps);

  // An unauthenticated request must be refused.
  const anon = await safeFetch(contextUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ subject: { kind: "ip", value: "203.0.113.42" } }),
  });
  assert.equal(anon.status, 401, `unauthenticated request returned ${anon.status}`);
  console.log("no token   : 401 as expected");

  console.log("\nKelpie -> Brolga live check passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

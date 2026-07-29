/**
 * Unit coverage for the Kelpie ↔ Brolga consumer contract (no network).
 */
import assert from "node:assert/strict";
import {
  BROLGA_CONTEXT_REQUEST_SCHEMA,
  configurationFromSettings,
  isBrolgaContextPack,
  mapObservableTypeToBrolgaKind,
  packDispositionSummary,
} from "@/lib/brolga";

function testTypeMapping() {
  assert.equal(mapObservableTypeToBrolgaKind("ip"), "ip");
  assert.equal(mapObservableTypeToBrolgaKind("domain"), "domain");
  assert.equal(mapObservableTypeToBrolgaKind("file_hash"), "file_hash");
  assert.equal(mapObservableTypeToBrolgaKind("hostname"), "hostname");
}

function testPackGuard() {
  assert.equal(isBrolgaContextPack(null), false);
  assert.equal(isBrolgaContextPack({}), false);
  assert.equal(
    isBrolgaContextPack({ schema_version: "brolga.context_pack/1.0" }),
    true,
  );
  assert.equal(
    packDispositionSummary({
      schema_version: "brolga.context_pack/1.0",
      disposition: "suspicious",
      confidence: 80,
      claims: [{ predicate: "related-to" }],
    }),
    "suspicious · confidence 80 · 1 claim(s)",
  );
}

function testConfig() {
  const empty = configurationFromSettings({});
  assert.equal(empty.configured, false);
  assert.equal(empty.enabled, false);

  const disabled = configurationFromSettings({
    brolga_base_url: "https://brolga.example",
    brolga_enabled: false,
  });
  assert.equal(disabled.configured, true);
  assert.equal(disabled.enabled, false);
  assert.equal(disabled.baseUrl, "https://brolga.example");
  assert.equal(disabled.urlSource, "organisation");

  const enabled = configurationFromSettings({
    brolga_base_url: "https://brolga.example/extra/path",
    brolga_enabled: true,
    brolga_api_token: "secret-token",
    brolga_timeout_ms: 12000,
  });
  assert.equal(enabled.enabled, true);
  assert.equal(enabled.baseUrl, "https://brolga.example");
  assert.equal(enabled.hasToken, true);
  assert.equal(enabled.timeoutMs, 12000);
  assert.equal(enabled.contextPath, "/v1/context");
  assert.equal(enabled.healthPath, "/v1/health");

  assert.equal(
    BROLGA_CONTEXT_REQUEST_SCHEMA,
    "kelpie.brolga.context_request/1.0",
  );
}

function main() {
  testTypeMapping();
  testPackGuard();
  testConfig();
  console.log("Brolga contract tests passed");
}

main();

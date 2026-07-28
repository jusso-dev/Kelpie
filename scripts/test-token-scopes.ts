/**
 * Unit coverage for API token scope checks (issue #80).
 * Empty scope arrays must grant nothing, including every sensitive scope.
 */
import assert from "node:assert/strict";
import {
  KNOWN_SCOPES,
  SENSITIVE_SCOPES,
  legacyDefaultScopes,
  tokenHasScope,
  type ScopeValue,
} from "../src/lib/scopes";

function main() {
  // Empty array: fail closed for every known scope, especially sensitive ones.
  for (const scope of KNOWN_SCOPES) {
    assert.equal(
      tokenHasScope([], scope.value),
      false,
      `empty scopes must not satisfy ${scope.value}`,
    );
  }
  for (const sensitive of SENSITIVE_SCOPES) {
    assert.equal(
      tokenHasScope([], sensitive),
      false,
      `empty scopes must not satisfy sensitive ${sensitive}`,
    );
  }

  // Explicit grant works; missing grant fails.
  assert.equal(tokenHasScope(["cases:read"], "cases:read"), true);
  assert.equal(tokenHasScope(["cases:read"], "cases:write"), false);
  assert.equal(tokenHasScope(["cases:read"], "alerts:raw_payload:read"), false);
  assert.equal(tokenHasScope(["alerts:raw_payload:read"], "alerts:raw_payload:read"), true);

  // Legacy migration set excludes sensitive scopes but keeps ordinary work.
  const legacy = legacyDefaultScopes();
  assert.ok(legacy.includes("cases:read"));
  assert.ok(legacy.includes("alerts:read"));
  assert.ok(legacy.includes("attack:read"));
  for (const sensitive of SENSITIVE_SCOPES) {
    assert.equal(
      legacy.includes(sensitive),
      false,
      `legacy migration must exclude ${sensitive}`,
    );
    assert.equal(
      tokenHasScope(legacy, sensitive),
      false,
      `migrated legacy token must not satisfy ${sensitive}`,
    );
  }
  // Every non-sensitive known scope is present.
  const sensitiveSet = new Set<string>(SENSITIVE_SCOPES);
  for (const scope of KNOWN_SCOPES) {
    if (sensitiveSet.has(scope.value)) continue;
    assert.ok(
      legacy.includes(scope.value),
      `legacy migration missing ordinary scope ${scope.value}`,
    );
    assert.equal(tokenHasScope(legacy, scope.value as ScopeValue), true);
  }

  console.log("token scope unit tests passed");
}

main();

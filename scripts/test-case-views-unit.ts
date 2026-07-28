/**
 * Pure unit tests for saved case views (issue #46):
 * schema validation, URL serialisation, bulk preset validation.
 * No database required.
 */
import assert from "node:assert/strict";
import {
  caseViewConfigSchema,
  compactCaseViewConfig,
  createCaseViewBodySchema,
  parseCaseViewConfig,
  safeParseCaseViewConfig,
} from "../src/lib/case-views/config";
import {
  configToUrlState,
  parseCaseListUrlState,
  serializeCaseListUrlState,
  urlStateMatchesConfig,
  urlStateToConfig,
} from "../src/lib/case-views/url-state";
import {
  BulkPresetValidationError,
  parseBulkPreset,
  parseBulkPresets,
  previewBulkPreset,
} from "../src/lib/case-views/presets";

function testConfigSchema() {
  const empty = parseCaseViewConfig({});
  assert.equal(empty.sort, "priority");
  assert.equal(empty.pageSize, 50);
  assert.deepEqual(empty.widgets, []);
  assert.deepEqual(empty.bulkPresets, []);

  const ok = parseCaseViewConfig({
    status: "open",
    severity: "high",
    sort: "recent",
    pageSize: 25,
    columns: ["number", "title", "severity"],
    widgets: ["sla_summary", "workload_summary"],
    priorityBand: "critical",
    minPriorityScore: 70,
  });
  assert.equal(ok.status, "open");
  assert.equal(ok.pageSize, 25);
  assert.equal(ok.priorityBand, "critical");

  const unknown = safeParseCaseViewConfig({ status: "open", evil: true });
  assert.equal(unknown.success, false, "unknown filter fields must be rejected");

  const badWidget = safeParseCaseViewConfig({ widgets: ["dashboard_sql"] });
  assert.equal(badWidget.success, false, "unknown widgets must be rejected");

  const badPage = safeParseCaseViewConfig({ pageSize: 17 });
  assert.equal(badPage.success, false, "non-allowlisted page sizes rejected");

  const badCol = safeParseCaseViewConfig({ columns: ["number", "secret"] });
  assert.equal(badCol.success, false, "unknown columns rejected");

  const createBody = createCaseViewBodySchema.safeParse({
    name: "Mine",
    visibility: "team",
  });
  assert.equal(createBody.success, false, "team views require teamId");

  const createOk = createCaseViewBodySchema.safeParse({
    name: "Mine",
    visibility: "team",
    teamId: "team_1",
    config: { status: "open" },
  });
  assert.equal(createOk.success, true);
}

function testUrlSerialization() {
  const state = parseCaseListUrlState({
    q: " phishing ",
    status: "open",
    severity: "bogus",
    sort: "recent",
    page: "2",
    pageSize: "25",
    columns: "number,title,severity,number",
    savedView: "cview_abc",
    sla: "risk",
    priorityBand: "high",
    minPriorityScore: "80",
  });
  assert.equal(state.q, "phishing");
  assert.equal(state.status, "open");
  assert.equal(state.severity, undefined, "invalid severity dropped");
  assert.equal(state.sort, "recent");
  assert.equal(state.page, 2);
  assert.equal(state.pageSize, 25);
  assert.deepEqual(state.columns, ["number", "title", "severity"]);
  assert.equal(state.savedView, "cview_abc");
  assert.equal(state.priorityBand, "high");
  assert.equal(state.minPriorityScore, 80);

  // Backwards-compatible: bare legacy URLs still parse.
  const legacy = parseCaseListUrlState({ status: "closed", sort: "oldest" });
  assert.equal(legacy.status, "closed");
  assert.equal(legacy.sort, "oldest");
  assert.equal(legacy.pageSize, 50);
  assert.equal(legacy.savedView, undefined);

  const qs = serializeCaseListUrlState(state);
  assert.match(qs, /status=open/);
  assert.match(qs, /sort=recent/);
  assert.match(qs, /pageSize=25/);
  assert.match(qs, /savedView=cview_abc/);
  assert.match(qs, /columns=number%2Ctitle%2Cseverity|columns=number,title,severity/);
  assert.doesNotMatch(
    serializeCaseListUrlState({
      sort: "priority",
      pageSize: 50,
      page: 1,
    }),
    /sort=|pageSize=|page=/,
    "defaults omitted from URL",
  );

  const roundTrip = parseCaseListUrlState(
    new URLSearchParams(qs.startsWith("?") ? qs.slice(1) : qs),
  );
  assert.equal(roundTrip.status, "open");
  assert.equal(roundTrip.sort, "recent");
  assert.equal(roundTrip.savedView, "cview_abc");

  const config = urlStateToConfig(state);
  const fromConfig = configToUrlState(config, { savedViewId: "cview_abc", page: 2 });
  assert.equal(fromConfig.status, "open");
  assert.equal(fromConfig.savedView, "cview_abc");
  assert.equal(urlStateMatchesConfig(state, config), true);

  const dirty = { ...state, severity: "low" as const };
  assert.equal(urlStateMatchesConfig(dirty, config), false);

  const compacted = compactCaseViewConfig(config);
  assert.equal(compacted.q, "phishing");
  assert.equal("evil" in compacted, false);
}

function testBulkPresets() {
  const good = parseBulkPreset({
    id: "p1",
    name: "Mark high",
    operationType: "set_severity",
    params: { severity: "high" },
  });
  assert.equal(good.operationType, "set_severity");

  assert.throws(
    () =>
      parseBulkPreset({
        id: "p2",
        name: "Bad",
        operationType: "drop_table",
        params: {},
      }),
    /Invalid|Unknown|Invalid/,
  );

  assert.throws(
    () =>
      parseBulkPreset({
        id: "p3",
        name: "Tag",
        operationType: "add_tag",
        params: {},
      }),
    BulkPresetValidationError,
  );

  assert.throws(
    () =>
      parseBulkPresets([
        {
          id: "same",
          name: "A",
          operationType: "acknowledge",
          params: {},
        },
        {
          id: "same",
          name: "B",
          operationType: "acknowledge",
          params: {},
        },
      ]),
    /Duplicate/,
  );

  const config = parseCaseViewConfig({
    bulkPresets: [
      {
        id: "p1",
        name: "Mark high",
        operationType: "set_severity",
        params: { severity: "high" },
      },
    ],
  });
  const preview = previewBulkPreset(config, "p1", [
    "case_a",
    "case_a",
    " case_b ",
    "",
  ]);
  assert.equal(preview.targetCount, 2);
  assert.deepEqual(preview.targetCaseIds, ["case_a", "case_b"]);
  assert.equal(preview.requiresConfirmation, true);
  assert.equal(preview.params.severity, "high");

  assert.throws(() => previewBulkPreset(config, "missing", ["case_a"]));

  // Stale/unknown action field on preset params
  const unknownParam = caseViewConfigSchema.safeParse({
    bulkPresets: [
      {
        id: "x",
        name: "X",
        operationType: "set_status",
        params: { status: "open", sql: "drop" },
      },
    ],
  });
  assert.equal(unknownParam.success, false, "unknown preset params rejected");
}

function main() {
  testConfigSchema();
  testUrlSerialization();
  testBulkPresets();
  console.log("test-case-views-unit: ok");
}

main();

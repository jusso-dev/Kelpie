/**
 * Coverage for the playbook catalogue (issue #52): baseline content
 * completeness, idempotent per-organisation seeding, "never overwrite an
 * existing row" upgrade behaviour, case-template linkage, catalogue
 * filtering, and the LLM.txt drift guard. Uses a real Postgres instance
 * (`DATABASE_URL`); no running Next.js server required.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { db } from "../src/db";
import { caseTemplates, organisations, playbooks } from "../src/db/schema";
import {
  BASELINE_PLAYBOOKS,
  BASELINE_TEMPLATES,
  PLAYBOOK_CATALOGUE_VERSION,
} from "../src/lib/playbook-catalogue";
import { seedBaselineOrganisationData, baselineCatalogueIsBehind } from "../src/lib/baseline-data";
import { listPlaybooksCore } from "../src/lib/playbooks-core";
import { LLM_AGENT_PROMPT } from "../src/lib/llm-prompt";
import { newId } from "../src/lib/utils";

const EXPECTED_SCENARIO_COUNT = 16;

const CLASSIFICATION_VALUES = new Set([
  "malware",
  "phishing",
  "unauthorised_access",
  "data_breach",
  "dos",
  "policy_violation",
  "other",
]);

async function main() {
  // ── Catalogue content coverage ───────────────────────────────────────────

  assert.equal(
    BASELINE_PLAYBOOKS.length,
    EXPECTED_SCENARIO_COUNT,
    `expected exactly ${EXPECTED_SCENARIO_COUNT} baseline scenarios`,
  );

  const keys = new Set(BASELINE_PLAYBOOKS.map((p) => p.key));
  assert.equal(keys.size, BASELINE_PLAYBOOKS.length, "every catalogue key must be unique");

  for (const baseline of BASELINE_PLAYBOOKS) {
    assert.ok(/^[a-z][a-z0-9_]*$/.test(baseline.key), `key "${baseline.key}" must be a stable snake_case slug`);
    assert.ok(CLASSIFICATION_VALUES.has(baseline.classification), `${baseline.key}: classification must be a known enum value`);
    assert.ok(baseline.steps.length >= 4, `${baseline.key}: expects real operational depth (>=4 steps)`);
    assert.ok(baseline.tags.length > 0, `${baseline.key}: expects at least one tag for filtering`);
    assert.ok(
      baseline.requiredObservableTypes.length > 0,
      `${baseline.key}: expects at least one required observable type`,
    );
    const c = baseline.content;
    assert.ok(c.purpose && c.purpose.length > 0, `${baseline.key}: content.purpose required`);
    assert.ok(c.triggers && c.triggers.length > 0, `${baseline.key}: content.triggers required`);
    assert.ok(c.evidenceToPreserve && c.evidenceToPreserve.length > 0, `${baseline.key}: content.evidenceToPreserve required`);
    assert.ok(c.initialQuestions && c.initialQuestions.length > 0, `${baseline.key}: content.initialQuestions required`);
    assert.ok(c.decisionPoints && c.decisionPoints.length > 0, `${baseline.key}: content.decisionPoints required`);
    assert.ok(c.approvalActions && c.approvalActions.length > 0, `${baseline.key}: content.approvalActions required`);
    assert.ok(c.closureCriteria && c.closureCriteria.length > 0, `${baseline.key}: content.closureCriteria required`);
    assert.ok(c.followUpImprovements && c.followUpImprovements.length > 0, `${baseline.key}: content.followUpImprovements required`);
    assert.ok(c.mitreTechniques && c.mitreTechniques.length > 0, `${baseline.key}: content.mitreTechniques (plain-text ATT&CK IDs) required`);
    for (const technique of c.mitreTechniques ?? []) {
      assert.ok(/^T\d{4}(\.\d{3})?$/.test(technique), `"${technique}" must look like a plain-text ATT&CK technique id`);
    }
    // At least one step should carry cadence/phase metadata consistent with
    // "containment, eradication, and recovery" coverage.
    const phases = new Set(baseline.steps.map((s) => s.phase).filter(Boolean));
    assert.ok(phases.size >= 2, `${baseline.key}: steps should span multiple response phases`);
  }

  // Every baseline template must reference a real playbook key.
  const playbookKeySet = new Set(BASELINE_PLAYBOOKS.map((p) => p.key));
  assert.equal(BASELINE_TEMPLATES.length, EXPECTED_SCENARIO_COUNT);
  for (const template of BASELINE_TEMPLATES) {
    assert.ok(playbookKeySet.has(template.playbookKey), `template "${template.key}" references unknown playbook key "${template.playbookKey}"`);
  }
  console.log(`Catalogue content coverage verified for ${BASELINE_PLAYBOOKS.length} scenarios.`);

  // ── LLM.txt drift guard ──────────────────────────────────────────────────

  const repoRoot = path.resolve(__dirname, "..");
  const llmTxt = fs.readFileSync(path.join(repoRoot, "LLM.txt"), "utf8");
  assert.equal(llmTxt, LLM_AGENT_PROMPT, "LLM.txt must exactly match src/lib/llm-prompt.ts's LLM_AGENT_PROMPT");

  // Required behavioural commitments from issue #52.
  const requiredPhrases = [
    "playbooks_list",
    "playbooks_get",
    "confirms it",
    "approval",
    "TLP",
    "PAP",
    "ip`",
    "file_hash",
    "domain",
    "scope",
  ];
  for (const phrase of requiredPhrases) {
    assert.ok(llmTxt.includes(phrase), `LLM.txt must mention "${phrase}"`);
  }
  // Placeholders only — no plausible real secret/token literal.
  assert.ok(llmTxt.includes("<KELPIE_BASE_URL>"), "LLM.txt must use a placeholder base URL");
  assert.ok(llmTxt.includes("<KELPIE_API_TOKEN>"), "LLM.txt must use a placeholder token");
  assert.ok(!/klp_[A-Za-z0-9_-]{20,}/.test(llmTxt), "LLM.txt must never contain a real-looking API token");
  console.log("LLM.txt matches the published constant and contains the required guidance.");

  // ── Seeding: idempotent, versioned, no-overwrite ─────────────────────────

  const orgAId = newId("org");
  const orgBId = newId("org");
  await db.insert(organisations).values([
    { id: orgAId, name: "Catalogue test org A", slug: `catalogue-a-${Date.now()}` },
    { id: orgBId, name: "Catalogue test org B", slug: `catalogue-b-${Date.now()}` },
  ]);

  try {
    assert.equal(await baselineCatalogueIsBehind(orgAId), true, "a brand-new org has no baseline playbooks yet");

    const first = await seedBaselineOrganisationData(orgAId);
    assert.equal(first.playbooksCreated, EXPECTED_SCENARIO_COUNT);
    assert.equal(first.templatesCreated, EXPECTED_SCENARIO_COUNT);
    assert.equal(first.playbooksSkipped, 0);
    assert.equal(first.templatesSkipped, 0);
    assert.equal(await baselineCatalogueIsBehind(orgAId), false, "fully seeded org is not behind");

    // Idempotency: seeding again is a complete no-op.
    const second = await seedBaselineOrganisationData(orgAId);
    assert.equal(second.playbooksCreated, 0, "re-seeding must not create duplicate playbooks");
    assert.equal(second.templatesCreated, 0, "re-seeding must not create duplicate templates");
    assert.equal(second.playbooksSkipped, EXPECTED_SCENARIO_COUNT);
    assert.equal(second.templatesSkipped, EXPECTED_SCENARIO_COUNT);

    const afterSeedTwice = await db
      .select({ id: playbooks.id })
      .from(playbooks)
      .where(eq(playbooks.organisationId, orgAId));
    assert.equal(afterSeedTwice.length, EXPECTED_SCENARIO_COUNT, "no duplicate rows after re-seeding");

    // Provenance and version stamped correctly on baseline rows.
    const seededRows = await db
      .select()
      .from(playbooks)
      .where(eq(playbooks.organisationId, orgAId));
    for (const row of seededRows) {
      assert.ok(row.catalogueKey, "every baseline row must carry a catalogue key");
      assert.equal(row.catalogueVersion, PLAYBOOK_CATALOGUE_VERSION);
    }

    // Simulate "an org customised a baseline playbook, and the catalogue
    // gained new content since": edit one playbook's name/steps, delete
    // another entirely (simulating "never had this scenario"), then re-seed.
    const editedKey = "reported_phishing";
    const missingKey = "denial_of_service";
    const editedTarget = seededRows.find((r) => r.catalogueKey === editedKey)!;
    const missingTarget = seededRows.find((r) => r.catalogueKey === missingKey)!;

    const customName = "Reported phishing — customised by SOC team";
    await db
      .update(playbooks)
      .set({ name: customName, isActive: false })
      .where(eq(playbooks.id, editedTarget.id));
    await db.delete(playbooks).where(eq(playbooks.id, missingTarget.id));

    const upgrade = await seedBaselineOrganisationData(orgAId);
    assert.equal(upgrade.playbooksCreated, 1, "only the missing scenario should be (re)created");
    assert.equal(upgrade.playbooksSkipped, EXPECTED_SCENARIO_COUNT - 1);
    assert.equal(
      upgrade.templatesRelinked,
      1,
      "the template pointing at the recreated playbook must be relinked to its new id",
    );

    const [stillEdited] = await db
      .select()
      .from(playbooks)
      .where(eq(playbooks.id, editedTarget.id));
    assert.equal(stillEdited.name, customName, "re-seeding must not revert a local edit");
    assert.equal(stillEdited.isActive, false, "re-seeding must not revert a local deactivation");

    const recreated = await db
      .select()
      .from(playbooks)
      .where(eq(playbooks.organisationId, orgAId));
    assert.equal(recreated.length, EXPECTED_SCENARIO_COUNT, "missing scenario is recreated, nothing duplicated");
    const recreatedTarget = recreated.find((r) => r.catalogueKey === missingKey);
    assert.ok(recreatedTarget, "missing scenario must be recreated by the sync");
    assert.notEqual(recreatedTarget!.id, missingTarget.id, "recreated row gets a fresh id");

    // Custom (non-catalogue) playbooks are never touched by seeding.
    const customId = newId("pb");
    await db.insert(playbooks).values({
      id: customId,
      organisationId: orgAId,
      name: "Fully custom playbook",
      classification: "other",
      steps: [],
    });
    await seedBaselineOrganisationData(orgAId);
    const [customStillThere] = await db
      .select()
      .from(playbooks)
      .where(eq(playbooks.id, customId));
    assert.ok(customStillThere, "custom playbooks must never be removed by baseline seeding");
    assert.equal(customStillThere.catalogueKey, null);

    console.log("Seed idempotency, upgrade, and no-overwrite behaviour verified.");

    // ── Template links ──────────────────────────────────────────────────────

    const templateRows = await db
      .select()
      .from(caseTemplates)
      .where(eq(caseTemplates.organisationId, orgAId));
    assert.equal(templateRows.length, EXPECTED_SCENARIO_COUNT);
    const playbookById = new Map(recreated.map((p) => [p.id, p]));
    for (const template of templateRows) {
      assert.ok(template.catalogueKey, "every baseline template must carry a catalogue key");
      assert.ok(template.defaultPlaybookId, `template "${template.name}" must link to a playbook`);
      const linkedPlaybook = playbookById.get(template.defaultPlaybookId!);
      assert.ok(linkedPlaybook, "linked playbook must exist in the same organisation");
      assert.equal(
        linkedPlaybook!.catalogueKey,
        template.catalogueKey,
        `template "${template.name}" must link to the playbook sharing its scenario key`,
      );
    }
    console.log("Case template -> playbook linkage verified for all baseline scenarios.");

    // ── Org isolation for seeding ────────────────────────────────────────────

    await seedBaselineOrganisationData(orgBId);
    const orgBPlaybooks = await db
      .select({ id: playbooks.id })
      .from(playbooks)
      .where(eq(playbooks.organisationId, orgBId));
    assert.equal(orgBPlaybooks.length, EXPECTED_SCENARIO_COUNT);
    const orgAIds = new Set(recreated.map((p) => p.id));
    assert.ok(
      orgBPlaybooks.every((p) => !orgAIds.has(p.id)),
      "org B must get its own distinct playbook rows, never org A's",
    );

    // ── Catalogue filtering (listPlaybooksCore) ─────────────────────────────

    const allActive = await listPlaybooksCore(orgAId);
    // customStillThere + 15 remaining active baseline playbooks (one was deactivated above).
    assert.equal(
      allActive.length,
      EXPECTED_SCENARIO_COUNT - 1 + 1,
      "active-only listing excludes the deactivated baseline row but includes the custom one",
    );
    assert.ok(!allActive.some((p) => p.id === editedTarget.id), "deactivated playbook excluded by default");

    const withInactive = await listPlaybooksCore(orgAId, { includeInactive: true });
    assert.equal(withInactive.length, EXPECTED_SCENARIO_COUNT + 1);
    assert.ok(withInactive.some((p) => p.id === editedTarget.id));

    const byScenario = await listPlaybooksCore(orgAId, {
      scenario: "malware_ransomware",
      includeInactive: true,
    });
    assert.equal(byScenario.length, 1);
    assert.equal(byScenario[0].catalogueKey, "malware_ransomware");
    assert.equal(byScenario[0].isBaseline, true);

    const byClassification = await listPlaybooksCore(orgAId, {
      classification: "unauthorised_access",
      includeInactive: true,
    });
    assert.ok(byClassification.length >= 5, "several scenarios share the unauthorised_access classification");
    assert.ok(byClassification.every((p) => p.classification === "unauthorised_access"));

    const bySeverity = await listPlaybooksCore(orgAId, { severity: "critical", includeInactive: true });
    assert.ok(bySeverity.length > 0);
    assert.ok(bySeverity.every((p) => p.defaultSeverity === "critical"));

    const byTag = await listPlaybooksCore(orgAId, { tag: "ransomware", includeInactive: true });
    assert.equal(byTag.length, 1);
    assert.equal(byTag[0].catalogueKey, "malware_ransomware");

    const byObservableType = await listPlaybooksCore(orgAId, {
      observableType: "file_hash",
      includeInactive: true,
    });
    assert.ok(byObservableType.length >= 2);
    assert.ok(byObservableType.every((p) => p.requiredObservableTypes.includes("file_hash")));

    const byText = await listPlaybooksCore(orgAId, { q: "ransomware", includeInactive: true });
    assert.ok(byText.some((p) => p.catalogueKey === "malware_ransomware"));

    const customOnly = await listPlaybooksCore(orgAId, { q: "Fully custom" });
    assert.equal(customOnly.length, 1);
    assert.equal(customOnly[0].isBaseline, false);

    console.log("Catalogue filtering (scenario/classification/severity/tag/observableType/q) verified.");
  } finally {
    await db.delete(organisations).where(eq(organisations.id, orgAId));
    await db.delete(organisations).where(eq(organisations.id, orgBId));
  }

  const remainingA = await db.select().from(playbooks).where(eq(playbooks.organisationId, orgAId));
  const remainingB = await db.select().from(playbooks).where(eq(playbooks.organisationId, orgBId));
  assert.equal(remainingA.length, 0, "teardown must cascade-delete org A playbooks");
  assert.equal(remainingB.length, 0, "teardown must cascade-delete org B playbooks");

  console.log("All playbook catalogue tests passed.");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

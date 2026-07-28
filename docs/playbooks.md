# Playbook catalogue

Kelpie ships a versioned baseline catalogue of 16 common SOC scenarios,
seeded per-organisation and safe to re-sync at any time. This document
covers the catalogue's structure, how to maintain it, and a worked example
of an agent using it through MCP.

For the copyable agent prompt, see [`/LLM.txt`](../LLM.txt) at the repository
root, also reproduced in-product under **Guides → Playbooks and agents**.

## Structure

Each baseline playbook (`src/lib/playbook-catalogue.ts`, `BASELINE_PLAYBOOKS`)
has:

- `key` — a stable identifier (e.g. `reported_phishing`). Stored on the
  seeded row as `playbooks.catalogue_key`.
- `name`, `description`, `classification`, `defaultSeverity` — summary
  fields used for display and filtering.
- `tags`, `requiredObservableTypes` — catalogue search/filter facets.
- `steps` — the ordered task list a playbook run creates on a case, each
  with an `offsetMinutes` cadence, an `isRequired` flag, an optional
  `phase` (`triage`, `scoping`, `containment`, `eradication`, `recovery`,
  `communications`, `closure`), and an optional `requiresApproval` hint.
- `content` — structured operational detail beyond the task list: `purpose`,
  `triggers`, `exclusions`, `severityGuidance`, `evidenceToPreserve`,
  `initialQuestions`, `decisionPoints`, `approvalActions`,
  `communicationsOwners`, `closureCriteria`, `followUpImprovements`,
  `mitreTechniques` (plain-text ATT&CK technique IDs), and
  `caseFieldsToCapture`.

`BASELINE_TEMPLATES` defines one case template per scenario, each linking to
its playbook via `playbookKey` so creating a case from the template can
immediately start the matching playbook.

## Versioning and idempotency

`PLAYBOOK_CATALOGUE_VERSION` (currently `1`) is stamped onto every row
inserted by seeding, as `catalogueVersion`. It is provenance, not a live sync
target: seeding never updates a row that already exists for a given
`catalogueKey`, regardless of the current catalogue version.

`seedBaselineOrganisationData` (`src/lib/baseline-data.ts`) is:

- **Idempotent per organisation** — called once at onboarding
  (`src/app/api/onboarding/route.ts`) and by `scripts/seed.ts`; running it
  again for the same organisation inserts nothing.
- **Safe to re-run at any time** — it looks up existing rows by
  `(organisationId, catalogueKey)` (a unique index), so it only ever inserts
  rows for scenarios the organisation does not already have. It never reads
  or compares content, so it can never silently revert an edit.
- **The mechanism for delivering new scenarios to existing organisations** —
  when the catalogue gains a new entry, existing organisations do not pick
  it up automatically. An administrator runs **Sync baseline catalogue** on
  the Playbooks page (`syncBaselineCatalogue` server action), which calls the
  same function and reports how many playbooks/templates were added.

### Provenance

`playbooks.catalogueKey` (and the matching `caseTemplates.catalogueKey`) is
`null` for organisation-authored custom playbooks/templates and non-null for
anything the baseline catalogue produced. The Playbooks page and the
`GET /api/v1/playbooks` / `playbooks_list` responses expose this as
`isBaseline` plus a "Baseline v{n}" / "Custom" badge. A baseline playbook an
organisation has since edited is still reported as baseline — the field
records where it came from, not whether it has been customised.

## Maintenance rules

1. **Never rename or reuse a `key`.** Renaming makes every already-seeded
   organisation look like it is missing that scenario, so the next sync
   would create a duplicate instead of recognising the existing row.
2. **Adding a new `BASELINE_PLAYBOOKS`/`BASELINE_TEMPLATES` entry is always
   safe.** It only ever appears for organisations missing that key; nothing
   existing is touched.
3. **Editing an existing entry's content changes what new (or
   never-seeded-that-key) organisations receive going forward.** It does
   *not* retroactively change any already-seeded playbook. If a fix must
   reach existing organisations, that is a deliberate, reviewed data
   migration — not a side effect of editing the catalogue file.
4. **Bump `PLAYBOOK_CATALOGUE_VERSION`** when the catalogue's shape or
   content meaningfully changes, so newly-inserted rows carry an accurate
   provenance marker.
5. **Keep `classification` within the existing enum** (`malware`,
   `phishing`, `unauthorised_access`, `data_breach`, `dos`,
   `policy_violation`, `other`). Distinguish finer-grained scenarios via
   `key`/`tags`/`requiredObservableTypes`, not by growing the case
   classification enum.
6. **MITRE ATT&CK technique IDs are plain strings.** Issue #48 (structured
   ATT&CK mapping) is a separate, unmerged change; the catalogue does not
   depend on it.
7. **Threat-intelligence indicator types stay limited to the four Kelpie
   supports** (`ip`, `url`, `file_hash`, `domain`). `requiredObservableTypes`
   may use the broader observable type list since it describes case
   observables generally, not TI indicators specifically.

## Search and filtering

The Playbooks page and `GET /api/v1/playbooks`/`playbooks_list` all share
`listPlaybooksCore` (`src/lib/playbooks-core.ts`), which filters by:

| Filter | Matches |
| --- | --- |
| `scenario` | `catalogueKey`, exact |
| `classification` | exact |
| `severity` | `defaultSeverity`, exact |
| `tag` | exact (normalised the same way stored tags are) |
| `observableType` | exact match against `requiredObservableTypes` |
| `q` | case-insensitive substring of name/description |
| `includeInactive` | include deactivated playbooks (default: active only) |

## Worked agent example

An agent connected to Kelpie's MCP server with a token scoped to
`playbooks:read` and `cases:read` is asked to help triage case `KP-2026-0091`.

1. **Inspect case facts first.** The agent reads the case: classification
   `phishing`, severity `medium`, one `url` observable, summary mentioning a
   user-reported email with a fake login link. No playbook has been started
   yet.
2. **Discover candidate playbooks.**
   ```json
   { "name": "playbooks_list", "arguments": { "classification": "phishing" } }
   ```
   returns the baseline `Reported phishing and malicious attachment/URL`
   playbook (`catalogueKey: "reported_phishing"`) among the results.
3. **Fetch full detail.**
   ```json
   { "name": "playbooks_get", "arguments": { "playbookId": "pb_..." } }
   ```
   returns its `steps` and `content`, including `initialQuestions` such as
   "did the user enter credentials?" and `evidenceToPreserve` such as
   "full original message including headers".
4. **State the match and the gap.** The agent tells the analyst: "This case
   matches the reported-phishing playbook (classification=phishing plus a
   URL observable and a user-reported lure in the summary). The playbook's
   first question — whether credentials were entered — is not yet recorded
   on this case; please confirm with the reporter."
5. **Propose tasks, owners, timing, and escalation** drawn from the
   playbook's `steps`/`content`, e.g.:
   - Preserve original message and headers — owner: reporting analyst —
     within 15 minutes.
   - Scope recipients and delivery via mail-log search — owner: security/IT
     — within 30 minutes.
   - Block sender/URL/attachment hash — owner: security/IT — within 60
     minutes — **requires approval** before any block that could affect
     legitimate mail flow.
   - Escalate to the business-email-compromise playbook if the sender turns
     out to be an internal/vendor mailbox rather than an external spoof.
6. **Respect the approval gate.** The agent does not call any response
   action to add the block itself; it proposes the action and its exact
   target, and waits for an analyst to run and approve it in Kelpie.
7. **Confirm, don't assume.** After the analyst reports the block was
   applied, the agent only records that fact if it can confirm it (e.g. the
   analyst's own message, or a subsequent tool call showing the observable
   marked as blocked/IOC) — it does not claim the block succeeded merely
   because it was proposed.

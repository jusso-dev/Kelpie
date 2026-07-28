# Kelpie REST API v1

All endpoints under `/api/v1` require a bearer token from **Settings → API tokens**. Scopes are enforced; a token with no scopes is rejected.

```
Authorization: Bearer klp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

Errors return `{ "error": "..." }` with an appropriate HTTP status (`400` invalid payload, `401` unauthorised, `403` forbidden, `404` not found).

## Scopes

| Scope | Allows |
| --- | --- |
| `cases:read` / `cases:write` | Read or create/update cases |
| `cases:override_closure` | Override case-closure policy requirements (sensitive; only grant to admin-issued tokens) |
| `case_views:read` / `case_views:write` | Read or manage saved case views, counts, widgets, and personal defaults |
| `tasks:read` / `tasks:write` | Read or create/update tasks |
| `observables:read` / `observables:write` | Search or add observables |
| `comments:read` / `comments:write` | Read or post comments |
| `threat_intelligence:read` | Search TI indicators and inspect feed state |
| `threat_landscape:read` | Read current Cloudflare Radar Threat landscape data |
| `briefing:read` | Read Cyber brief, watched vendors, and vendor matches |
| `case_relationships:read` | Read case relationships and duplicate/related suggestions |
| `case_relationships:write` | Link, unlink, and dismiss case relationships |
| `playbooks:read` | Read the playbook catalogue (baseline and custom) |
| `audit:read` | Search the organisation audit trail and read individual audit event detail (sensitive; only grant to admin-issued tokens) |
| `alerts:read` | Read alerts, linked entities, and evidence items |
| `alerts:write` | Create/link alerts, change alert disposition, link entities, and create/update evidence items |
| `alerts:raw_payload:read` | Read raw provider payload references behind alerts and evidence (sensitive; only grant to admin-issued tokens) |
| `attack:read` | Read the ATT&CK technique catalog, technique mappings, attack stories, and coverage |
| `attack:write` | Attach, update, and remove ATT&CK technique mappings and attack-story entries |
| `content_blocks:read` | Read structured investigation content blocks and revision history |
| `content_blocks:write` | Create, edit, archive, reorder, promote, and link structured investigation content blocks |
| `reports:read` | Read report templates, previews, export history, and download released reports |
| `reports:write` | Generate case reports, request release approval, and manage report schedules |
| `reports:admin` | Create/version report templates and approve report release (sensitive; admin-issued tokens) |
| `reviews:read` | Read post-incident reviews, revisions, follow-ups, knowledge articles, and improvement proposals |
| `reviews:write` | Create and edit post-incident reviews, follow-ups, knowledge articles, and improvement proposals |
| `reviews:admin` | Manage review templates, org review policy, and approve reviews (sensitive; admin-issued tokens) |
| `investigation:read` | List investigation console commands, execution history, and results |
| `investigation:execute` | Execute registered investigation commands, cancel runs, approve/reject writes, and save results as evidence |

**Empty scopes grant nothing.** A token whose `scopes` array is empty fails every scope check (`403`). Sensitive scopes (`alerts:raw_payload:read`, `evidence:override`, `audit:read`, `cases:override_closure`, `reports:admin`, `reviews:admin`) are never implied. Migration `0026_empty_token_scopes` rewrites any pre-existing empty-scope tokens to an explicit non-sensitive set so ordinary integrations keep working without retaining those sensitive powers — re-issue tokens that intentionally need sensitive scopes from Settings after upgrading.

## Cases

### `GET /api/v1/cases`
Optional query: `status`, `severity`, `classification`, `tlp`, `assignee`, `openedSince`, `limit`, `source`, `technique`, `tactic`. `status=active` returns every status except `closed`. `source` filters on the exact `source_system` value (e.g. `?source=tawny`) — it is an equality match, not a prefix or substring search. `technique` filters to cases with at least one ATT&CK technique mapping matching that exact technique id (e.g. `?technique=T1566.001`); `tactic` filters to cases with at least one mapped technique belonging to that exact tactic id (e.g. `?tactic=initial-access`), evaluated against the currently active catalog version.

Results are filtered by the token actor's **case compartment** policy (issue #61). Cases the actor must not know exist are omitted entirely (no count or facet leak). When an actor has `know_exists` but not `view_metadata`, `title` is replaced with `[redacted]` and `summary` is null.

### `POST /api/v1/cases`
```json
{
  "title": "Phishing wave against finance team",
  "summary": "Lure with fake DocuSign link",
  "severity": "high",
  "classification": "phishing",
  "tlp": "amber"
}
```
Returns `201 { "id": "case_...", "caseNumber": "KP-2026-0042" }`.

Organisation is always derived from the bearer token; it can never be supplied in the request body.

#### Source-tracked cases (push producers)

Three optional fields let an external push producer — such as Tawny; see the [Tawny integration guide](./integrations/tawny.md) — attach provenance to a case it creates, and get safe-to-retry delivery for free:

| Field | Type | Rules |
| --- | --- | --- |
| `sourceSystem` | string | 1–64 chars, lowercase slug matching `^[a-z0-9][a-z0-9_-]*$`. Reserved managed-connector namespaces (`microsoft_sentinel`, `microsoft_defender_xdr`) are rejected — those are owned by Kelpie's own pollers and always identify themselves as `<kind>:<id>`, which contains a colon and can never collide with a push producer's bare slug. |
| `sourceReference` | string | 1–200 chars. The producer's stable alert/incident ID. Requires `sourceSystem` to also be present in the same request — sending `sourceReference` alone returns `400`. |
| `sourceUrl` | string | ≤2048 chars. Must use the `http:` or `https:` scheme only; URLs carrying embedded credentials (`https://user:pass@host`) are rejected. Stored in normalised form. |

**Idempotency.** When both `sourceSystem` and `sourceReference` are present, `(organisation, sourceSystem, sourceReference)` is enforced as unique by a partial unique index, so retried or concurrently delivered payloads for the same source reference converge on a single case rather than creating duplicates:

- First delivery for a given `(sourceSystem, sourceReference)` → **`201`** with `"created": true`.
- Any later delivery for the same `(sourceSystem, sourceReference)` in the same organisation → **`200`** with `"created": false`, returning the existing case's `id` and `caseNumber` unchanged.
- Two deliveries racing at the same instant resolve safely to one case: whichever write loses the database conflict is read back as the existing row and answered with `200`, so no duplicate case is ever created.
- The same `sourceReference` may exist independently in different organisations without colliding — the uniqueness is scoped per organisation, not global.
- `sourceSystem` without `sourceReference` is accepted: the case records provenance, but there is no idempotency key, so repeated deliveries that omit `sourceReference` each create a new case.
- Invalid or oversized source metadata returns `400 { "error": "Invalid payload", "details": { ... } }` (common causes: a reserved `sourceSystem`, `sourceReference` sent without `sourceSystem`, or a `sourceUrl` that is not `http(s)` or exceeds 2048 characters).

Example request carrying source fields:
```json
{
  "title": "Phishing wave against finance team",
  "summary": "Lure with fake DocuSign link",
  "severity": "high",
  "classification": "phishing",
  "tlp": "amber",
  "sourceSystem": "tawny",
  "sourceReference": "alert_9f2c1e",
  "sourceUrl": "https://tawny.example.com/alerts/9f2c1e"
}
```

First delivery — `201`:
```json
{ "id": "case_8k2n4qz", "caseNumber": "KP-2026-0042", "created": true }
```

Replay of the same `sourceSystem`/`sourceReference` — `200`:
```json
{ "id": "case_8k2n4qz", "caseNumber": "KP-2026-0042", "created": false }
```

### `GET /api/v1/cases/{id}`
Full case with embedded `observables`, `tasks`, and a `recent_timeline` slice (50 most recent events). Requires compartment `view_metadata`. Missing cases and cases the actor must not see both return `404` with the same body. Response includes:

- `custom_fields` — values with sensitive fields redacted to `"[redacted]"` when the actor lacks `view_sensitive`
- `custom_fields_detail` — per-field metadata including `sensitive` and `redacted` flags
- `access.permissions` / `access.accessPolicyVersion` / `access.visibilityMode`

### `PATCH /api/v1/cases/{id}`
Requires compartment `edit` in addition to `cases:write`.

## Case compartments & access (need-to-know)

Visibility modes: `organisation` (default), `selected_teams`, `explicit_members`, `restricted`.

Independent permissions: `know_exists`, `view_metadata`, `view_sensitive`, `edit`, `export`, `administer_access`.

Deny by default on policy failure. Assigning or mentioning a user never grants access. Export is evaluated independently of view. Break-glass always requires a reason, always expires, is fully audited, and emails organisation admins.

### `GET /api/v1/cases/{id}/access`
Returns visibility mode and the caller's effective permissions. Full grant/compartment detail requires `administer_access`.

### `PATCH /api/v1/cases/{id}/access`
Change visibility mode. Requires `administer_access` + `cases:write`.
```json
{
  "visibilityMode": "selected_teams",
  "teamIds": ["team_…"],
  "memberIds": ["user_…"],
  "reason": "Legal hold need-to-know scope"
}
```

### `GET /api/v1/cases/{id}/access/grants`
### `POST /api/v1/cases/{id}/access/grants`
Create a reason-required grant (optional `expiresAt`, optional object scope).
```json
{
  "subjectType": "user",
  "subjectId": "user_…",
  "permissions": ["know_exists", "view_metadata", "view_sensitive"],
  "reason": "Lead investigator assignment",
  "expiresAt": "2026-12-01T00:00:00.000Z",
  "objectType": "case"
}
```

### `POST /api/v1/cases/{id}/access/grants/{grantId}/revoke`
```json
{ "reason": "Investigation hand-off complete" }
```

### `POST /api/v1/cases/{id}/access/break-glass`
Emergency self-grant for a user-backed token. Default TTL 4 hours (max 24h).
```json
{ "reason": "Active containment decision requires case context" }
```

### `GET /api/v1/cases/{id}/access/history`
Append-only access history (grants, revocations, break-glass, visibility changes). Never contains sensitive field values. Requires `administer_access`.

Any subset of `status, severity, classification, tlp, pap, assigneeId, title, summary`. Status transitions stamp the lifecycle milestones and fire the `case.status_changed` webhook.

`status: "closed"` is rejected here (`400`). Use `POST /api/v1/cases/{id}/close` so the shared closure validator runs. Reopening a closed case also requires `POST /api/v1/cases/{id}/reopen` with a reason.

### `POST /api/v1/cases/{id}/close`
Closes a case through the organisation (or template) closure policy. Same validator as the UI.

```json
{
  "disposition": "resolved",
  "conclusion": "Contained and eradicated; recovery verified.",
  "determination": "true_positive",
  "rootCause": "Phishing credential harvest",
  "businessImpact": "None material",
  "lessonsLearned": "Faster MFA enrolment",
  "approverId": "user_…",
  "reviewedRelatedCaseIds": ["case_…"],
  "postIncidentReviewCompleted": true,
  "version": 3,
  "override": false,
  "overrideReason": null
}
```

- `disposition` (required): `resolved` | `false_positive` | `duplicate` | `benign` | `risk_accepted`
- `conclusion` (required): analyst narrative
- `version` (optional): optimistic concurrency; `409 version_conflict` when stale
- Unmet requirements → `422 { "error": "closure_requirements_not_met", "evaluation": { … } }` with a per-requirement checklist (`missing` lists exact tasks/fields/alerts/…)
- Privileged override: set `override: true` + `overrideReason` (≥3 chars). Requires `cases:override_closure` on the token (or admin in the UI). When the policy version has two-person override, `approverId` must be a distinct admin in the same organisation.
- Success returns `{ ok, version, snapshot_id, was_override, evaluation }`. A closure snapshot is always persisted and retained across reopen.

### `POST /api/v1/cases/{id}/reopen`
```json
{ "reason": "New IOC matched in TI feed", "nextStatus": "in_progress", "version": 4 }
```
Prior closure snapshots stay on the case (stamped with `reopenedAt` / `reopenReason`). `reason` is required (≥3 chars).

### `GET|POST /api/v1/cases/{id}/closure-check`
Preview policy evaluation without mutating the case (`cases:read`). GET uses placeholder disposition fields; POST accepts the same disposition body as close (without override). Also returns historical `snapshots` on GET.

## Tasks

### `GET /api/v1/tasks`
Cross-case task inbox. Optional query: `status` (`open`, a task status, or `all`), `mine=true`, `limit`. Tasks include case number, title, and severity.

### `GET /api/v1/cases/{caseId}/tasks`
### `POST /api/v1/cases/{caseId}/tasks`
```json
{ "title": "Hunt for clicks", "description": "Auth log search", "dueAt": "2026-05-25T03:00:00Z" }
```

### `PATCH /api/v1/tasks/{id}`
Any subset of `status, assigneeId, dueAt, title, description`. Setting `status: "done"` stamps `completedAt` and writes the `task_completed` timeline event.

## Observables

### `GET /api/v1/cases/{caseId}/observables`
### `POST /api/v1/cases/{caseId}/observables`
```json
{ "type": "ip", "value": "198.51.100.42", "tlp": "amber", "isIoc": true }
```
Adding an observable kicks off enrichment.

### `GET /api/v1/observables?value=&exact=`
Cross-case search. With `exact=true` does an equality match; otherwise substring.

## Playbooks

### `GET /api/v1/playbooks`

Requires `playbooks:read`. Read-only; lists this organisation's playbook
catalogue (baseline and custom). Optional query: `scenario` (baseline
catalogue key, exact match), `classification`, `severity`, `tag` (exact),
`observableType` (exact, one of the [observable
types](#observables)), `q` (search name/description), `includeInactive`
(`true` to include deactivated playbooks; default is active-only).

Returns `{ "playbooks": [ { "id", "name", "description", "classification",
"defaultSeverity", "isActive", "tags", "requiredObservableTypes",
"catalogueKey", "catalogueVersion", "isBaseline", "stepCount", "createdAt" } ] }`.
`isBaseline` is `true` when the playbook has a `catalogueKey` (it originated
from the baseline catalogue), `false` for organisation-authored custom
playbooks — this is provenance only; a baseline playbook that has since been
edited by the organisation is still reported as baseline.

### `GET /api/v1/playbooks/{id}`

Requires `playbooks:read`. Returns the same fields as the list endpoint for
one playbook, plus its full `steps` (ordered task list with cadence offsets)
and `content` (purpose, triggers, exclusions, severity guidance, evidence to
preserve, initial questions, decision points, approval actions, closure
criteria, follow-up improvements, MITRE ATT&CK technique references, and
case fields to capture). See `docs/playbooks.md` for the full catalogue
structure and maintenance rules.

## Case relationships

Typed, confirmed links between two cases (`duplicate_of`, `related_to`, `parent_of`/`child_of`), plus a scored duplicate/related-case suggestion feed. A relationship is always visible from both cases it connects — `GET` on either side returns it, oriented to that case's point of view. `parent_of` and `child_of` are the same stored edge viewed from opposite ends: linking with `child_of` (or reading it from the child case) is just the inverse presentation of a `parent_of` row, not a second edge. `related_to` is symmetric. All six endpoints below are gated on `case_relationships:read` (reads and suggestions) or `case_relationships:write` (link, unlink, dismiss); no separate `cases:*` scope is required.

A case in any status — including `closed` — can be linked or unlinked; doing so never changes the case's status.

### `GET /api/v1/cases/{id}/relationships`
Returns every confirmed relationship touching the case, most recent first.

```json
{
  "relationships": [
    {
      "id": "caserel_8k2n4qz",
      "relationshipType": "child_of",
      "direction": "incoming",
      "confidence": 100,
      "origin": "analyst",
      "ruleId": null,
      "ruleVersion": null,
      "reason": "Same campaign, this case tracks the broader wave",
      "createdBy": "user_9f2c1e",
      "createdAt": "2026-07-28T02:14:00Z",
      "otherCase": {
        "id": "case_3ecfe70",
        "caseNumber": "KP-2026-0041",
        "title": "Parent incident: credential stuffing wave",
        "status": "open",
        "severity": "high"
      }
    }
  ]
}
```

`relationshipType` and `direction` are always expressed from the perspective of the case in the URL: a `parent_of` edge appears as `child_of`/`incoming` when read from the child case, and as `parent_of`/`outgoing` from the parent case. `related_to` always reports `direction: "symmetric"`. Returns `404` if the case does not exist in the caller's organisation.

### `POST /api/v1/cases/{id}/relationships`
```json
{
  "targetCaseId": "case_a1b2c3",
  "relationshipType": "duplicate_of",
  "reason": "Same phishing lure reported by two mailboxes",
  "confidence": 90
}
```
`relationshipType` is one of `duplicate_of`, `related_to`, `parent_of`, `child_of`. `reason` is required (non-empty after trimming). `confidence` (0–100), `origin` (`analyst`, `provider`, or `rule`; defaults to `analyst`), `ruleId`, and `ruleVersion` are optional — `origin: "analyst"` links default to `confidence: 100` when omitted. Returns `201` with the created relationship in the same shape as the `GET` list, oriented from the case in the URL:
```json
{ "relationship": { "id": "caserel_8k2n4qz", "relationshipType": "duplicate_of", "direction": "outgoing", "...": "..." } }
```

Status codes:
- `400` — missing/empty `reason`, unknown `relationshipType`, out-of-range `confidence`, or the case linking to itself.
- `403` — token lacks `case_relationships:write`.
- `404` — either case does not exist in the caller's organisation (this includes cross-organisation link attempts, which never leak whether the target case exists elsewhere).
- `409` — the exact edge already exists, or a conflicting reverse-direction edge already exists for a directional type (e.g. linking B `parent_of` A when A `parent_of` B is already recorded).

### `DELETE /api/v1/cases/{id}/relationships/{relationshipId}`
```json
{ "reason": "No longer related after review" }
```
`reason` is required. Returns `200 { "ok": true }`. Writes a `relationship_removed` timeline event on both cases (the timeline is append-only — the earlier `relationship_created` event is never edited or deleted). Returns `400` for a missing/empty reason, `403` without `case_relationships:write`, `404` if the relationship does not exist on this case in the caller's organisation.

### `GET /api/v1/cases/{id}/relationships/suggestions?limit=`
Scores every other case in the organisation against this case (title similarity, shared observables, shared tags, shared vendor mentions) and returns likely duplicates/related cases that are not already linked or previously dismissed. `limit` is optional, 1–25, defaults to 10.

```json
{
  "suggestions": [
    {
      "candidateCase": {
        "id": "case_7f0a12",
        "caseNumber": "KP-2026-0055",
        "title": "Widespread phishing campaign targeting payroll department",
        "status": "open",
        "severity": "medium"
      },
      "score": 78,
      "matchedSignals": {
        "titleSimilarity": 0.82,
        "sharedObservables": ["203.0.113.77", "198.51.100.44"],
        "sharedTags": ["phishing", "payroll"],
        "sharedVendors": []
      },
      "suggestedType": "duplicate_of"
    }
  ]
}
```
`score` is 0–100. `suggestedType` is `duplicate_of` at score ≥ 70, otherwise `related_to`. Suggestions never cross organisations. Returns `404` if the case does not exist in the caller's organisation.

### `POST /api/v1/cases/relationships/suggestions`
Same scoring as above, but for a case that has not been created yet — used by the new-case form to surface likely duplicates before submit.
```json
{
  "title": "Widespread phishing campaign targeting payroll staff",
  "summary": "Lure with fake DocuSign link",
  "tags": ["phishing", "payroll"]
}
```
Returns `200` with the same `{ "suggestions": [...] }` shape as the per-case suggestions endpoint. `title` is required; `summary` and `tags` are optional.

### `POST /api/v1/cases/{id}/relationships/suggestions/dismiss`
```json
{ "candidateCaseId": "case_7f0a12", "reason": "Reviewed — unrelated despite the overlap" }
```
Records that an analyst reviewed and rejected this pairing so it stops appearing in either case's suggestions. `reason` is required. Returns `200 { "ok": true }`. Returns `400` for a missing/empty reason or a candidate equal to the case itself, `403` without `case_relationships:write`, `404` if either case does not exist in the caller's organisation.

## Investigation model: alerts, entities, evidence

A case is an investigation container around independently addressable **alerts** (one detection each), **entities** (deduplicated users/devices/mailboxes/IPs/domains/URLs/files/hashes/processes/cloud resources/applications/tenants/networks/generic assets), and **evidence items** (indicators, log excerpts, findings — investigation-level records, distinct from the binary attachment storage documented separately). One case can hold many alerts; one alert can be linked to many entities and evidence items.

**Field ownership.** Every alert and evidence item column is one of three kinds, and the API enforces the boundary rather than just documenting it:
- *Provider-owned* (`title`, `description`, `detectionSource`/`detectionProduct`, `classification`, `severity` — until an analyst overrides it, `detectedAt`, `sourceUrl`, `normalizedFields`, `attackTechniques` on alerts; `source`, `firstSeenAt`/`lastSeenAt` on evidence items): refreshed every time the owning connector re-syncs. A provider re-sync is always safe to replay — it never overwrites analyst work.
- *Analyst-owned* (`status`, `determination`, `assigneeId`, `analystNotes`, `dismissedReason` on alerts; `verdict`, `remediationState`, `analystNotes` on evidence items): only ever change through the `PATCH` endpoints below. Once an analyst sets `severity` on an alert, that override sticks — later provider syncs skip that one field but keep refreshing everything else.
- *Derived* (alert `derivedFields`): recomputable, and always carries `{ value, method, computedAt }` provenance rather than a bare number.

**Raw provider payloads** are never inlined in an alert, evidence item, or timeline event — they're bounded to 256KB, redacted (secret-shaped keys are stripped before storage, same redaction as the audit trail), and stored as a separate reference. Reading one back requires the separate, sensitive `alerts:raw_payload:read` scope (admin-issued tokens only) via `GET /api/v1/alerts/{id}/raw-payload`; it is never present in a list or detail response.

**Pagination.** All three list endpoints below (`GET .../alerts`, `GET .../entities`, `GET .../evidence-items`) use the same opaque keyset cursor as `GET /api/v1/audit-events`: `limit` (default 50, maximum 200) and `cursor` (from a previous response's `nextCursor`, `null` once exhausted). Ordering is most-recently-created first, so pages stay stable under concurrent inserts.

**Ownership and isolation.** Every alert, entity, evidence item, and link is scoped to the caller's organisation exactly like cases — a `GET`/`PATCH`/`POST` against an id from another organisation returns `404`, never a permission error that would confirm the id exists elsewhere. `(organisationId, sourceId, tenantId, externalId)` is unique on alerts, so re-polling a connector never creates a duplicate; `(organisationId, type, canonicalKey)` is unique on entities, so the same user/device/hash resolves to one row regardless of how many alerts mention it.

**Concurrency.** Alerts carry an optimistic `version` counter, guarded the same way as case fields: pass the `version` you last read in a `PATCH` body and a conflicting concurrent write returns `409 { "error": "version_conflict", "current": { ...the alert as it now stands... } }` instead of silently clobbering another analyst's change. Omitting `version` skips the guard (last write wins on analyst-owned fields only — provider-owned fields are never touched by this endpoint).

Reads use the `alerts:read` scope; every mutation below uses `alerts:write` (this single pair covers alerts, entities, and evidence items — there is no separate `entities:*` or `evidence_items:*` scope).

### `GET /api/v1/cases/{id}/alerts`
### `POST /api/v1/cases/{id}/alerts`
Either links an existing alert into the case — `{ "alertId": "alert_...", "isPrimary": true }` — or creates a new manually-authored alert and links it in one call:
```json
{ "title": "Suspicious sign-in", "severity": "high", "description": "Impossible travel flagged" }
```
Linking is idempotent: linking an already-linked alert again returns the existing link rather than erroring or duplicating a timeline event. Returns `201` with `{ "alert": { ... }, "link": { ... } }`.

### `GET /api/v1/alerts/{id}`
### `PATCH /api/v1/alerts/{id}`
Any subset of `status` (`new`, `in_progress`, `closed`, `dismissed`), `determination` (`unknown`, `true_positive`, `false_positive`, `benign_positive`), `severity` (setting this always marks it analyst-overridden), `assigneeId`, `analystNotes`, `dismissedReason`, plus optional `version` for the concurrency guard described above. Writes `alert_status_changed`, `alert_verdict_changed`, and/or `alert_assigned` timeline events on every case the alert is currently linked to, for whichever fields actually changed.

### `GET /api/v1/alerts/{id}/entities`
### `POST /api/v1/alerts/{id}/entities`
Resolves (or creates) an entity from one or more identifiers and links it to the alert with a role (`actor`, `target`, `impacted`, `related`):
```json
{
  "type": "user_identity",
  "displayName": "sam.analyst@example.com",
  "role": "actor",
  "identifiers": [{ "kind": "email", "value": "sam.analyst@example.com" }]
}
```
Entity resolution is type-aware: `email`/`upn`/hostnames/hashes normalise to lower case, SIDs to upper case, before matching. Linking is idempotent per `(alert, entity, role)` and writes an `alert_entity_linked` timeline event on every case the alert is linked to.

### `GET /api/v1/alerts/{id}/raw-payload`
Sensitive; requires `alerts:raw_payload:read`. Returns `404` if the alert has no `rawPayloadRefId`, or if the reference does not exist in the caller's organisation.

### `GET /api/v1/cases/{id}/entities`
Entities aggregated across every alert currently linked to the case, most-recently-seen first.

### `GET /api/v1/cases/{id}/evidence-items`
### `POST /api/v1/cases/{id}/evidence-items`
```json
{ "type": "observable", "value": "203.0.113.9", "alertId": "alert_...", "confidence": 80 }
```
`type` is required; `alertId`, `entityId`, and `attachmentId` (linking to a binary attachment) are all optional and independent. `confidence` is 0–100. Writes an `evidence_item_created` timeline event.

### `GET /api/v1/evidence-items/{id}`
### `PATCH /api/v1/evidence-items/{id}`
Any subset of `verdict` (`unknown`, `clean`, `suspicious`, `malicious`), `remediationState` (`none`, `pending`, `remediated`, `not_applicable`), `analystNotes`. Writes `evidence_item_verdict_changed` and/or `evidence_item_remediation_changed` timeline events for whichever fields actually changed.

### `GET /api/v1/evidence-items/{id}/relationships`
### `POST /api/v1/evidence-items/{id}/relationships`
```json
{ "targetEvidenceId": "evitem_...", "relationshipType": "related_to", "reason": "Same campaign" }
```
`relationshipType` is `related_to`, `duplicate_of` (both symmetric — canonicalised the same way as case relationships, so linking B to A afterwards returns `409` rather than a second edge), or `derived_from` (directional — A derived_from B and B derived_from A are independent facts). Both evidence items must belong to the same case. Writes an `evidence_relationship_created` timeline event.

### Migrating existing source-backed cases

Cases created before this model existed (via `sourceSystem`/`sourceReference`, e.g. from Microsoft Sentinel/Defender XDR import) are backfilled by `npm run backfill:alerts`: for every such case with no alert yet, it creates (or reuses) an `alert_sources` row for that source, an `alerts` row that preserves the exact `sourceSystem` as `detectionSource` and `sourceReference` as the alert's immutable `externalId`, and links it into the case as the primary alert. The script is idempotent — re-running it after new source-backed cases appear only backfills the ones still missing an alert; it never creates a duplicate.

## Alert correlation (grouping, move, merge, split)

Analyst-governed correlation proposes transparent groupings; it never silently merges cases. Scopes: `correlation:read`, `correlation:write`.

**Signals** (organisation rule config, versioned): shared canonical entities, shared observables, provider/source incident id, detection product/family, time window, tenant, ATT&CK techniques. Every suggestion stores score, contributing signals, rule key/version, generated time, and status (`pending` / `accepted` / `rejected` / `expired` / `auto_applied`).

**Governance.** Rules default to `dryRun: true`. Organisation policy `settings.correlation.autoMergeEnabled` defaults to `false`. Automatic apply only when policy is on, the rule is not dry-run, and (optionally) score ≥ `autoAcceptThreshold`. Move, merge, split, and suggestion rejection **require a reason** and are audited. Case merge never deletes sources — they stay navigable with `supersededByCaseId` pointing at the canonical case. Reverse is allowed until `reverseDeadline` (default 24h) when no incompatible downstream mutation blocks it.

**Concurrency.** Pass optional `expectedVersions: { "<caseId>": <version> }` on mutating calls. Mismatch returns `409 { "error": "version_conflict", "current": { ... } }`.

### Rules and policy
- `GET/POST /api/v1/correlation/rules` — list / create versioned rules
- `GET/PATCH /api/v1/correlation/rules/{id}` — fetch / update (active material changes supersede and insert a new version)
- `GET/PATCH /api/v1/correlation/policy` — `{ autoMergeEnabled, autoAcceptThreshold, mergeSafetyWindowHours }`
- `GET /api/v1/correlation/metrics?ruleKey=` — suggestion / accept / reject / auto-applied counts
- `POST /api/v1/correlation/dry-run` — preview pairs without persisting (`correlation:read`)
- `POST /api/v1/correlation/evaluate` — persist suggestions (and auto-apply only if policy allows)

### Suggestions
- `GET /api/v1/correlation/suggestions?status=pending&caseId=`
- `GET /api/v1/cases/{id}/correlation-suggestions`
- `GET /api/v1/correlation/suggestions/{id}`
- `POST /api/v1/correlation/suggestions/{id}` with `{ "action": "accept"|"reject", "reason": "..." }`

### Membership operations (all require `reason`)
- `POST /api/v1/correlation/attach` — `{ caseId, alertIds, reason }`
- `POST /api/v1/correlation/moves` — `{ fromCaseId, toCaseId, alertIds, reason }`
- `POST /api/v1/correlation/create-case` — `{ alertIds, reason, title? }`
- `POST /api/v1/correlation/splits` — `{ fromCaseId, alertIds, reason, title? }`
- `POST /api/v1/correlation/merges` — `{ canonicalCaseId, sourceCaseIds, reason }`
- `POST /api/v1/correlation/merges/{id}/reverse` — `{ reason }`
- `GET /api/v1/alerts/{id}/membership-history` — immutable lineage (`correlation:read` or `alerts:read`)

Moves preserve alert source ids/entities; evidence items tied to moved alerts follow the destination case. Timeline events: `alert_linked_to_case` / `alert_unlinked_from_case` (with correlation payload), `case_merged`, `case_merge_reversed`, `correlation_suggestion_accepted`, `correlation_suggestion_rejected`.

## ATT&CK technique mapping

Kelpie ships a versioned, organisation-independent ATT&CK Enterprise technique catalog (a bundled offline baseline snapshot by default; an administrator can refresh it from a configured URL under **Settings**, which runs through BullMQ and is rolled back automatically on failure). Analysts attach techniques to a case, alert, observable, evidence item, or task, recording confidence, source, notes, detection notes, response notes, and analyst-entered actor attribution as separate fields. Kelpie never infers actor attribution automatically. An alert mapping is linked to a case for timeline/audit purposes via its `case_alerts` link (preferring the alert's primary case, otherwise its most recently linked case); a mapping on an alert not yet linked to any case still succeeds — it is recorded on the organisation audit trail without a case timeline entry.

### `GET /api/v1/attack/techniques?q=&tactic=&includeDeprecated=&limit=`
Search the active catalog version. `q` matches technique id or name substring. `tactic` is an exact ATT&CK tactic id (e.g. `lateral-movement`). Deprecated techniques are excluded unless `includeDeprecated=true` — deprecated techniques remain in the catalog and readable on historical mappings, they just don't surface in the default search.

### `GET /api/v1/attack/mappings?caseId=` or `?entityType=&entityId=`
Returns every mapping touching a case (the case's own mapping plus its linked alerts/observables/evidence/tasks) or the mappings on one specific entity.

### `POST /api/v1/attack/mappings`
```json
{
  "entityType": "observable",
  "entityId": "obs_...",
  "techniqueId": "T1566.001",
  "confidence": 80,
  "source": "analyst",
  "notes": "Matches the phishing lure",
  "detectionNotes": "Flagged by mail gateway attachment sandbox",
  "responseNotes": "Blocked sender domain, reset affected mailbox credentials",
  "actorAttribution": "Suspected commodity phishing kit, not attributed to a named actor"
}
```
Duplicate mappings (same organisation, entity, and technique) are rejected with `409`. Every create/update/remove is recorded on the case timeline and the organisation audit trail.

### `PATCH /api/v1/attack/mappings/{id}` / `DELETE /api/v1/attack/mappings/{id}`
Update or remove a mapping. `PATCH` accepts any subset of `confidence`, `source`, `notes`, `detectionNotes`, `responseNotes`, `actorAttribution`.

### `GET /api/v1/attack/coverage`
Organisation-wide coverage: mapped techniques grouped by tactic, mappings still missing detection/response notes ("unresolved work"), and playbook/case-template coverage broken down by investigation/detection/containment/recovery guidance category.

### Attack story ordering

### `GET /api/v1/cases/{id}/attack-story`
### `POST /api/v1/cases/{id}/attack-story`
```json
{ "title": "Initial phishing click", "provenance": "analyst", "techniqueId": "T1566.001" }
```
Entries are ordered by an explicit `sequenceIndex` set by whoever adds/reorders them; `occurredAt` is optional contextual timing only and is never used to infer order.

### `PATCH /api/v1/cases/{id}/attack-story/{entryId}`
Send `{ "targetIndex": 2 }` to reorder, or any subset of `title`, `description`, `sourceRef`, `occurredAt` to edit.

### `DELETE /api/v1/cases/{id}/attack-story/{entryId}`

## Investigation graph (relationship graph + attack story)

Typed investigation graph for a case (issue #65). Nodes and structural edges are **derived** from already-stored data (`case_alerts`, `alert_entities`, `evidence_items` / `evidence_relationships`, ATT&CK mappings, attack-story entries). Analyst/provider/rule edges with full provenance live in `investigation_graph_edges` — presentation never invents unsupported relationships.

Every edge exposes `confidence` (0–100 or null when unknown), `provenance` (`provider` | `analyst` | `rule`), `source`, optional observed time range, and `creatorId`.

Authorisation uses case compartments: `authorizeCase` + `resolveTokenActor`. Restricted/sensitive nodes are **omitted** entirely (no count, topology, label, or export leak).

Scopes: `cases:read` for graph/export; `cases:write` for creating/removing stored edges. Export additionally requires compartment permission `export`.

Node types: `case`, `alert`, `identity`, `device`, `mailbox`, `file`, `process`, `ip`, `domain`, `url`, `cloud_resource`, `evidence`, `technique`, `email_message`, `application`, `tenant`, `network`, `asset`, `other`.

Edge types: `observed_on`, `communicated_with`, `executed`, `downloaded`, `sent_by`, `received_by`, `authenticated_to`, `resolved_to`, `parent_process`, `triggered_alert`, `belongs_to_case`, `related_to`, `derived_from`, `duplicate_of`, `maps_to_technique`.

### `GET /api/v1/cases/{id}/graph`
Query:

| Param | Meaning |
| --- | --- |
| `nodeTypes` | Comma-separated node types to keep |
| `minConfidence` | Hide edges with known confidence below this (0–100). Null-confidence structural edges still show |
| `view` | `graph` (default), `story`, `tactic_lanes`, `evidence` |
| `nodeLimit` | Progressive node cap (default 200, max 500) |
| `edgeLimit` | Progressive edge cap (default 500, max 2000) |

Returns `{ caseId, view, nodes, edges, story, tacticLanes, limits, counts, filters, generatedAt }`.

- `story` is ordered by explicit `sequenceIndex` only; entries with missing or out-of-order `occurredAt` set `timingAmbiguous` + `timingNote` (clock/source ambiguity is visible; order never claims timestamp causality).
- `tacticLanes` groups mapped techniques by ATT&CK tactic id.
- `view=evidence` keeps evidence nodes and evidence–evidence edges (plus case anchor when not filtered out).
- `counts` reflect only access-visible nodes/edges after filters.

### `POST /api/v1/cases/{id}/graph`
Create a stored provenanced edge (both endpoints must already exist on the case):
```json
{
  "sourceNodeType": "ip",
  "sourceNodeId": "ent_…",
  "targetNodeType": "domain",
  "targetNodeId": "ent_…",
  "edgeType": "resolved_to",
  "confidence": 75,
  "provenance": "analyst",
  "source": "manual_investigation",
  "observedAtStart": "2026-07-01T10:06:00.000Z",
  "observedAtEnd": null,
  "reason": "PTR and passive DNS agree"
}
```
`provenance: "rule"` requires `ruleId`. Returns `201 { "edge": { … } }`. Duplicate unique edges return `409`.

### `DELETE /api/v1/cases/{id}/graph/edges/{edgeId}`
Removes a **stored** edge only (derived edges cannot be deleted). Returns `{ "ok": true }`.

### `GET /api/v1/cases/{id}/graph/export`
Requires compartment `export`. Query: `format=json|text` (default `json`), plus the same filter params as the graph GET.

- `format=json` → `{ "snapshot": { …graph… }, "text": "…" }`
- `format=text` → `text/plain` attachment with the textual relationship list (provenance, confidence, observed range)

### Optional D3FEND countermeasure mappings

### `GET /api/v1/attack/d3fend-mappings?playbookId=&responseActionId=`
### `POST /api/v1/attack/d3fend-mappings`
```json
{
  "d3fendTechniqueId": "D3-NTA",
  "d3fendTechniqueName": "Network Traffic Analysis",
  "attackTechniqueIds": ["T1071"],
  "playbookId": "pb_...",
  "notes": "Detect C2 beaconing during containment"
}
```
Every mapping records `catalogVersion` (defaults to the bundled D3FEND baseline version) and must link to a playbook and/or a response action — entirely optional and administrator/analyst curated; Kelpie never infers a countermeasure link itself.

### `DELETE /api/v1/attack/d3fend-mappings?id=`

## Audit trail

An organisation-wide, append-only log of who did what, when — every mutation across auth, team, settings, integrations, tokens, cases, tasks, observables, evidence, tags, fields, and jobs is recorded. `audit_events` rows can never be updated, and can never be deleted except by the organisation's own retention purge job — this is enforced by a database trigger, not just application code, so it holds even for admin routes. Sensitive fields (passwords, secrets, API keys, tokens, HMACs, and message/comment body content) are redacted to `"[redacted]"` before a row is ever written, and `before`/`after` snapshots only ever contain the specific keys that changed, never a whole request or response body. Both endpoints below require the `audit:read` scope.

### `GET /api/v1/audit-events`

Optional query: `action`, `actorId`, `targetType`, `targetId`, `from`, `to` (ISO 8601 timestamps, inclusive range over `occurredAt`), `q` (free-text match over action, target type/id/label, and actor label), `limit` (default 50, maximum 200), and `cursor` (opaque keyset pagination cursor from a previous response's `nextCursor`). Results are ordered most-recent-first (`occurredAt` descending, `id` descending as a tie-breaker), so pages stay stable under concurrent inserts.

```json
{
  "events": [
    {
      "id": "audit_8k2n4qz",
      "action": "case.updated",
      "targetType": "case",
      "targetId": "case_3ecfe70",
      "targetLabel": "KP-2026-0041",
      "actorId": "user_9f2c1e",
      "actorType": "user",
      "actorLabel": "sam.analyst",
      "requestId": "req_a1b2c3",
      "sourceIp": "203.0.113.9",
      "userAgent": "Mozilla/5.0 ...",
      "before": { "status": "open" },
      "after": { "status": "contained" },
      "metadata": {},
      "occurredAt": "2026-07-28T02:14:00Z"
    }
  ],
  "nextCursor": "MjAyNi0wNy0yOFQwMjoxNDowMFp8YXVkaXRfOGsybjRxeg"
}
```

`nextCursor` is `null` once the last page has been reached. Pass it back as `?cursor=` to fetch the next page with the same other filters.

### `GET /api/v1/audit-events/{id}`

Returns the full audit event, including the (already-redacted) `before`, `after`, and `metadata` payloads:

```json
{ "event": { "id": "audit_8k2n4qz", "action": "case.updated", "...": "..." } }
```

Returns `404` if the event does not exist in the caller's organisation — this includes an id that belongs to a different organisation, which never leaks whether the id exists elsewhere.

### Exports and retention

CSV/NDJSON exports of the audit trail are requested from the admin console at **Settings → Audit** (`/settings/audit`), not a v1 API endpoint. Every export always applies the exact same filters and permissions as the equivalent search — an export can never surface an event that the matching search call wouldn't have returned. Exports expire and are removed automatically after 7 days. Retention is configurable per organisation (**Settings → Audit**) down to a safe minimum of 90 days; a daily job purges events older than the configured window.

## Threat intelligence

### `GET /api/v1/threat-intelligence`

Returns matching indicators plus feed state. Optional query: `value`, `exact`,
`type`, `feedId`, `tag`, and `limit` (maximum 500).

`type` must be one of `ip`, `url`, `file_hash`, `domain` — Kelpie threat
intelligence covers actionable network and file indicators only. CVE and
vulnerability data are out of scope; an unsupported `type` value returns
`400` with the supported list. Feed state includes each feed's last-run
ingested/skipped counts and a skip-reason breakdown (`cidr`, `cve`, `email`,
`unrecognised`, `invalid_value`) so unsupported records are visible rather
than silently dropped.

## Threat landscape

### `GET /api/v1/threat-landscape`

Returns Cloudflare Radar configuration state, update time, confidence, rolling
window, ranked origin/target locations, top attack routes, provider annotations,
partial-enrichment warnings, and percentage breakdowns for mitigation products,
HTTP methods and versions, IP versions, targeted sectors, and managed-rule
signals. Requires `CLOUDFLARE_RADAR_API_TOKEN` on the Kelpie app container.

## Cyber brief

### `GET /api/v1/briefing`

Returns public cyber reporting with watched-vendor matches. Optional query:
`q`, `source`, `vendor` (catalog slug or `watched`), `sort` (`newest`,
`oldest`, `source`), `page`, and `pageSize` (maximum 100).

## Model Context Protocol

Kelpie exposes the same machine data over stateless Streamable HTTP:

```text
POST https://your-kelpie.example/api/mcp
Authorization: Bearer klp_yourtoken
Accept: application/json, text/event-stream
Content-Type: application/json
```

**Administrators should onboard agents from Settings → MCP agent setup** rather
than assembling endpoint, scopes, client config, and instructions by hand. That
UI derives the public endpoint from the configured `APP_URL`, issues a
least-privilege token (secret shown once), and copies connection details,
client configuration, an `AGENTS.md` block, and the canonical `LLM.txt` prompt.
Tool-to-scope mappings in Settings are generated from the same catalogue the
MCP route serves (`src/lib/mcp/catalogue.ts`) so documentation cannot drift.

Configure an MCP client with the endpoint above and a Kelpie API token carrying
one or more machine-data scopes. Available tools (canonical catalogue):

- `search_threat_intelligence` — `threat_intelligence:read`
- `get_threat_landscape` — `threat_landscape:read`
- `get_cyber_briefing` — `briefing:read`
- `list_watched_vendors` — `briefing:read`
- `case_relationships_list` — `case_relationships:read`
- `case_relationship_suggestions_list` — `case_relationships:read`
- `evidence_list` — `evidence:read`
- `evidence_custody_list` — `evidence:read`
- `playbooks_list` — `playbooks:read`
- `playbooks_get` — `playbooks:read`
- `attack_techniques_search` — `attack:read`
- `attack_mappings_list` — `attack:read`
- `attack_coverage_get` — `attack:read`
- `attack_technique_attach` — `attack:write`

Every tool except `attack_technique_attach` is read-only (see each tool's
`readOnlyHint` in `tools/list`). Tool discovery only returns tools permitted by
the token's scopes. `playbooks_list`/`playbooks_get` are the recommended way for
an agent to discover Kelpie's playbook catalogue; see `/LLM.txt` in the
repository root (also copyable from Settings → MCP agent setup and Guides) for
a full agent prompt, and `docs/playbooks.md` for the catalogue's structure and a
worked example.

## Comments

### `GET /api/v1/cases/{caseId}/comments`
### `POST /api/v1/cases/{caseId}/comments`
```json
{ "body": "VT result: malicious=12, suspicious=3. @sam.analyst please review" }
```
`@handle` mentions trigger the same email path as the UI.

### `POST /api/v1/cases/{caseId}/comments/{commentId}/promote`
Promote a comment into a structured content block (`content_blocks:write`). Preserves the original author, original timestamp, source comment id, and promoting actor.

```json
{
  "type": "investigation_note",
  "title": "Field observation"
}
```
Returns `201 { "block": { ... } }`. A second promotion of the same comment returns `409`.

## Content blocks (investigation narrative)

Ordered, versioned case content blocks for findings, decisions, and report sections. Separate from conversational comments. Body is sanitised Markdown (no active HTML). Revisions are append-only; restoring an earlier revision creates a new head rather than deleting later history. Reordering writes **one** timeline event for the whole operation.

Block types: `investigation_note`, `finding`, `hypothesis`, `decision`, `evidence_summary`, `containment_record`, `eradication_record`, `recovery_validation`, `stakeholder_update`, `code_query`, `table`, `checklist`, `external_reference`, `report_section`.

Link types (organisation- and case-authorised on write): `alert`, `entity`, `evidence_item`, `task`, `attack_technique`, `attack_mapping`.

Sensitive blocks default to `includeInReport: false` (conservative export). Reports include non-archived blocks with `includeInReport: true` and `sensitive: false`.

### `GET /api/v1/cases/{caseId}/content-blocks`
Optional query: `includeArchived=true`. Returns `{ "blocks": [...] }` ordered by `sequenceIndex`. Each block embeds `links` and head `revisionNumber`.

### `POST /api/v1/cases/{caseId}/content-blocks`
```json
{
  "type": "finding",
  "title": "Initial foothold",
  "content": "Attacker used **valid accounts**.",
  "tlp": "amber",
  "pap": "amber",
  "sensitive": false,
  "includeInReport": true
}
```
Returns `201 { "block": { ... } }`.

### `GET /api/v1/cases/{caseId}/content-blocks/{blockId}`
### `PATCH /api/v1/cases/{caseId}/content-blocks/{blockId}`
Any subset of content fields, or one of the special actions:

| Field | Effect |
| --- | --- |
| (content fields) | Appends a new revision and updates the head |
| `targetIndex` | Reorders this block among active blocks (one timeline event) |
| `archive: true` | Soft-archives the block |
| `restoreRevision: N` | Restores revision N as a new head revision |

### `DELETE /api/v1/cases/{caseId}/content-blocks/{blockId}`
Soft-archives the block (same as `PATCH` with `archive: true`).

### `GET /api/v1/cases/{caseId}/content-blocks/{blockId}/revisions`
Append-only revision list ordered by `revisionNumber`.

### `POST /api/v1/cases/{caseId}/content-blocks/{blockId}/links`
```json
{ "linkType": "task", "targetId": "task_..." }
```
Returns `201 { "link": { ... } }`. Cross-organisation or wrong-case targets return `404`.

### `DELETE /api/v1/cases/{caseId}/content-blocks/{blockId}/links/{linkId}`

## Controlled case reports (templates + exports)

Reusable, versioned report templates with audience ceilings (TLP/PAP), redaction preview, BullMQ PDF/JSON generation, SHA-256 stamps, optional release approval, and scheduled generation into organisation export history. Files are organisation-scoped via the evidence storage abstraction. Unsafe Markdown/HTML is sanitised; redaction preview never reveals hidden content.

Variants: `executive`, `technical`, `regulatory`, `post_incident`.

Section keys: `summary`, `metadata`, `tasks`, `observables`, `timeline`, `comments`, `evidence_inventory`, `ttp_mappings`, `attack_story`, `related_cases`, `custom_fields`, `investigation_blocks`, `post_incident_review`, `closure`.

Baseline templates (seeded per organisation, idempotent by `catalogueKey`): executive summary, technical incident report, post-incident review, regulatory export.

### `GET /api/v1/report-templates`
Optional `includeInactive=true`. Seeds missing baseline templates, then lists active templates with current version sections and inclusion rules. Scope: `reports:read`.

### `POST /api/v1/report-templates`
Create a custom template (version 1). Scope: `reports:admin`.

### `GET /api/v1/report-templates/{id}`
Optional `?version=N` to read a historical version. Includes version history list. Scope: `reports:read`.

### `PATCH /api/v1/report-templates/{id}`
Metadata updates in place; changes to sections/rules/ceilings/approval insert a new immutable version. Scope: `reports:admin`.

### `POST /api/v1/cases/{caseId}/reports/preview`
```json
{
  "templateId": "rpt_...",
  "format": "pdf",
  "sectionOverrides": { "comments": true, "observables": false }
}
```
Returns selected sections, data revision, content fingerprint, redaction summary (included/excluded/masked — no hidden raw values), and a Markdown preview. Scope: `reports:read`.

### `POST /api/v1/cases/{caseId}/reports`
```json
{
  "templateId": "rpt_...",
  "format": "json",
  "processInline": false
}
```
Creates an export (`pending` → BullMQ `generate-case-report`). When `requireApproval` on the template version is true, status becomes `awaiting_approval` after render; otherwise `completed`. Set `processInline: true` only for tests/offline workers. Scope: `reports:write`. Responses never include `storageKey`.

### `GET /api/v1/cases/{caseId}/reports`
Export history for the case. Scope: `reports:read`.

### `GET /api/v1/reports/{exportId}`
Export status plus pending approval binding (if any). Scope: `reports:read`.

### `POST /api/v1/reports/{exportId}/approve`
```json
{ "decision": "approve" }
```
or `"reject"`. Re-checks live case data revision against the bound fingerprint; invalidates if data/template binding drifted (`409`). Scope: `reports:admin`. Token must have been issued by a user (`createdBy`).

### `GET /api/v1/reports/{exportId}/download`
Downloads the file when status is `completed` or `released`. Verifies SHA-256. Header `x-kelpie-sha256` echoes the digest. Scope: `reports:read`.

### `POST /api/v1/cases/{caseId}/reports/schedule`
```json
{
  "templateId": "rpt_...",
  "format": "pdf",
  "intervalMinutes": 1440
}
```
Destination is always `{ "kind": "export_history" }` — arbitrary external destinations are out of scope. Worker job `run-report-schedules` re-checks template activity and case membership at execution time. Scope: `reports:write`.

## Post-incident review (lessons learned + knowledge)

Versioned post-incident review templates and case reviews with immutable revisions, approval that binds an exact revision fingerprint, follow-up actions (separate from incident-response `case_tasks`), knowledge article stubs, and playbook/detection improvement proposals.

Operational case closure and review completion are independent: a case may close while a required review stays `draft` / `in_progress` / `pending_approval`. Org policy (severity / classification / require-all) and per-template required severities/classifications determine whether a review is required.

Knowledge summaries exclude `sensitiveEvidenceNotes` and `restrictedNotes` by default. Including sensitive content requires case compartment `view_sensitive` (via `authorizeCase`) and an explicit `includeSensitive: true` opt-in.

Scopes: `reviews:read`, `reviews:write`, `reviews:admin` (sensitive).

### `GET /api/v1/review-policy` / `PUT /api/v1/review-policy`
Read or replace organisation policy (`enabled`, `requireBySeverities`, `requireByClassifications`, `requireForAllCases`, `dueDaysAfterClose`). PUT requires `reviews:admin`.

### `GET /api/v1/review-templates` / `POST /api/v1/review-templates`
List (seeds baseline) or create templates. POST requires `reviews:admin`.

### `GET /api/v1/review-templates/{id}` / `PATCH /api/v1/review-templates/{id}`
Read or update. Section / approval changes insert a new immutable template version.

### `GET /api/v1/cases/{caseId}/reviews` / `POST /api/v1/cases/{caseId}/reviews`
List or create a review for a case. Create stamps `requiredByPolicy` + `dueAt` from policy evaluation. Scope: `reviews:read` / `reviews:write`.

### `GET /api/v1/reviews` / `GET /api/v1/reviews/{id}`
Org-wide list (`?status=&overdue=true&limit=`) or single review with current/approved revision metadata.

### `PATCH /api/v1/reviews/{id}`
```json
{ "content": { "incidentSummary": "…", "knowledgeSummary": "…", "sensitiveEvidenceNotes": "…" } }
```
Saves content. If the current revision is approved (or review is approved/published/pending_approval), creates a **new unapproved revision** and moves status to `in_progress`.

### `POST /api/v1/reviews/{id}/submit`
Moves review to `pending_approval`. Scope: `reviews:write`.

### `POST /api/v1/reviews/{id}/approve`
```json
{ "decision": "approved", "notes": "optional" }
```
or `"rejected"`. Approval binds `revision.id` + `contentFingerprint` on the revision row. Scope: `reviews:admin`.

### `GET /api/v1/reviews/{id}/revisions`
Immutable revision history including bound fingerprints and approval metadata.

### `GET|POST /api/v1/reviews/{id}/follow-ups` / `PATCH /api/v1/follow-ups/{id}`
Follow-up actions with owner, due date, theme, optional external ticket ref. Lifecycle is independent of `case_tasks`.

### `POST /api/v1/reviews/{id}/knowledge`
Publish a knowledge article stub from the approved (or current) revision. Default redacts sensitive fields. Body: `{ "title?", "includeSensitive?", "status?" }`.

### `GET /api/v1/knowledge-articles` / `GET /api/v1/knowledge-articles/{id}`
List or read knowledge articles. Sensitive body fields are stripped when the actor lacks `view_sensitive`.

### `GET|POST /api/v1/reviews/{id}/improvements` / `PATCH /api/v1/improvements/{id}`
Playbook revision / detection improvement / control gap proposals linked back to the source review and case. External tickets are references only — Kelpie audit history remains authoritative.

### `GET /api/v1/reviews/reporting`
Summary: overdue reviews, open required reviews, reviews still open after case close, overdue/open follow-ups, recurring themes, improvement counts by kind.

## Stakeholder portal (external collaborators)

Restricted, case-scoped portal for IT owners, vendors, legal, HR, and customers (issue #63). External parties are **not** organisation members and do **not** use BetterAuth staff sessions.

### Staff API (bearer API token)

#### `GET /api/v1/cases/{caseId}/stakeholder-invites`
List invitations for a case. Scope: `cases:read`. Requires case `view_metadata` (compartment-aware); missing/forbidden cases return the same `404` shape.

#### `POST /api/v1/cases/{caseId}/stakeholder-invites`
```json
{
  "email": "vendor@example.com",
  "displayName": "Vendor SOC",
  "role": "evidence_provider",
  "purpose": "Upload firewall logs for KP-2026-0042",
  "maxTlp": "amber",
  "maxPap": "amber",
  "expiresInHours": 72,
  "singleUse": true
}
```
Roles: `update_reader` | `evidence_provider` | `respondent` | `approver`.

Returns `201` with `{ "id", "token", "expiresAt", "role", "status" }`. The plaintext `token` (prefix `kstk_`) is shown **once**; only a SHA-256 hash is stored.

Sharing is denied (`403`) when:
- the inviter lacks case **export** permission (compartment / restricted visibility), or
- case TLP/PAP exceeds the invitation ceiling.

Scope: `cases:write`.

#### `GET /api/v1/cases/{caseId}/stakeholder-invites/{inviteId}`
Analyst **preview** of the exact redacted external view. Scope: `cases:read`. Path `caseId` must match the invitation’s case; mismatch → `404`.

#### `DELETE /api/v1/cases/{caseId}/stakeholder-invites/{inviteId}`
Revoke invitation; optional body `{ "reason": "..." }`. Requires case `edit`. Path `caseId` must match the invitation’s case (prevents cross-case revoke by id). Immediately revokes all active external sessions for that invite. Scope: `cases:write`.

### External portal API (not BetterAuth)

External sessions use token prefix `ksts_` via `Authorization: Bearer` or the `kelpie_stakeholder_session` cookie. These tokens never grant staff access.

Session cookie is dual-path (`Path=/portal` and `Path=/api/portal`) so it covers the portal UI and portal APIs without a site-wide `Path=/` scope. Prefer `Authorization: Bearer` for API calls.

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/portal/accept` | Exchange invite token → session (`{ "token": "kstk_..." }`). Response: `{ ok, role, expiresAt, sessionToken }` — no raw case UUID |
| `GET` | `/api/portal/me` | Redacted case portal view (no org/member enumeration) |
| `POST` | `/api/portal/responses` | Post external response (`respondent`) |
| `POST` | `/api/portal/updates/{updateId}/read` | Read receipt |
| `POST` | `/api/portal/evidence-requests/{id}/upload` | Multipart file upload (`evidence_provider`) — same quarantine/custody pipeline as #44 |
| `POST` | `/api/portal/approvals/{id}` | `{ "decision": "approved" \| "rejected", "note"? }` |
| `POST` | `/api/portal/logout` | Revoke current session |

UI entry: `/portal?token=kstk_...` (email bootstrap only). **Security note:** query-string invite secrets can leak via Referer, proxy logs, and browser history. The UI POSTs the token to `/api/portal/accept` then strips `token` from the URL via `history.replaceState`. Prefer delivering links over channels that support fragment or one-time POST where possible; do not put invite secrets in staff-facing analytics.

Invalid, expired, revoked, and replayed tokens all return the same `401`. Single-use accepts claim the invite with an atomic `UPDATE … WHERE status = 'pending' RETURNING` before minting a session. Wrong object IDs return `404` (no existence oracle). When case classification exceeds the invite ceiling, external view redacts title, severity, and **status**. External contributions are attributed as `source: "external"` on the case timeline and in reports.

## Webhooks (outbound)

Configure under **Settings → Outbound webhooks**. Each delivery is signed:

```
X-Kelpie-Event: case.status_changed
X-Kelpie-Signature: sha256=<hex-hmac>
X-Kelpie-Delivery: wd_...
Content-Type: application/json

{ "event": "case.status_changed", "payload": { "case_id": "case_...", "to": "contained" } }
```

Verify in your receiver:

```js
const sig = req.headers["x-kelpie-signature"];
const expected = "sha256=" + crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) reject();
```

Retries: 1m, 5m, 30m, 2h, then `failed`. The last 50 deliveries per webhook are retained.

## Cron endpoints

The breach checker, webhook delivery, and enrichment runners are simple HTTP endpoints protected by `CRON_SECRET`:

```
POST /api/cron/sla
POST /api/cron/webhooks
POST /api/cron/enrichment
POST /api/cron/ti
POST /api/cron/case-sources
POST /api/cron/mobile-push
Authorization: Bearer ${CRON_SECRET}
```

A separate scheduler (Docker Compose sidecar, cron, k8s CronJob) hits each once per minute.

## Native mobile session

The iOS companion signs in against the same BetterAuth account and receives a 30-day, role-scoped bearer token. Tokens for `read_only` users contain read scopes only.

### `POST /api/mobile/auth/sign-in`
```json
{ "email": "analyst@example.com", "password": "..." }
```
Returns `token`, `expiresAt`, `scopes`, and the user/organisation summary. Accounts requiring SSO, MFA, onboarding, or a password reset return a specific `403` error so the app can direct the user to the web console.

### `GET /api/mobile/auth/me`
Validates the current mobile bearer token and returns its user and scopes.

### `POST /api/mobile/auth/sign-out`
Revokes the current mobile bearer token.

### `POST /api/mobile/devices`
```json
{ "token": "<APNs token as hex>", "environment": "sandbox" }
```
Uploads the current APNs token. The app sends this on every APNs registration callback because device tokens can change.

### `DELETE /api/mobile/devices`
```json
{ "token": "<APNs token as hex>" }
```
Disassociates the device during sign out.

The push outbox routes `sla_breach` and `comment_mention` events. Configure `APNS_TEAM_ID`, `APNS_KEY_ID`, `APNS_PRIVATE_KEY`, and the server-controlled `APNS_BUNDLE_ID`; the authenticated `/api/cron/mobile-push` worker delivers pending messages over APNs HTTP/2 and deactivates tokens rejected with HTTP 410.

## Asset & identity context

Organisation-scoped business context for assets, identities, applications, and business services. Used by explainable case priority scoring (separate from source severity). Provider updates never overwrite analyst override fields.

### `GET /api/v1/asset-contexts`
Optional query: `kind`, `criticalOnly=true`, `crownJewelOnly=true`, `limit`.

### `POST /api/v1/asset-contexts`
Upsert a context record (REST provider). Body includes `kind`, `displayName`, `primaryIdentifierKind`, `primaryIdentifierValue`, and optional criticality / privilege / exposure fields. Returns `201` when created, `200` when updated. Ambiguous entity matches return `matchReviewId` instead of auto-linking.

### `GET /api/v1/asset-contexts/{id}`

### `PATCH /api/v1/asset-contexts/{id}/overrides`
Set or clear analyst overrides (`criticalityOverride`, `privilegeLevelOverride`, `exposureOverride`, `isCrownJewelOverride`, `recoveryPriorityOverride`). Pass `null` to clear an override.

### `POST /api/v1/asset-contexts/import`
CSV dry-run/import and provider batch import:

```json
{ "source": "csv", "dryRun": true, "csvText": "kind,display_name,..." }
```

```json
{ "source": "entra", "dryRun": false, "users": [{ "id": "...", "userPrincipalName": "a@b.com", "displayName": "A" }] }
```

```json
{ "source": "defender", "dryRun": false, "devices": [{ "id": "...", "deviceName": "wkstn-01" }] }
```

```json
{ "source": "cmdb", "dryRun": true, "records": [{ "externalId": "1", "kind": "asset", "displayName": "db1", "identifierKind": "hostname", "identifierValue": "db1" }] }
```

CSV required columns: `kind`, `display_name`, `identifier_kind`, `identifier_value`. Optional: `criticality`, `privilege_level`, `exposure`, `environment`, `is_crown_jewel`, `recovery_priority`, `owner_team`, `owner_email`, `business_service`, `application_name`, `data_classifications`, `regulatory_scope`, `external_id`.

### `GET /api/v1/asset-contexts/match-reviews`
Pending ambiguous entity matches.

### `POST /api/v1/asset-contexts/match-reviews`
```json
{ "reviewId": "mrev_...", "action": "link", "entityId": "ent_..." }
```
or `{ "reviewId": "mrev_...", "action": "dismiss" }`.

### `GET /api/v1/cases/{id}/priority`
Explainable priority score with factors, weights, calculation version, and linked critical contexts. Also accepts `cases:read`.

### `POST /api/v1/cases/{id}/priority?recalculate=true`
Recalculate. Analyst score overrides are preserved.

### `POST /api/v1/cases/{id}/priority`
```json
{ "score": 90, "reason": "Crown jewel + active exfil" }
```
Pass `"score": null` to clear the override.

### `GET /api/v1/priority-scoring` / `PATCH /api/v1/priority-scoring`
Organisation scoring settings: `enabled`, bounded `weights`, `staleContextPolicy` (`discount` | `exclude` | `include`), `staleAfterHours`.

## Saved case views

Named, shareable case-list configurations (filters, sort, columns, page size, optional SLA/workload widgets, bulk-action *shapes*). Visibility is `personal`, `team`, or `organisation`. Queries, counts, and widgets are always organisation-scoped; counts use complete aggregates, not the current page. Bulk presets never store case IDs, never auto-execute, and never skip confirmation or permissions.

### `GET /api/v1/case-views`
List views the token's creator can access. Requires `case_views:read`.

### `POST /api/v1/case-views`
```json
{
  "name": "Critical open queue",
  "description": "High urgency triage",
  "visibility": "personal",
  "config": {
    "status": "open",
    "severity": "critical",
    "sort": "priority",
    "pageSize": 25,
    "columns": ["number", "title", "severity", "sla", "assignee"],
    "widgets": ["sla_summary", "workload_summary"],
    "bulkPresets": [
      {
        "id": "mark-high",
        "name": "Mark high",
        "operationType": "set_severity",
        "params": { "severity": "high" }
      }
    ]
  }
}
```
`visibility: "team"` requires `teamId`. Organisation views must be created by an admin **session** (API tokens are limited to personal/team). Unknown filter/widget/action fields return `400`. Requires `case_views:write`.

### `GET /api/v1/case-views/{id}`
### `PATCH /api/v1/case-views/{id}`
### `DELETE /api/v1/case-views/{id}`
### `POST /api/v1/case-views/{id}/duplicate`
Optional body: `{ "name", "visibility", "teamId" }`. Defaults to a personal copy.

### `GET /api/v1/case-views/{id}/count`
Complete inbox-style count: `{ "count": { "total", "active", "critical", "high" } }`.

### `GET /api/v1/case-views/{id}/widgets`
Bounded widgets configured on the view (`severity_breakdown`, `status_breakdown`, `sla_summary`, `workload_summary`), computed from the same full filter query.

### `POST /api/v1/case-views/{id}/presets/preview`
```json
{ "presetId": "mark-high", "caseIds": ["case_…"] }
```
Re-resolves targets to the token's organisation and returns impact preview. Does not execute.

### `GET /api/v1/case-views/defaults` / `PUT /api/v1/case-views/defaults`
Personal default only via API tokens. Body: `{ "scope": "personal", "viewId": "cview_…" | null }`. Role/team defaults require an admin session.

**Empty scopes grant nothing.** A token whose `scopes` array is empty fails every scope check (`403`). Sensitive scopes (`alerts:raw_payload:read`, `evidence:override`, `audit:read`) are never implied. Migration `0026_empty_token_scopes` rewrites any pre-existing empty-scope tokens to an explicit non-sensitive set so ordinary integrations keep working without retaining those sensitive powers — re-issue tokens that intentionally need sensitive scopes from Settings after upgrading.

## Scopes

| Scope | Allows |
| --- | --- |
| `cases:read` / `cases:write` | Read or create/update cases |
| `tasks:read` / `tasks:write` | Read or create/update tasks |
| `observables:read` / `observables:write` | Search or add observables |
| `comments:read` / `comments:write` | Read or post comments |
| `threat_intelligence:read` | Search TI indicators and inspect feed state |
| `threat_landscape:read` | Read current Cloudflare Radar Threat landscape data |
| `briefing:read` | Read Cyber brief, watched vendors, and vendor matches |
| `case_relationships:read` | Read case relationships and duplicate/related suggestions |
| `case_relationships:write` | Link, unlink, and dismiss case relationships |
| `playbooks:read` | Read the playbook catalogue (baseline and custom) |
| `audit:read` | Search the organisation audit trail and read individual audit event detail (sensitive; only grant to admin-issued tokens) |
| `alerts:read` | Read alerts, linked entities, and evidence items |
| `alerts:write` | Create/link alerts, change alert disposition, link entities, and create/update evidence items |
| `alerts:raw_payload:read` | Read raw provider payload references behind alerts and evidence (sensitive; only grant to admin-issued tokens) |
| `attack:read` | Read the ATT&CK technique catalog, technique mappings, attack stories, and coverage |
| `attack:write` | Attach, update, and remove ATT&CK technique mappings and attack-story entries |
| `integrations:read` | Read integration health, open sync conflicts, and support-safe diagnostics |
| `integrations:write` | Pause/resume connections, run connection tests, resolve sync conflicts, toggle outbound writes |
| `case_views:read` | Read saved case views, complete counts, widgets, and bulk-preset previews |
| `case_views:write` | Create, update, delete, duplicate, and set personal defaults for saved case views |
| `investigation:read` | List investigation console commands, execution history, and results |
| `investigation:execute` | Execute registered investigation commands, cancel runs, approve/reject writes, and save results as evidence |

**Empty scopes grant nothing.** A token whose `scopes` array is empty fails every scope check (`403`). Sensitive scopes (`alerts:raw_payload:read`, `evidence:override`, `audit:read`) are never implied. Migration `0026_empty_token_scopes` rewrites any pre-existing empty-scope tokens to an explicit non-sensitive set so ordinary integrations keep working without retaining those sensitive powers — re-issue tokens that intentionally need sensitive scopes from Settings after upgrading.

## Investigation console

Governed analyst investigation queries and connector commands (issue #62). Only trusted, code-registered handlers may run. Arbitrary shell, user scripts, executable code, and free-form destination URLs are prohibited. Parameters are schema-validated server-side. Results are redacted, size-bounded, and tenant-scoped. Write-class commands require dual-control approval (a different user must approve).

Registered handlers (initial set):

| Command | Class | Notes |
| --- | --- | --- |
| `kelpie.previous_cases` | read | Previous org cases sharing an observable value |
| `virustotal.report` | read | VirusTotal summary (mock when unconfigured); fixed VT API paths only |
| `kelpie.flag_entity_reviewed` | write | Append entity review note; requires approval |

### `GET /api/v1/investigation/commands`
List registered command descriptors (name, version, parameters, scopes, limits, approval). Scope: `investigation:read`.

### `GET /api/v1/investigation/executions`
History. Query: `caseId`, `commandName`, `limit`. When `caseId` is set, case compartment access is required. Scope: `investigation:read`.

### `POST /api/v1/investigation/executions`
```json
{
  "commandName": "kelpie.previous_cases",
  "params": { "value": "203.0.113.10", "type": "ip", "limit": 10 },
  "caseId": "case_...",
  "entityId": "ent_...",
  "idempotencyKey": "optional-client-key"
}
```
Executes a registered command in case/entity/evidence/alert context. Read commands run immediately; write commands enter `awaiting_approval`. Scope: `investigation:execute` plus each handler's `requiredScopes`. Case context uses `authorizeCase(..., "edit")`.

### `GET /api/v1/investigation/executions/{id}`
Optional `?includeResult=1` for full stored result payload. Scope: `investigation:read`.

### `POST /api/v1/investigation/executions/{id}/cancel`
Cancel queued/awaiting approval, or best-effort cancel a running execution. Scope: `investigation:execute`.

### `POST /api/v1/investigation/executions/{id}/approve`
Approve a write-class execution (approver must differ from requester). Scope: `investigation:execute`.

### `POST /api/v1/investigation/executions/{id}/reject`
```json
{ "reason": "Not needed" }
```
Scope: `investigation:execute`.

### `POST /api/v1/investigation/executions/{id}/save-evidence`
```json
{ "caseId": "case_..." }
```
Saves the result as case evidence, preserving command name/version, redacted params, provider request id, timestamps, and SHA-256. Scopes: `investigation:execute` and `evidence:write`.

### `POST /api/v1/investigation/executions/{id}/links`
```json
{ "entityIds": ["ent_..."], "alertIds": ["alert_..."] }
```
Link result to org-scoped entities/alerts. Scope: `investigation:execute`.


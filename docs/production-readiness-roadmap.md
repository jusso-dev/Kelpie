# Production-readiness roadmap

Kelpie's target is a self-hosted, case-first SOC workspace for small teams:
strong incident governance, useful Microsoft-first integrations, and bounded
automation without a general-purpose SOAR canvas.

## Product bar

Market leaders establish four expectations:

- [Microsoft Defender XDR incident management](https://learn.microsoft.com/en-us/defender-xdr/manage-incidents)
  combines alerts, evidence, ownership, classification, history, containment,
  and post-incident export.
- [Microsoft Sentinel automation rules](https://learn.microsoft.com/en-us/azure/sentinel/automate-incident-handling-with-automation-rules)
  use event triggers, conditions, ordered actions, tasks, routing, and playbooks.
- [Cortex XSOAR incident management](https://docs-cortex.paloaltonetworks.com/r/Cortex-XSOAR/8/Cortex-XSOAR-Administrator-Guide/Incident-Management)
  keeps investigation actions, evidence, tasks, collaboration, and automation
  in one auditable incident workspace.
- [Tines Cases](https://www.tines.com/docs/cases/) links automation to case
  creation and case actions while retaining human ownership and closure policy.

Kelpie should not compete on connector count or canvas complexity. It should win
on deployment simplicity, local data control, analyst speed, TLP/PAP-aware
evidence, and explicit human approval for high-impact response.

## P0: production foundation

### Governed response

- Make every high-impact action a durable request with immutable target,
  requester, reason, policy snapshot, approval, provider response, and timeline.
- Require a different administrator to approve destructive actions. Expire
  approvals and re-check the case, target, connection, and action state before
  execution.
- Add idempotency keys, queued execution, retry lineage, provider action IDs,
  asynchronous status polling, and a global action kill switch.
- Keep read and write Microsoft connections separate. Write permissions remain
  disabled until an administrator explicitly enables each capability.

### Microsoft security data

- Ingest Defender XDR incidents through Microsoft Graph Security with
  `SecurityIncident.Read.All`.
- Add `alerts_v2` ingestion and normalized alert/evidence records with a unique
  `(organisation, provider, tenant, external ID)` key.
- Use change notifications where Microsoft supports them, backed by overlapping
  polling repair. Track subscription renewal, lifecycle notifications,
  `Retry-After`, and per-tenant rate budgets.
- Preserve raw provider payloads only in encrypted, retention-limited storage.
  Expose normalized evidence to cases.
- Update imported cases when source status or severity changes; do not silently
  overwrite analyst-owned notes or tags.

### Case events and bounded automation

- Emit canonical events from core case mutations so UI, API, imported, and
  agent-created cases behave identically.
- Store automation rules and immutable runs. Start with
  `case.created` and `case.status_changed`, fixed allowlisted conditions, and one
  signed agent-handoff action.
- Provide dry-run, disable, retry, run history, idempotency, and a kill switch.
  Do not add arbitrary code, loops, or a visual graph.
- Add closure requirements for required tasks, evidence disposition, closure
  reason, and analyst conclusion. Overrides require a privileged actor and an
  audited reason.

## P1: analyst operations

- Normalize alerts and evidence separately from cases. Support correlation,
  linking, merge/split, and source update history.
- Add teams, queues, watchers, handoff notes, bulk triage, escalation policy,
  and workload/aging views.
- Add incident relationships across identities, devices, cloud resources,
  messages, alerts, IOCs, and related cases.
- Expand reporting with SLA attainment, reopen rate, automation outcomes,
  approval latency, containment time, and scheduled post-incident reports.
- Add typed connector health, credential references, consented scopes, rotation
  state, and per-connection diagnostics.

## Microsoft response sequence

1. Defender for Endpoint device isolation using an immutable MDE machine ID.
2. Entra account disable plus session revocation using an immutable object ID.
3. Defender indicator block with strict supported-type, TTL, and tenant-limit
   validation.
4. Defender Antivirus scan, investigation package collection, and machine
   action status polling.
5. Optional incident status/classification sync-back under a separate
   `SecurityIncident.ReadWrite.All` connection.

Each action starts as request-only. Provider calls occur only after approval.
Rollback is a new governed action, never an implicit reversal.

## Muster agent-harness contract

Kelpie must not copy Muster's runtime. Muster owns agent definitions, readiness,
tool policy, budgets, approvals, kill switches, execution, and evidence.

Kelpie sends a minimal HMAC-signed `kelpie.agent-trigger.v1` envelope containing:

- event ID, event name, occurrence time, trace ID, and opaque Kelpie org ref;
- case ID/number/version, lifecycle fields, TLP/PAP, tags, and source ref;
- rule ID/revision and an administrator-selected target profile.

It deliberately excludes comments, attachment contents, credentials, raw
provider payloads, and caller-selected Muster organisation or agent IDs.

A thin Muster adapter must:

1. authenticate signature plus key ID;
2. map connector and target profile server-side to a Muster organisation,
   service actor, room, and agent;
3. deduplicate `(connector, event_id)`;
4. create/link an investigation and queue the existing governed agent runtime;
5. treat Kelpie input and agent output as untrusted evidence;
6. send Kelpie writeback only through Muster's existing approved integration
   action outbox.

Until that adapter and service authentication exist, Kelpie rules remain
disabled by default and must not target Muster's internal gateway directly.

## Release gates

- Tenant-isolation tests cover every read, mutation, worker, and retry path.
- Secrets never appear in settings responses, errors, timelines, logs, exports,
  fixtures, or automation payloads.
- Duplicate notifications, equal-timestamp cursors, worker lease collisions,
  retries, and replay cannot create duplicate cases or actions.
- Destructive action requester cannot approve their own request.
- Provider rate limits and timeouts degrade to visible queued/failed states.
- Backup/restore, migration rollback, health probes, worker health, object
  storage retention, and documented disaster recovery are exercised.
- Production E2E covers administrator, analyst, and read-only roles against
  real Postgres/Redis plus mocked Microsoft contracts.

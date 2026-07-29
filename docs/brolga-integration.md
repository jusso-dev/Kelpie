# Kelpie ↔ Brolga integration

Brolga ([jusso-dev/Brolga](https://github.com/jusso-dev/Brolga)) is the planned
central threat-intelligence context engine. Kelpie remains the case-management
surface: it does **not** re-implement MISP, TAXII, AbuseIPDB denylists, or STIX
bulk ingest once Brolga owns those pipelines.

This document is the **consumer contract** Kelpie implements today so Brolga can
ship without a surprise rewrite of Kelpie.

## Responsibility split

| Concern | Owner |
| --- | --- |
| Case observables, TLP, IOC flags, case linkage | Kelpie |
| Enrichment display on a case | Kelpie |
| MISP / TAXII / STIX / feed connectors | Brolga (v0.6+) |
| Canonical graph, dedup, confidence | Brolga (v0.3–v0.4) |
| Compact context packs for a subject | Brolga (v0.4–v0.5) |
| HTTP / MCP API for packs | Brolga (v0.5) |

## Configuration (Kelpie)

**Organisation settings** (`organisations.settings` jsonb):

| Key | Meaning |
| --- | --- |
| `brolga_base_url` | Origin only, e.g. `https://brolga.homelab` |
| `brolga_api_token` | Bearer token (optional until Brolga auth) |
| `brolga_enabled` | `true` to call Brolga during enrichment |
| `brolga_timeout_ms` | 1000–30000, default 8000 |

**Environment fallbacks** (single-tenant compose):

```dotenv
BROLGA_BASE_URL=https://brolga.homelab
BROLGA_API_TOKEN=
BROLGA_ENABLED=true
# Homelab private RFC1918 needs:
KELPIE_ALLOW_PRIVATE_NETWORKS=true
```

UI: **Settings → Integrations → Observable enrichment → Brolga**.

## Planned HTTP API (Brolga v0.5)

Kelpie client code assumes:

### Health

```http
GET /v1/health
Authorization: Bearer <token>   # if configured
```

`2xx` → ready. `404`/`501` → host up but API not shipped yet (settings test
reports that clearly).

### Context pack

```http
POST /v1/context
Authorization: Bearer <token>
Content-Type: application/json
Accept: application/json
```

**Request** (`kelpie.brolga.context_request/1.0`):

```json
{
  "schema_version": "kelpie.brolga.context_request/1.0",
  "organisation_id": "org_…",
  "case_id": "cas_…",
  "subject": { "kind": "ip", "value": "203.0.113.10" },
  "purpose": "case_enrichment",
  "detail_level": "L1",
  "budgets": {
    "max_objects": 40,
    "max_bytes": 24000,
    "max_relationships": 20
  }
}
```

**Response** (minimum Kelpie accepts):

```json
{
  "schema_version": "brolga.context_pack/1.0",
  "fingerprint": "…",
  "disposition": "…",
  "confidence": 72,
  "claims": [],
  "entities": [],
  "evidence": [],
  "exclusions": []
}
```

Source of truth for TypeScript types:

- `src/lib/brolga/types.ts`
- Client: `src/lib/brolga/client.ts`
- Enrichment provider name: `brolga` → stored under `observables.enrichment.brolga`

## Behaviour when Brolga is not ready

| Situation | Kelpie behaviour |
| --- | --- |
| Not configured | Provider skipped / status `unconfigured` |
| Disabled | No outbound calls |
| Connection refused / timeout | status `unavailable` (not a hard enrichment failure) |
| HTTP 404/501 on `/v1/context` | status `unavailable` |
| Valid pack | status `ok` + pack stored in enrichment jsonb |

Existing Kelpie TI feeds (`csv`, `misp`, `otx`, …) remain a **stopgap** local store
until Brolga connectors replace them operationally.

## Dogfood checklist (when Brolga lands)

1. Deploy Brolga on homelab with `/v1/health` and `/v1/context`.
2. Set `KELPIE_ALLOW_PRIVATE_NETWORKS=true` if using a private URL.
3. Configure Brolga URL (+ token) in Kelpie integrations; enable.
4. **Test connection** from the UI.
5. Add an IP observable to a case; confirm `enrichment.brolga` appears after cron/enrichment pass.
6. Retire overlapping local TI feeds once Brolga coverage is trusted.

## Out of scope in this prep

- Implementing Brolga itself
- New Kelpie feed kinds for AbuseIPDB / TAXII / STIX bulk
- Changing Kelpie's local `ti_indicators` type allowlist

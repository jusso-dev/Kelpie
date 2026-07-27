# Tawny integration

How to connect Tawny to Kelpie so Tawny alerts land as Kelpie cases, with
stable provenance and safe retries.

## 1. Overview

Tawny is a **push** producer: Tawny sends alerts to Kelpie by calling
`POST /api/v1/cases`. Kelpie does not poll Tawny, has no Tawny credentials of
its own, and never reaches out to Tawny's API. This is a deliberate product
boundary — unlike Microsoft Sentinel and Microsoft Defender XDR, which Kelpie
polls on a schedule through a `case_sources` connector, Tawny (and any other
push producer) is entirely delivery-driven. If Tawny stops sending alerts,
Kelpie has nothing to poll and no cases will appear; there is no backfill
path other than Tawny re-sending.

## 2. Setup

1. In Kelpie, go to **Settings → API tokens** and create a new token scoped
   to **`cases:write`** only. Do not grant it `cases:read` or any other
   scope — Tawny only needs to create cases, and a narrower token limits the
   blast radius if it ever leaks.
2. The token is displayed **exactly once**, at the moment it is created.
   Copy it immediately and store it in Tawny's secret store (not in a
   config file, ticket, or chat message). If you lose it, revoke it and
   issue a new one — Kelpie cannot show you a previously issued token again.
3. Configure Tawny to send alerts as an HTTP `POST` to:

   ```
   https://<your-kelpie-host>/api/v1/cases
   Authorization: Bearer <the token from step 2>
   Content-Type: application/json
   ```

4. In Kelpie, go to **Settings → Integrations → Tawny** for the copyable
   endpoint URL for your environment and for Tawny's delivery status
   (recent deliveries, created vs. duplicate counts, and the most recent
   error, if any).

## 3. Payload mapping

Kelpie's accepted enum values live in `src/lib/cases-core.ts`
(`CASE_ENUMS`) — use the values below exactly; Kelpie rejects anything else
with `400`.

| Tawny concept | Kelpie case field | Notes |
| --- | --- | --- |
| Alert severity | `severity` | One of `low`, `medium`, `high`, `critical`. |
| Alert type / detection category | `classification` | One of `malware`, `phishing`, `unauthorised_access`, `data_breach`, `dos`, `policy_violation`, `other`. Map anything that doesn't fit cleanly to `other` rather than guessing. |
| Traffic-light handling label (if Tawny has one) | `tlp` | One of `clear`, `green`, `amber`, `amber_strict`, `red`. Defaults to `amber` if omitted. |
| Permissible actions label (if Tawny has one) | `pap` | One of `clear`, `green`, `amber`, `red`. Defaults to `amber` if omitted. |
| Alert title | `title` | Required, non-empty. |
| Alert description / evidence summary | `summary` | Free text. |
| Tawny labels / rule names | `tags` | Free-form array of strings. |
| Affected hostname, device ID, or username | `summary` and/or `tags` | Kelpie's `cases` table has no dedicated endpoint-identity column, so fold the hostname/device/user into the `summary` text and/or add them as `tags` (e.g. `host:web-03`, `user:jsmith`) so they stay searchable. |
| Tawny alert URL | `sourceUrl` | Deep link back to the alert in Tawny. Must be `http(s)` and under 2048 characters; see §4. |
| Tawny alert ID | `sourceReference` | See §4 — this is what makes retries safe. |
| (fixed value) | `sourceSystem` | Always send the literal string `"tawny"`. |

## 4. Idempotency and retries

Put Tawny's own stable alert ID in `sourceReference`, alongside
`"sourceSystem": "tawny"`. Kelpie enforces `(organisation, sourceSystem,
sourceReference)` as unique, so:

- It is always safe to retry a delivery after a timeout, a `5xx`, or a
  network error — send the exact same payload again. Kelpie either creates
  the case once or converges the retry onto the case it already created.
- Distinguish a genuinely new case from a replay using the HTTP status and
  the `created` field in the response body: `201` and `"created": true`
  means Tawny's alert produced a brand-new case; `200` and `"created":
  false` means Kelpie already had a case for that `sourceReference` and
  handed back its `id`/`caseNumber` unchanged.
- If Tawny (or a load balancer in front of it) delivers the same alert
  twice at almost the same instant, both requests are safe: one gets
  `201`, the other gets `200` for the same case — Kelpie never creates two
  cases for one alert.
- The uniqueness check is scoped per organisation. If Tawny serves more
  than one Kelpie organisation, the same alert ID can independently exist
  in each organisation's case list without conflict.
- If you omit `sourceReference` (send only `sourceSystem`), Kelpie still
  records provenance on the case, but there is no idempotency key — every
  delivery without a `sourceReference` creates a separate case, so always
  send `sourceReference` for anything you might retry.

## 5. Worked example

```bash
curl -X POST https://kelpie.example.com/api/v1/cases \
  -H "Authorization: Bearer klp_example_token_do_not_use" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Suspicious PowerShell download on host WEB-03",
    "summary": "Encoded PowerShell command spawned by winword.exe, downloaded a remote payload. Host: WEB-03. User: jsmith.",
    "severity": "high",
    "classification": "malware",
    "tlp": "amber",
    "tags": ["host:web-03", "user:jsmith", "tawny-rule:suspicious-powershell"],
    "sourceSystem": "tawny",
    "sourceReference": "tawny_alert_7f3a9c21",
    "sourceUrl": "https://tawny.example.com/alerts/7f3a9c21"
  }'
```

First delivery of this alert — `201 Created`:

```json
{ "id": "case_8k2n4qz", "caseNumber": "KP-2026-0042", "created": true }
```

Tawny retries the same alert (or delivers it twice) — `200 OK`, same case:

```json
{ "id": "case_8k2n4qz", "caseNumber": "KP-2026-0042", "created": false }
```

## 6. Troubleshooting

| Status | Meaning | What to check |
| --- | --- | --- |
| `401` | Token missing, invalid, expired, or deprecated. | Confirm the `Authorization: Bearer klp_...` header is present and the token hasn't been revoked or expired in **Settings → API tokens**. |
| `403` | Token is valid but lacks the `cases:write` scope. | Re-check the scopes on the token used in **Settings → API tokens**; reissue with `cases:write` if needed (tokens cannot be edited after creation — you must create a new one). |
| `400` | Invalid payload. | Common causes: `sourceSystem` reuses a reserved managed-connector namespace (`microsoft_sentinel`, `microsoft_defender_xdr`); `sourceReference` was sent without `sourceSystem`; `sourceUrl` is not `http://` or `https://`, embeds credentials, or exceeds 2048 characters; `title` is missing, empty, or exceeds 500 characters. The response body's `details` object names the offending field. |

For delivery history — recent successes, duplicate counts, and the most
recent error message — check **Settings → Integrations → Tawny** in Kelpie.

## 7. Security notes

- Grant the Tawny token **`cases:write` only**. Do not add `cases:read` or
  any other scope unless Tawny genuinely needs it.
- Never log or echo the bearer token. Treat it the same as any other
  production credential.
- Kelpie does not store the request payload it received from Tawny for
  delivery-status purposes — only a redacted, length-capped error message
  (any `klp_...` token or `Bearer ...` header found in an error string is
  replaced with `[redacted]` before it is saved) is kept for
  troubleshooting failed deliveries.
- Source URLs are restricted to `http:`/`https:` on the way in, and
  re-validated the same way again when the case page renders the "View
  source incident" link — a URL that predates this check, or that reached
  the database by another path, still cannot render as a `javascript:` or
  `data:` link.
- Kelpie ignores any organisation or actor identifier a producer might
  include in the payload. The organisation is always the one that owns the
  bearer token, and it can never be overridden by the request body.

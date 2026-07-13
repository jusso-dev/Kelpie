# Kelpie REST API v1

All endpoints under `/api/v1` require a bearer token from **Settings → API tokens**. Scopes are enforced; a token with no scopes is rejected.

```
Authorization: Bearer klp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

Errors return `{ "error": "..." }` with an appropriate HTTP status (`400` invalid payload, `401` unauthorised, `403` forbidden, `404` not found).

## Scopes

| Scope | Allows |
| --- | --- |
| `alerts:read` / `alerts:write` | List or push alerts |
| `cases:read` / `cases:write` | Read or create/update cases |
| `tasks:read` / `tasks:write` | Read or create/update tasks |
| `observables:read` / `observables:write` | Search or add observables |
| `comments:read` / `comments:write` | Read or post comments |

## Alerts

### `POST /api/v1/alerts`
```json
{
  "title": "Suspicious login from new geo",
  "description": "Splunk saved search 'geo_anomaly'",
  "severity": "high",
  "source": "siem-splunk",
  "externalRef": "splunk-12345",
  "observables": [
    { "type": "ip", "value": "203.0.113.4" },
    { "type": "username", "value": "j.kim" }
  ],
  "rawPayload": {}
}
```
Returns `201 { "id": "alert_...", "status": "new" }`.

### `GET /api/v1/alerts`
Returns the 100 most recent alerts for the organisation. Optional query: `status` (`open` means `new` or `triaged`), `severity`, `limit`.

### `GET /api/v1/alerts/{id}`
Returns one alert.

### `PATCH /api/v1/alerts/{id}`
```json
{ "action": "acknowledge" }
```
`action` is `acknowledge`, `dismiss`, or `promote`. Promotion returns `caseId`. Requires `alerts:write`.

## Cases

### `GET /api/v1/cases`
Optional query: `status`, `severity`, `classification`, `tlp`, `assignee`, `openedSince`, `limit`. `status=active` returns every status except `closed`.

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

### `GET /api/v1/cases/{id}`
Full case with embedded `observables`, `tasks`, and a `recent_timeline` slice (50 most recent events).

### `PATCH /api/v1/cases/{id}`
Any subset of `status, severity, classification, tlp, pap, assigneeId, title, summary`. Status transitions stamp the lifecycle milestones and fire the `case.status_changed` webhook.

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

## Comments

### `GET /api/v1/cases/{caseId}/comments`
### `POST /api/v1/cases/{caseId}/comments`
```json
{ "body": "VT result: malicious=12, suspicious=3. @sam.analyst please review" }
```
`@handle` mentions trigger the same email path as the UI.

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

The push outbox routes `critical_alert`, `sla_breach`, and `comment_mention` events. Configure `APNS_TEAM_ID`, `APNS_KEY_ID`, `APNS_PRIVATE_KEY`, and the server-controlled `APNS_BUNDLE_ID`; the authenticated `/api/cron/mobile-push` worker delivers pending messages over APNs HTTP/2 and deactivates tokens rejected with HTTP 410.

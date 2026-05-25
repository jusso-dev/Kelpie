# Kelpie

Incident response and case management for small SOC teams. Open source, self-hosted.

> Herd the incident from alert to closed.

Kelpie is a SOC case management tool built as a single Next.js application backed by Postgres. It is designed to run cleanly on one modest VM.

## Features in this MVP

- Multi-tenant organisations, BetterAuth email-and-password sign-in, administrator / analyst / read_only roles.
- Inbound alert API (`POST /api/v1/alerts`), triage queue, dismiss or promote to a case.
- Cases with the full incident lifecycle (`open → in_progress → contained → eradicated → recovered → closed`), severity, TLP, PAP, classification, MITRE ATT&CK tagging, per-org case numbers (`KP-YYYY-NNNN`).
- Tasks with cadence: define playbooks with timed steps, applying a playbook spawns tasks with due times.
- Observables with manual entry, automatic carry-across from promoted alerts, cross-case lookup, and a pluggable enrichment interface (reverse DNS and URL parsing wired in).
- Append-only timeline that captures every state change, comment, task and observable event.
- Markdown comments with `@mention` email notifications.
- Local file attachments with SHA256.
- Dashboard with open cases by severity, MTTA / MTTC / MTTR, top classifications.
- Docker Compose deployment with Postgres.

The roadmap (SLA jobs, PDF export, full enrichment providers, webhooks, the wider API surface, SSO and so on) is tracked as GitHub issues under the **roadmap** label and the **Phase 2** and **Phase 3** milestones.

## Stack

- Next.js 16, React 19, server components and server actions.
- TypeScript, strict mode.
- Drizzle ORM with PostgreSQL.
- BetterAuth.
- Tailwind v4 with bespoke components (no shadcn install needed at MVP scope).

## Getting started (local dev)

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env
# (the defaults work against the bundled docker-compose db)

# 3. Bring up Postgres (or run your own; just point DATABASE_URL at it)
docker compose up -d db

# 4. Generate and apply migrations, then seed
npm run db:generate
npm run db:migrate
npm run db:seed

# 5. Run the app
npm run dev
```

Then visit http://localhost:3000 and sign in as `admin@acme.local` / `kelpieadmin`.

## Docker Compose (self-hosted)

```bash
cp .env.example .env
# Set BETTER_AUTH_SECRET to a long random string before exposing publicly.
docker compose up -d --build
# First-run only: apply migrations and seed
docker compose exec app node -e "require('./src/db/migrate')" || npm run db:migrate
```

The compose stack starts Postgres and the Kelpie app. Uploads land in the `kelpie_uploads` volume.

## Smoke test

After seeding, with the dev server running:

```bash
npm run smoke
```

This creates a transient API token, POSTs an alert, GETs it back, and asserts the round trip.

## Sending alerts from a SIEM

```bash
curl -X POST http://localhost:3000/api/v1/alerts \
  -H "Authorization: Bearer klp_yourtoken" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Suspicious login from new geo",
    "severity": "high",
    "source": "siem-splunk",
    "observables": [{"type": "ip", "value": "203.0.113.4"}]
  }'
```

Create tokens under Settings → API tokens.

## Conventions

- Australian spelling in code, copy, and docs.
- No em dashes.
- Times are stored in UTC.
- The timeline is append-only. Never edited or deleted.
- Every state-changing action on a case writes a timeline event.

## License

This repository ships with no licence file by default. Add one that matches your distribution intent before publishing.

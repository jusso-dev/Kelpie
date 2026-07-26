# Homelab deployment

This package runs published Kelpie images; it never builds source on server.

## Preconditions

- Image exists publicly at `ghcr.io/jusso-dev/kelpie`.
- Final HTTPS origin, DNS, and reverse proxy are ready before external exposure.
- Host has Docker Engine and Docker Compose v2.

## First deployment

On deployment host, install only this directory at `/home/justinmiddler/apps/Kelpie/deploy`:

```sh
cd /home/justinmiddler/apps/Kelpie/deploy
cp .env.example .env
chmod 600 .env
# Edit .env: secrets, final HTTPS URLs, image reference, and optional integrations.
docker compose --env-file .env -f compose.yaml config -q
docker compose --env-file .env -f compose.yaml pull
docker compose --env-file .env -f compose.yaml up -d
docker compose --env-file .env -f compose.yaml ps
curl -fsS http://127.0.0.1:3000/api/health
```

`migrate` must exit `0` before `app` starts. Compose stores PostgreSQL in
`kelpie_postgres_data` and uploads in `kelpie_uploads_data`; do not remove these
volumes during routine updates.

## HTTPS reverse proxy

Default bind is `127.0.0.1:3000`. The included Caddy service terminates HTTPS on
the homelab LAN address and proxies to that loopback listener. Its internal CA
root is stored in the `kelpie_caddy_data` volume and must be trusted on every
client before passkeys will work.

For the included `https://kepie.homelab` deployment:

```dotenv
KELPIE_BIND_ADDRESS=127.0.0.1
KELPIE_HTTPS_BIND_ADDRESS=192.168.1.19
BETTER_AUTH_URL=https://kepie.homelab
APP_URL=https://kepie.homelab
PASSKEY_RP_ID=kepie.homelab
PASSKEY_ORIGIN=https://kepie.homelab
```

After first start, export Caddy's root certificate:

```sh
docker compose --env-file .env -f compose.yaml cp \
  proxy:/data/caddy/pki/authorities/local/root.crt ./kelpie-caddy-root.crt
```

Install `kelpie-caddy-root.crt` as a trusted root CA on every browser device.
On macOS, an administrator can add it to the System keychain:

```sh
sudo security add-trusted-cert -d -r trustRoot \
  -k /Library/Keychains/System.keychain ./kelpie-caddy-root.crt
```

Keep `BETTER_AUTH_TRUSTED_ORIGINS` to exact origins. Trusting an origin only
permits authentication requests; it does not expose a listener or make one
passkey valid across unrelated hostnames. WebAuthn requires HTTPS outside
`localhost`, and passkeys created for RP ID `kepie.homelab` work only at that
RP ID.
The Caddy site address comes from `PASSKEY_ORIGIN`, its listener from
`KELPIE_HTTPS_BIND_ADDRESS`, and its upstream port from `KELPIE_PORT`; keep
`BETTER_AUTH_URL`, `APP_URL`, and `PASSKEY_ORIGIN` identical.

For a client deployment, replace `homelab` and the internal CA with the client's
real DNS name and publicly or organisationally trusted TLS certificate. Only use
`KELPIE_BIND_ADDRESS=0.0.0.0` behind an intentionally configured firewall and
TLS terminator.

## Email and chat notifications

Set `EMAIL_PROVIDER` to `resend`, `ses`, or `azure`. All providers use
`EMAIL_FROM`; provider-specific variables are documented in `.env.example`.
SES uses the standard AWS credential chain. Azure requires its Communication
Services Email connection string and a verified sender address. Leave
`EMAIL_PROVIDER=console` when delivery is not configured.

Slack and Microsoft Teams need no environment secrets. An administrator adds
their incoming webhook URLs under **Settings → Notification channels** and
chooses the events to send. Generic channels retain Kelpie's HMAC signature.

## Upgrade

1. Change `KELPIE_IMAGE_REF` to tested immutable tag or image digest.
2. Back up database and uploads.
3. Pull and start:

```sh
docker compose --env-file .env -f compose.yaml pull
docker compose --env-file .env -f compose.yaml up -d
docker compose --env-file .env -f compose.yaml ps
curl -fsS http://127.0.0.1:3000/api/health
```

Inspect `docker compose --env-file .env -f compose.yaml logs --tail=100 migrate app cron`
if health check fails. Database migrations can be forward-only: validate staging and
backup before client production update.

## Backup and rollback

Create an application-consistent database dump and upload archive before upgrade:

```sh
mkdir -p backups
docker compose --env-file .env -f compose.yaml exec -T db \
  sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' \
  > backups/kelpie-$(date +%F).dump
docker run --rm -v kelpie_uploads_data:/data -v "$PWD/backups":/backup \
  alpine:3.20 tar czf /backup/kelpie-uploads-$(date +%F).tgz -C /data .
```

To roll back application image after a failed release, restore prior tested
`KELPIE_IMAGE_REF`, then run `pull` and `up -d` commands above. Do not roll back
database schema without restoring matching database backup and validating it in an
isolated environment.

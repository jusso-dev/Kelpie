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

## Reverse proxy

Default bind is `127.0.0.1:3000`. Configure existing host proxy to send final
HTTPS origin to that address, then set identical `APP_URL` and `BETTER_AUTH_URL`.
Only use `KELPIE_BIND_ADDRESS=0.0.0.0` behind an intentionally configured firewall
and TLS terminator.

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

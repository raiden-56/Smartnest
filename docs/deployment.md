# Deployment, backup & recovery

## Production checklist

- [ ] PostgreSQL 14+ with automated backups
- [ ] HTTPS terminated in front of SmartNest (required: session cookies are `Secure` in production)
- [ ] `NODE_ENV=production`
- [ ] `CREDENTIAL_ENCRYPTION_KEY` — 32 random bytes, base64 (`node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`)
- [ ] `STREAM_TOKEN_SECRET` — 32 random bytes, hex
- [ ] `WEB_ORIGIN` and `PUBLIC_APP_URL` set to the public HTTPS origin
- [ ] `ALLOW_PRIVATE_INTEGRATION_HOSTS=false` if SmartNest is hosted outside the home network and users must not reach private ranges
- [ ] Secrets stored in your platform's secret manager, not in images or git
- [ ] Exactly **one** SmartNest server instance per database (stateful integration connections + in-process scheduler)

## Docker

The root `Dockerfile` builds a single image serving the API and the built web app on one port (8080), running `prisma migrate deploy` on start, as a non-root user, with a health check on `/api/health`.

```bash
docker build -t smartnest .
docker run -d --name smartnest -p 8080:8080 \
  -e DATABASE_URL='postgresql://user:pass@db-host:5432/smartnest' \
  -e CREDENTIAL_ENCRYPTION_KEY='…' -e STREAM_TOKEN_SECRET='…' \
  -e WEB_ORIGIN='https://home.example.com' -e PUBLIC_APP_URL='https://home.example.com' \
  smartnest
```

Or locally with Compose: put the two secrets in `.env`, then `docker compose --profile app up -d --build` (http://localhost:8080).

## Without Docker

```bash
npm ci
npm run build
npm run db:deploy -w @smartnest/server      # prisma migrate deploy
NODE_ENV=production node apps/server/dist/index.js   # serves apps/web/dist when present (STATIC_DIR to override)
```

## Reverse proxy (TLS + WebSocket)

Caddy:

```
home.example.com {
  reverse_proxy 127.0.0.1:8080
}
```

nginx:

```nginx
location / {
  proxy_pass http://127.0.0.1:8080;
  proxy_http_version 1.1;
  proxy_set_header Upgrade $http_upgrade;     # /api/ws
  proxy_set_header Connection "upgrade";
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto $scheme;
  proxy_buffering off;                        # camera MJPEG streams
  proxy_read_timeout 1h;
}
```

The server trusts one proxy hop in production (`trust proxy = 1`) for client IPs and rate limiting.

## Upgrades

1. Back up the database.
2. Deploy the new image/build — migrations run automatically (`prisma migrate deploy`) and are forward-only.
3. Check `/api/health` and the Integrations page (all integrations should return to "Connected").

## Backups

What to back up: the PostgreSQL database **and** `CREDENTIAL_ENCRYPTION_KEY`. Without the key, stored integration tokens cannot be decrypted (users would need to reconnect integrations; nothing else is lost).

```bash
pg_dump --format=custom --no-owner "$DATABASE_URL" > smartnest-$(date +%F).dump
```

Schedule daily dumps with retention (e.g. 14 daily, 8 weekly), store them encrypted off-host, and test restores regularly.

## Recovery

```bash
createdb smartnest_restore
pg_restore --no-owner --dbname "postgresql://…/smartnest_restore" smartnest-YYYY-MM-DD.dump
# point DATABASE_URL at the restored database and start SmartNest with the same CREDENTIAL_ENCRYPTION_KEY
```

After a restore, commands that were in flight are marked "timed out" automatically, adapters reconnect and re-read device state from the integrations (device state is never trusted from the backup alone).

## Key rotation

- `STREAM_TOKEN_SECRET`: rotate any time; only active camera views (≤ 60 s tokens) are affected.
- `CREDENTIAL_ENCRYPTION_KEY`: rotating makes stored tokens unreadable — affected integrations show "auth failed"; reconnect each with a new token. (Re-encryption tooling is not included in this version.)

## Monitoring

- `GET /api/health` → `200 {status:"ok", db:"ok"}` or `503`.
- Structured JSON logs (pino) on stdout; set `LOG_LEVEL`.
- Watch for `integration.error` activity entries and the Integrations page status.

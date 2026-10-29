# Security & privacy

## Authentication & sessions

- Passwords: scrypt (N=2¹⁵, r=8, p=1, 16-byte salt), minimum 10 characters with a letter and a number. Constant-time comparison; unknown emails run a dummy verification so timing does not reveal accounts; identical error messages.
- Sessions: 256-bit random token in an HttpOnly, `SameSite=Lax` cookie (`Secure` and `__Host-` prefix in production). Only the SHA-256 of the token is stored. Default lifetime 7 days (`SESSION_TTL_HOURS`). Users can list and revoke sessions; password change/reset revokes other sessions.
- Re-authentication: unlock, disarm, home deletion and data deletion require the password within the last 5 minutes.
- Password reset: single-use, 30-minute token, stored hashed. No email channel is configured; in development the link is written to the server log (never in production).

## Authorisation

Role → permission matrix in `packages/shared/src/permissions.ts`, enforced server-side by `homeAccess(permission)` on every home route, re-checked for camera media, WebSocket subscriptions and every pushed event.

| Permission | Owner | Admin | Member | Guest |
| --- | :-: | :-: | :-: | :-: |
| View home, devices; control everyday devices; activate scenes | ✅ | ✅ | ✅ | ✅ (lighting, plugs, climate, media, cleaning only) |
| Sensitive device control (locks, alarms, garage/gate) | ✅ | ✅ | ✅ | — |
| Cameras (view, control), activity, energy, network, automations (view) | ✅ | ✅ | ✅ | — |
| Manage rooms, devices, scenes, automations, integrations, network | ✅ | ✅ | — | — |
| Manage members | ✅ | ✅ (members/guests only) | — | — |
| Audit log | ✅ | ✅ | — | — |
| Delete home, delete stored data | ✅ | — | — | — |

Non-members get `404` for any resource in a home they don't belong to.

## Web protections

- **CSRF**: `SameSite=Lax` cookies plus a required custom header (`X-SmartNest-CSRF`) on all state-changing requests; cross-site forms can't set it and cross-origin fetches with it fail CORS preflight.
- **CORS**: only `WEB_ORIGIN`, with credentials.
- **Headers** (helmet): strict CSP (`default-src 'self'`, no inline scripts, `frame-ancestors 'none'`), HSTS, `nosniff`, referrer policy. Camera snapshots are served with `default-src 'none'` CSP.
- **Input validation**: every body/query is parsed with Zod; device commands are a closed discriminated union — the browser cannot send arbitrary service calls. JSON bodies limited to 256 KB.
- **Injection**: Prisma parameterised queries only; no raw SQL with user input.
- **Rate limiting**: global, auth and command limiters (see API reference).
- **Errors**: clients receive codes and safe messages; stack traces are logged server-side only.

## Secrets

- Integration credentials (e.g. HA long-lived tokens) are encrypted with AES-256-GCM using `CREDENTIAL_ENCRYPTION_KEY` and stored separately from device records (`IntegrationCredentialReference`). They are never returned by the API and never logged.
- Logs use pino with redaction for cookies, authorization headers, passwords, tokens, codes and ciphertext; request logs strip `token=` query parameters.
- Alarm codes are redacted before command records are stored.
- `npm run lint:secrets` fails if anything resembling a key, token or populated `.env` is tracked by git. `.env` is git-ignored.
- In production the server refuses to start without `CREDENTIAL_ENCRYPTION_KEY` and `STREAM_TOKEN_SECRET`.

## Network exposure (SSRF)

Integration URLs are resolved and checked before the server connects: non-HTTP(S) schemes, embedded credentials, `0.0.0.0/8`, link-local / cloud-metadata (`169.254.0.0/16`) and multicast are always rejected; private ranges can be disabled with `ALLOW_PRIVATE_INTEGRATION_HOSTS=false` for hosted deployments. Redirects are not followed. SmartNest never scans the network.

## Cameras & privacy

- Media is proxied by the server; browsers receive 60-second HMAC-signed URLs bound to user, home and camera, and the session cookie must also match. Permission is re-checked on each request.
- Active viewers are tracked; the UI shows a privacy indicator ("You are viewing", viewer count).
- Camera views are audited (at most once per user and camera per 10 minutes).
- Demo cameras return generated illustrations permanently stamped "DEMONSTRATION IMAGE".

## Audit log

Recorded: registrations, logins (incl. failures), logouts, password changes/resets, session revocations, home creation/updates/deletion, member invitations/joins/role changes/removals, integration connect/disconnect/remove/credential rotation, device hide/remove, sensitive commands, camera views, scene/automation creation and deletion, data deletion. Metadata never contains secrets.

## Retention & data deletion

Configurable per home (Settings → Privacy & data): activity (default 90 days), device state history (7), camera events (30). Commands/runs/notifications are kept 90 days, energy aggregates 400 days, expired sessions and tokens are purged. Owners can delete stored history on demand, disconnect integrations (deletes credentials) or delete the home entirely.

## Demo mode

Demo homes never send external notifications (only in-app exists), and every demo device, reading, energy figure and camera image is flagged `isDemo` and labelled in the UI.

## Known limitations

- No MFA in this version (re-authentication is used for sensitive actions).
- The in-memory rate limiter and real-time hub assume a single server instance.
- Email/push channels are not implemented; invitation links are shown once to the inviter.

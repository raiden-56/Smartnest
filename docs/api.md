# API reference

Base path: `/api`. JSON in and out. All typed request schemas and response DTOs live in `packages/shared/src/api.ts`, `commands.ts` and `automation.ts`.

## Conventions

- **Authentication**: HttpOnly session cookie (`smartnest_session`, `__Host-` prefixed in production), `SameSite=Lax`, set by login/register.
- **CSRF**: every non-GET request must send `X-SmartNest-CSRF: 1`, otherwise `403 csrf_failed`.
- **Home scoping**: resources live under `/api/homes/:homeId/...`. Non-members receive `404` (existence is not revealed). Missing permissions return `403 forbidden`.
- **Errors**: `{ "error": { "code": string, "message": string, "details"?: unknown } }`. Notable codes: `validation_error`, `unauthenticated`, `forbidden`, `not_found`, `confirmation_required` (428), `reauth_required` (403), `rate_limited` (429), `unsupported_capability`, `invalid_argument`, `integration_disconnected`, `integration_auth_failed`, `not_implemented` (501).
- **Rate limits**: 600 req/min per IP overall, 20 per 15 min on auth endpoints, 120 commands/min per user.

## Auth — `/api/auth`

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/register` | `{ name, email, password }` → `201 { user }` + session |
| POST | `/login` | `{ email, password }` (generic error for wrong email or password) |
| POST | `/logout` | Deletes the session |
| GET | `/me` | `{ user, preferences }` |
| POST | `/forgot-password` | `{ email }` — same response whether or not the account exists |
| POST | `/reset-password` | `{ token, password }` — one-time, 30 min; signs out all sessions |
| POST | `/reauth` | `{ password }` — unlocks sensitive actions for 5 minutes |
| PATCH | `/profile` | `{ name }` |
| POST | `/change-password` | `{ currentPassword, newPassword }` — signs out other sessions |
| GET / DELETE | `/sessions`, `/sessions/:id` | List / revoke sessions |
| PUT | `/preferences` | Temperature unit, reduced motion, default view, notification preferences |

## Homes, members, invitations

| Method | Path | Permission |
| --- | --- | --- |
| GET / POST | `/homes` | authenticated (creator becomes owner) |
| POST | `/homes/demo` | authenticated — creates a separate demo home |
| GET / PATCH / DELETE | `/homes/:homeId` | `home.view` / `home.manage` / `home.delete` + re-auth |
| POST | `/homes/:homeId/onboarding-complete` | `home.manage` |
| POST | `/homes/:homeId/demo-integration` | `integrations.manage` |
| POST | `/homes/:homeId/delete-data` | `data.delete` + re-auth; `{ activity?, history?, energy?, commands?, notifications? }` |
| GET | `/homes/:homeId/members` | `members.view` |
| PATCH / DELETE | `/homes/:homeId/members/:memberId` | `members.manage` (owners keep ≥1 owner; admins can't manage admins/owners; anyone can leave) |
| GET / POST | `/homes/:homeId/invitations` | `members.manage` — POST returns `inviteUrl` once |
| DELETE | `/homes/:homeId/invitations/:inviteId` | `members.manage` |
| GET | `/invitations/preview?token=` · POST `/invitations/accept` | authenticated; email must match |
| GET | `/homes/:homeId/audit` | `audit.view` |

## Rooms — `/homes/:homeId/rooms`

`GET /`, `POST /` (`rooms.manage`), `PUT /order` `{ ids }`, `GET/PATCH/DELETE /:roomId` (deleting unassigns devices), `POST /:roomId/actions` `{ action: lightsOn | lightsOff | allOff }` (`devices.control`; never targets locks, alarms, cameras or safety devices).

## Devices — `/homes/:homeId/devices`

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/` | Query: `q, roomId (id or "none"), category, manufacturer, integrationId, connectivity, operating (on/off/unknown), favourite, battery (low/ok/none), capability, includeHidden, sort (name/room/updated/connectivity/category), order, page, pageSize ≤ 100` → `Paginated<DeviceDto>` |
| GET | `/counts` | `{ total, online, offline, unavailable, unknown }` (hidden devices excluded) |
| GET | `/facets` | manufacturers + categories for filters |
| POST | `/bulk` | `devices.manage`: `{ ids, update: { roomId?, isFavourite?, isHidden? } }` |
| GET / PATCH / DELETE | `/:deviceId` | PATCH (`devices.manage`): `name, roomId, isFavourite, isHidden, category, energyRole`. DELETE removes from SmartNest only |
| POST | `/:deviceId/commands` | `devices.control`: `{ command: DeviceCommand, idempotencyKey?, confirmed? }` → `202 { command }` |
| GET | `/:deviceId/commands` | Last 25 commands |
| GET | `/:deviceId/history?hours=` | Sampled state history |
| POST | `/:deviceId/refresh` | Read-back from the integration |
| GET | `/homes/:homeId/commands/:commandId` | Poll a command (fallback when WebSocket is down) |

`DeviceCommand` examples:

```json
{ "capability": "onOff", "action": "turnOn" }
{ "capability": "brightness", "action": "setBrightness", "value": 40 }
{ "capability": "temperatureSetpoint", "action": "setTargetTemperature", "value": 21.5 }
{ "capability": "lock", "action": "unlock" }               // sensitive: confirmed=true + recent re-auth
{ "capability": "alarmPanel", "action": "arm", "mode": "armed_away", "code": "1234" }
```

Command statuses: `pending → sent → confirmed | failed | timed_out`; `verified=false` on a confirmed command means "acknowledged, cannot be read back".

## Integrations — `/homes/:homeId/integrations`

`GET /`, `GET /:id`, `POST /home-assistant` `{ name, baseUrl, accessToken }` (`integrations.manage`), `POST /demo`, `POST /:id/discover`, `GET /:id/discovered`, `POST /:id/import` `{ devices: [{ externalId, name, roomId }] }`, `POST /:id/health`, `POST /:id/reconnect` `{ accessToken?, baseUrl? }`, `POST /:id/disconnect`, `DELETE /:id`, `POST /:id/sync-automations`. Static catalogue: `GET /api/catalogue/integrations`, `GET /api/catalogue/devices`.

## Cameras — `/homes/:homeId/cameras`

`GET /` (`cameras.view`), `POST /:deviceId/token` → `{ snapshotUrl, streamUrl, expiresIn: 60 }`. `GET /:deviceId/snapshot?token=` and `/stream?token=` require **both** the session cookie and a matching HMAC-signed token bound to user, home and camera, and re-check `cameras.view` on every request. Integration credentials and RTSP URLs never reach the browser.

## Scenes — `/homes/:homeId/scenes`

`GET /`, `GET /:id`, `POST /`, `PUT /:id` (`scenes.manage`, body `SceneInput`), `PATCH /:id` `{ isFavourite }`, `POST /:id/duplicate`, `DELETE /:id`, `POST /:id/activate` `{ confirmed? }` (`scenes.activate`; 428 if sensitive and unconfirmed) → `202 { execution }`, `GET /:id/executions`.

## Automations — `/homes/:homeId/automations`

`GET /`, `GET /:id`, `POST /validate` `{ automation, id? }` → `{ valid, issues[] }`, `POST /` and `PUT /:id` (`AutomationInput`; drafts may contain errors, enabled automations may not), `POST /:id/enabled` `{ enabled }`, `POST /:id/run`, `POST /:id/simulate`, `POST /:id/duplicate`, `DELETE /:id`, `GET /:id/executions`, `GET /export`, `POST /import` (`{ format: "smartnest.automations.v1", automations }`, saved disabled). Home Assistant-owned automations return `409 externally_managed` for edit/delete/simulate.

## Activity, notifications, dashboard, energy, network, search

| Path | Notes |
| --- | --- |
| `GET /homes/:homeId/activity` | `activity.view`. Filters: `deviceId, roomId, category, severity, type, source, from, to, q`; cursor pagination (`cursor`, `limit ≤ 100`) |
| `GET /homes/:homeId/notifications` · `POST .../read` `{ ids? }` | The caller's in-app notifications |
| `GET / PUT / DELETE /homes/:homeId/dashboard` | Per user + home; PUT validates bounds, sizes and overlaps; DELETE resets |
| `GET /homes/:homeId/energy?range=live|today|7d|30d|custom&from&to` | `energy.view`; only integration-supplied data, with sources |
| `GET /homes/:homeId/network` | `network.view`; only integration-supplied data |
| `GET /homes/:homeId/search?q=` | Grouped results filtered by permission |
| `GET /api/health` | Liveness + database check |

## WebSocket — `/api/ws`

Authenticated by the session cookie at upgrade; the `Origin` must be the app origin.

Client → server: `{ "type": "subscribe", "homeId": "…" }`, `{ "type": "ping" }`.
Server → client: `ready`, `subscribed`, `pong`, and `RealtimeEvent`s:
`device.updated`, `device.removed`, `command.updated`, `integration.updated`, `activity.created`, `notification.created` (only to its recipient), `scene.execution`, `automation.execution`, `camera.viewers`, `home.changed`. Each event type requires a permission (see `EVENT_PERMISSION` in `apps/server/src/realtime/hub.ts`). Close codes: `4401` session ended, `4403` membership revoked.

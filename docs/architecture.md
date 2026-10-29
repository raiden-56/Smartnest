# Architecture

```
 Browser (React SPA)                         SmartNest server (Node/Express)                       Integrations
 ┌──────────────────────┐  HTTPS (cookie)   ┌───────────────────────────────────────────┐        ┌───────────────────┐
 │ RTK Query API cache  │ ───────────────▶  │ Routes ─▶ RBAC (homeAccess) ─▶ Services   │        │ Home Assistant    │
 │ live slice (WS)      │                   │                                            │ REST   │  /api/states      │
 │ capability controls  │ ◀─────────────── │ RealtimeHub (/api/ws, session + origin)    │ ─────▶ │  /api/services    │
 │ dashboard (RGL)      │  WebSocket        │        ▲                                   │ WS     │  /api/websocket   │
 └──────────────────────┘                   │        │ bus                               │ ◀───── │  camera_proxy     │
                                            │ IntegrationManager ─▶ Adapters ───────────┼───────▶│ Demo (simulated)  │
                                            │ CommandService · DeviceState ingest        │        └───────────────────┘
                                            │ AutomationEngine · Scheduler · Retention   │
                                            │            Prisma ─▶ PostgreSQL            │
                                            └───────────────────────────────────────────┘
```

## Packages

| Package | Responsibility |
| --- | --- |
| `packages/shared` | The contract. Capability schema, `DeviceState`, typed `DeviceCommand` union (Zod), command validation against capabilities, expected-state matchers for read-back, permission matrix, device/integration catalogue, automation and dashboard schemas + validators, DTOs and realtime event types. |
| `apps/server` | HTTP API, auth, RBAC, adapters, command lifecycle, real-time hub, automation engine, jobs. |
| `apps/web` | SPA. Feature folders under `src/features/*`, shared UI in `src/components/*`. |
| `apps/mock-ha` | Deterministic HA test double. |

## Device model

A **device** is one integration entity (for Home Assistant: one `entity_id`). It has:

- identity: `integrationId` + `externalId` (unique together) — never changes when renamed or moved between rooms;
- `capabilities[]` declared by the adapter (e.g. `onOff`, `brightness{min,max}`, `hvacMode{modes}`, `position{coverKind,canSetPosition,canStop}`…);
- `state` — a normalised `DeviceState` containing **only values the integration reported**;
- `connectivity` — `online | offline | unavailable | unknown`, tracked independently. When an integration connection drops, its devices become `unknown` (SmartNest cannot know), not `offline`;
- bookkeeping: `stateUpdatedAt`, `lastSeenAt`, `lastCommandAt`, `lastError`, `isHidden`, `isFavourite`, `roomId`.

## Command lifecycle

Implemented in `apps/server/src/services/commands.ts`.

1. **Authenticate** (session cookie) and **authorise** (`homeAccess('devices.control')`; guests limited to everyday categories; sensitive commands need `devices.control.sensitive`, `confirmed: true` and — for unlock/disarm — a password re-authentication within 5 minutes).
2. **Validate** the command shape (Zod discriminated union — there is no free-form "service call") and against the device's declared capabilities (ranges, modes, presets).
3. **Idempotency**: an `idempotencyKey` (generated per user action in the browser) returns the original command instead of creating a duplicate.
4. **Record** a `DeviceCommand` (`pending`) and push it over the WebSocket.
5. **Check integration** — disconnected / auth-failed integrations fail immediately with a clear error code.
6. **Register a confirmation waiter** (before sending, so no event is missed), then **send** through the adapter. An adapter acknowledgement moves the command to `sent`.
7. **Confirm** by state: the waiter resolves when an integration event — or a scheduled read-back at 0.8 s, 2.5 s and 5 s — matches `expectedStateMatcher(command)`.
8. On **timeout** (`COMMAND_TIMEOUT_MS`, default 10 s) a final read-back is attempted; otherwise the command is `timed_out` ("Not confirmed").
9. Momentary commands that cannot be read back (next track, PTZ nudge, custom actions) are `confirmed` with `verified: false` and labelled **Acknowledged**.
10. The result is stored in `DeviceCommandResult`, the device's `lastCommandAt`/`lastError` are updated, an activity entry is written, and sensitive commands are audited.
11. The browser shows `Sending… → Waiting for device… → Confirmed / Failed / Not confirmed` with a Retry action, and announces the result to screen readers. Controls never flip optimistically.

Commands left in flight by a crash are marked `timed_out` on startup.

## State ingestion

`services/deviceState.ts` is the single entry point for integration updates. Per device, updates are serialised, de-duplicated (adapter `dedupeKey`, e.g. HA `last_updated`), merged into `state`, persisted, pushed to browsers and emitted on the internal bus (automations and command waiters listen). Side effects: connectivity transitions, low-battery crossings, hazards, alarm triggers, lock/contact/motion events become activity entries and notifications (rate-limited where noisy). State history snapshots are throttled (5 min, or on significant changes) and pruned by retention.

## Real-time

`/api/ws` is authenticated with the session cookie during the HTTP upgrade and checks the `Origin` header (prevents cross-site WebSocket hijacking). A client subscribes to one home; membership is verified, and every event is filtered by the subscriber's role (e.g. camera viewer counts need `cameras.view`). Sessions and memberships are re-validated every 30 s and on `home.changed`. The browser reconnects with exponential backoff, shows a "Reconnecting" indicator, resynchronises after a gap, and falls back to polling command results while disconnected.

## Integrations

See [integrations.md](integrations.md). The `IntegrationAdapter` interface (`apps/server/src/integrations/types.ts`) is independent of the UI and HTTP layers. The `IntegrationManager` owns adapter lifecycle, retries with backoff, status tracking, discovery, import and disconnection.

## Automations & execution ownership

Each automation has an `executor`:

- `smartnest` — evaluated by `services/automationEngine.ts` (device-state, threshold, connectivity, time, interval, sunrise/sunset and integration-event triggers; nested AND/OR conditions; device, scene, notify, delay and run-automation actions).
- `home_assistant` — synced from HA's `automation.*` entities. SmartNest can enable, disable and trigger them through HA services but **never evaluates them**, so a rule can't run twice.

Protection against loops and runaway execution: semantic validation (self-triggering on/off loops, `runAutomation` cycles, sensitive-action opt-in), per-automation cooldown, overlap prevention, nesting depth ≤ 3, and a circuit breaker that disables an automation that runs more than 20 times in 10 minutes and notifies the household. Drafts and imported automations are never enabled automatically.

## Scenes

Scene actions are ordinary device commands (parallel or sequential). A scene execution is `succeeded` only if every action is confirmed; otherwise `partial` or `failed`, with per-action results streamed live. Lock/alarm/garage actions require `allowSensitiveActions` on the scene and confirmation at activation.

## Data model & retention

The Prisma schema (`apps/server/prisma/schema.prisma`) is documented inline. Highlights:

- every home-scoped table carries `homeId` (indexed); queries always filter by the caller's membership;
- `@@unique([integrationId, externalId])` for devices and discovered entities;
- credentials only in `IntegrationCredentialReference.ciphertext` (AES-256-GCM);
- high-frequency data: throttled `DeviceStateSnapshot` rows pruned after `Home.retentionSnapshotDays` (default 7); energy aggregated into hourly `EnergyReading` buckets kept 400 days; activity pruned after `retentionActivityDays` (90) and camera events after `retentionCameraDays` (30); commands, runs and notifications after 90 days. The retention job runs hourly.

## Scaling note

Integration connections are stateful (one WebSocket per HA instance), and the scheduler runs in-process. Run **one server instance** per database. Horizontal scaling would require leader election for adapters/scheduler and a shared pub/sub for the real-time hub.

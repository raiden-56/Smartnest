# Integrations

SmartNest only talks to devices through documented integrations. It never guesses a protocol, never scans arbitrary network ranges, and never claims that discovering a device grants permission to control it.

| Integration | Status in this build | How |
| --- | --- | --- |
| **Home Assistant** | Supported | REST API for request/response, WebSocket API for events |
| **Demonstration home** | Supported | Simulated, clearly labelled devices |
| MQTT (Zigbee2MQTT, Tasmota, ESPHome…) | Via Home Assistant | Configure HA's MQTT integration (broker included in `docker compose --profile mqtt`) |
| Matter / Thread | Via Home Assistant | Commission in HA's Matter integration (needs a controller; browsers cannot pair) |
| Zigbee / Z-Wave | Via Home Assistant | ZHA, Zigbee2MQTT or Z-Wave JS (needs a radio) |
| ONVIF / RTSP cameras | Via Home Assistant | HA ONVIF / Generic Camera; SmartNest proxies snapshots + MJPEG |
| Vendor clouds (Hue, Ecobee, Tuya…) | Via Home Assistant | Official HA integrations |

The API answers `501 not_implemented` (with guidance) for direct MQTT/Matter/ONVIF/vendor setup rather than pretending to connect.

## Connecting Home Assistant

1. In Home Assistant open your **profile → Security → Long-lived access tokens** and create a token named "SmartNest".
2. In SmartNest go to **Integrations → Add integration → Home Assistant** (or the onboarding "Connect" step).
3. Enter the URL the **SmartNest server** can reach (e.g. `http://homeassistant.local:8123`) and paste the token.
4. SmartNest validates the URL (blocks link-local/metadata addresses, and private ranges if `ALLOW_PRIVATE_INTEGRATION_HOSTS=false`), verifies the token with `GET /api/`, opens the WebSocket, and lists mappable entities. **Nothing is saved if verification fails.**
5. The token is encrypted (AES-256-GCM, `CREDENTIAL_ENCRYPTION_KEY`) and never returned to the browser.
6. Review discovered entities, rename them, assign rooms (HA areas are suggested), and import. Each imported device is tested with a state read-back.

### What SmartNest uses from Home Assistant

| Purpose | Endpoint |
| --- | --- |
| Verify token / health | `GET /api/` |
| Discovery, read-back, recovery after reconnect | `GET /api/states`, `GET /api/states/<entity_id>` |
| Commands | `POST /api/services/<domain>/<service>` (one documented service per SmartNest command) |
| Camera snapshot / stream | `GET /api/camera_proxy/<entity_id>`, `GET /api/camera_proxy_stream/<entity_id>` |
| Real-time events | WebSocket `/api/websocket`: `auth`, `subscribe_events` (`state_changed`), `ping` |
| Areas, manufacturers, disabled entities (optional) | WebSocket `config/entity_registry/list`, `config/device_registry/list`, `config/area_registry/list` |
| HA-owned automations | `automation.*` states; `automation.turn_on/turn_off/trigger` |
| Network clients | `device_tracker.*` entities with `source_type: router` |

### Resilience

- **Authentication errors / revoked token** → status `auth_failed`, no retry loop, notification to admins; reconnect with a new token from the integration page.
- **Connection loss** → status `connecting`, devices become connectivity `unknown`, reconnect with exponential backoff (≤ 60 s, jittered), re-subscribe, then re-read all states so changes made while offline are recovered.
- **Timeouts** → mapped to `integration_timeout` (8 s REST, 10 s WS commands); heartbeat pings every 30 s detect dead sockets.
- **Duplicate events** → dropped using `last_updated`.
- **Unavailable entities** → connectivity `unavailable`, controls disabled, commands fail with `device_unavailable`.
- **Unsupported actions** → rejected before sending (`unsupported_capability`).

### Disconnect vs remove

- **Disconnect**: stops syncing, deletes the stored token, keeps device records (shown as "Integration disconnected"), disables HA automations in SmartNest. Reconnecting requires a new token.
- **Remove**: deletes the integration and its devices (plus scene actions referencing them) from SmartNest only. Nothing changes in Home Assistant.

## Mock Home Assistant

`apps/mock-ha` implements the subset above with deterministic entities (light, switch, climate, cover, lock, sensors, binary sensors, camera, media player, automation, router tracker, an unavailable bulb and an unsupported text sensor). It can revoke its token, drop connections, go offline and make entities unresponsive — the server integration tests use all of these.

```bash
npm run mock-ha        # MOCK_HA_PORT (default 8123) and MOCK_HA_TOKEN env vars
```

## Adding a new integration

1. Implement `IntegrationAdapter` (`apps/server/src/integrations/types.ts`):
   `connect`, `disconnect`, `healthCheck`, `discover`, `readState`, `executeCommand`, and optionally `getCameraSnapshot`, `openCameraStream`, `getNetworkSnapshot`, `listAutomations`, `setAutomationEnabled`, `triggerAutomation`.
2. Map native entities to SmartNest `Capability[]` and `DeviceState` — only declare capabilities you can actually execute, and only report values you actually received.
3. Report changes through `context.onDeviceUpdate`, status through `context.onStatusChange`. Throw `AdapterError` with a `CommandErrorCode` for failures.
4. Register the factory in `FACTORIES` in `apps/server/src/integrations/manager.ts`, add its definition (requirements, setup steps, limitations, supported capabilities) to `INTEGRATIONS` in `packages/shared/src/catalogue.ts`, and add a connect route.
5. Add a mock server + integration tests like `test/homeassistant.test.ts`.

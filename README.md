# SmartNest

**Your entire home. One intelligent control centre.**

SmartNest is a unified smart-home control, monitoring and automation platform. It connects to documented integrations — Home Assistant first — and gives you one place to organise rooms, control devices, watch cameras, run scenes and automations, and monitor energy and network health.

It is built around a few non-negotiable principles:

- **Honest state.** Connectivity (online / offline / unavailable / unknown) is tracked separately from operating state. Missing values are shown as "Not available", never guessed.
- **Confirmed commands.** A command is "confirmed" only when the device reports the requested state. An HTTP 200 from an integration is treated as *sent*, not *done*. Commands that cannot be read back are labelled "Acknowledged".
- **Capability-driven UI.** Controls are rendered from the capabilities each integration declares, so unsupported controls never appear.
- **Demo mode that never pretends.** A simulated home lets anyone explore without hardware. Every demo device, reading and camera image is labelled.
- **Security by default.** Server-side RBAC on every request, encrypted integration credentials, authenticated WebSockets, signed short-lived camera URLs, audit logging.

![Stack](https://img.shields.io/badge/stack-React%20%2B%20Express%20%2B%20PostgreSQL-386641)

## Quick start

Prerequisites: **Node.js 20+**, **Docker** (for PostgreSQL).

```bash
npm install                      # installs all workspaces
cp .env.example .env             # then generate the two secrets (see comments in the file)
npm run db:up                    # PostgreSQL on localhost:5442 (dev + test databases)
npm run db:migrate               # apply Prisma migrations
npm run db:seed                  # optional: demo account with a fully populated demo home
npm run dev                      # API on :4317 and web app on :5317
```

Open **http://localhost:5317**.

- Register a new account and follow onboarding — choose **Explore demo mode** to get a simulated home instantly, or connect your Home Assistant.
- Or sign in with the seeded demo account: `demo@smartnest.local` / `demo-password-123`.

> Ports 4317 / 5317 / 5442 were chosen to avoid clashing with other common local services. Change `PORT`, `WEB_ORIGIN` and `PUBLIC_APP_URL` in `.env` (and the Vite port in `apps/web/vite.config.ts`) if needed.

### Try Home Assistant without Home Assistant

A deterministic mock of the Home Assistant REST + WebSocket API is included for testing:

```bash
npm run mock-ha                  # http://127.0.0.1:8123, token printed on start
```

In SmartNest go to **Integrations → Add integration → Home Assistant**, enter `http://127.0.0.1:8123` and the printed token. (It is a test double for the subset of the API SmartNest uses — not a Home Assistant replacement.)

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Build the shared package, run API (tsx watch) and web (Vite) together |
| `npm run build` | Production build of shared, server (tsup) and web (Vite) |
| `npm test` | Shared + server (unit & integration) + web unit tests |
| `npm run test:e2e` | Playwright end-to-end tests (starts mock HA, API and web on isolated ports) |
| `npm run typecheck` | Strict TypeScript across all workspaces |
| `npm run db:migrate` / `db:seed` | Prisma migrations / demonstration seed data |
| `npm run mock-ha` | Mock Home Assistant for manual testing |
| `npm run lint:secrets` | Fails if anything that looks like a secret is tracked by git |

## Project layout

```
packages/shared   Typed contract shared by server and web: capabilities, commands (Zod), permissions,
                  device/integration catalogue, automation + dashboard schemas, API DTOs, realtime events
apps/server       Express + Prisma (PostgreSQL). Auth, RBAC, integration adapters (Demo, Home Assistant),
                  command lifecycle, WebSocket hub, automation engine, scheduler, retention
apps/web          React + Vite + MUI + RTK Query. Capability-driven controls, customisable dashboard
apps/mock-ha      Mock Home Assistant (REST + WebSocket) used by integration and E2E tests
e2e               Playwright end-to-end tests
docs              Architecture, API, integrations, capabilities, security, deployment, testing
```

## Documentation

- [Architecture](docs/architecture.md) — components, command lifecycle, real-time, automations, data model
- [Integrations & setup](docs/integrations.md) — Home Assistant setup, adapter interface, adding integrations
- [Supported capabilities](docs/capabilities.md) — what is and is not supported, per integration
- [API reference](docs/api.md) — REST endpoints, permissions, WebSocket protocol
- [Security & privacy](docs/security.md)
- [Deployment, backup & recovery](docs/deployment.md)
- [Testing](docs/testing.md)

## Implementation status

| Area | Status |
| --- | --- |
| Auth (register, login, sessions, password reset, re-authentication), homes, roles, invitations | ✅ |
| Rooms, device inventory (server-side filter/sort/pagination, bulk actions), device detail | ✅ |
| Capability-based controls with full command lifecycle (pending → confirmed / failed / timed out) | ✅ |
| Demo integration (simulated devices incl. offline and unresponsive ones) | ✅ |
| Home Assistant adapter (REST + WebSocket, reconnection with backoff, state recovery, de-duplication) | ✅ |
| Cameras (signed short-lived URLs, authenticated proxy, privacy indicator) | ✅ snapshots + MJPEG via HA |
| Scenes with partial-failure reporting; automations with loop/runaway protection | ✅ |
| Energy, network, activity, notifications (in-app), global search | ✅ |
| Customisable dashboard (drag, resize, hide, add, configure, reset; per user + home) | ✅ |
| MQTT, Matter, Zigbee/Z-Wave, ONVIF, vendor clouds | Via Home Assistant (no direct adapter yet) |
| Email / push notification channels | Not configured — in-app only |

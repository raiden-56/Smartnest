# Testing

No physical hardware is needed for any test. Server and E2E tests use the dedicated `smartnest_test` database (created by `docker/postgres-init`), and Home Assistant is replaced by `apps/mock-ha`.

```bash
npm run db:up
npm test             # shared + server + web
npm run test:e2e     # Playwright (first time: npx playwright install chromium)
```

## Layers

| Layer | Location | Covers |
| --- | --- | --- |
| Shared unit | `packages/shared/src/__tests__` | Command schema & capability validation, sensitivity rules, expected-state matchers, permission matrix, automation validation (loops, cycles, sensitive opt-in, sun triggers), dashboard layout validation (bounds, sizes, overlap) |
| Server unit | `apps/server/src/**/*.unit.test.ts` | HA entity → capability/state mapping, command → service translation, HA error mapping, credential encryption, password hashing, stream tokens |
| Server integration | `apps/server/test/*.test.ts` (supertest + real PostgreSQL) | Auth (register, login, logout, CSRF, password reset, session storage), homes/rooms, RBAC incl. 404 for non-members, invitations, re-auth; demo inventory counts/filters/pagination, command lifecycle (confirmed / failed offline / timed out unresponsive / unsupported capability / idempotency / sensitive confirmation / guest limits), activity logging, scenes (partial failure, confirmation), automations (loop rejection, drafts, execution, simulation, import/export), dashboard persistence and overlap rejection, energy/network/search; Home Assistant via mock (no save on bad token, SSRF guard, encrypted token, discovery mapping, import + read-back test, WS-confirmed commands, timeouts, external changes, energy accumulation, reconnection + state recovery, HA-owned automations, network clients, camera authorization, token revocation, reconnect with new token, graceful disconnect, removal) |
| Web unit | `apps/web/src/**/__tests__` (Vitest + Testing Library) | Capability-based control rendering, disabled/explained states, "Not available" readings, connectivity badges are text not colour-only |
| End-to-end | `e2e/` (Playwright) | The full workflow: register → create home → rooms → connect (mock) Home Assistant → discover → import + assign rooms → device detail → command → confirmed result → updated state → activity log → scene create + activate → automation create + enable → disconnect integration with graceful handling; plus a phone-sized run checking demo mode and no horizontal overflow |

E2E starts its own mock HA (8129), API (4318) and web (5318) so it does not interfere with a running dev environment.

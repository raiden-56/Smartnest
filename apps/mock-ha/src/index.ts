import { startMockHomeAssistant } from './server.js';

const port = Number(process.env.MOCK_HA_PORT ?? 8123);
const token = process.env.MOCK_HA_TOKEN ?? 'mock-long-lived-access-token-for-tests-0000';

const ha = await startMockHomeAssistant({ port, token, stateDelayMs: 300 });
// eslint-disable-next-line no-console
console.log(`Mock Home Assistant (test double) listening on ${ha.url}\nUse this access token in SmartNest: ${ha.token}`);

import { describe, expect, it } from 'vitest';
import { automationInputSchema, validateAutomation, type AutomationValidationContext } from '../index.js';

const ctx = (over: Partial<AutomationValidationContext> = {}): AutomationValidationContext => ({
  devices: new Map([
    ['lamp', { name: 'Lamp', capabilities: ['onOff', 'brightness'] }],
    ['pir', { name: 'Hall motion', capabilities: ['motion'] }],
    ['door', { name: 'Front door', capabilities: ['lock'] }],
  ]),
  sceneIds: new Set(['scene1']),
  roomIds: new Set(['room1']),
  automationGraph: new Map(),
  homeHasLocation: false,
  ...over,
});

const base = {
  name: 'Hall light',
  triggers: [{ type: 'deviceState', deviceId: 'pir', attribute: 'motion', to: true }],
  actions: [{ type: 'deviceCommand', deviceId: 'lamp', command: { capability: 'onOff', action: 'turnOn' } }],
};

describe('automation validation', () => {
  it('accepts a valid automation', () => {
    const input = automationInputSchema.parse(base);
    expect(validateAutomation(input, ctx()).filter((i) => i.severity === 'error')).toHaveLength(0);
  });
  it('detects a direct on/off self-loop', () => {
    const input = automationInputSchema.parse({ ...base, triggers: [{ type: 'deviceState', deviceId: 'lamp', attribute: 'on', to: false }] });
    const errors = validateAutomation(input, ctx()).filter((i) => i.severity === 'error');
    expect(errors.some((e) => e.message.includes('loop'))).toBe(true);
  });
  it('rejects unsupported capability actions', () => {
    const input = automationInputSchema.parse({
      ...base,
      actions: [{ type: 'deviceCommand', deviceId: 'pir', command: { capability: 'onOff', action: 'turnOn' } }],
    });
    expect(validateAutomation(input, ctx()).some((i) => i.severity === 'error')).toBe(true);
  });
  it('requires explicit opt-in for sensitive actions', () => {
    const input = automationInputSchema.parse({
      ...base,
      actions: [{ type: 'deviceCommand', deviceId: 'door', command: { capability: 'lock', action: 'unlock' } }],
    });
    expect(validateAutomation(input, ctx()).some((i) => i.message.includes('security-sensitive'))).toBe(true);
    const allowed = automationInputSchema.parse({ ...input, allowSensitiveActions: true });
    expect(validateAutomation(allowed, ctx()).some((i) => i.message.includes('security-sensitive'))).toBe(false);
  });
  it('detects runAutomation cycles', () => {
    const input = automationInputSchema.parse({ ...base, actions: [{ type: 'runAutomation', automationId: 'b' }] });
    const graph = new Map([
      ['b', ['c']],
      ['c', ['a']],
    ]);
    expect(validateAutomation(input, ctx({ selfId: 'a', automationGraph: graph })).some((i) => i.message.includes('cycle'))).toBe(true);
    expect(validateAutomation(input, ctx({ selfId: 'b' })).some((i) => i.message.includes('itself'))).toBe(true);
  });
  it('requires location for sun triggers', () => {
    const input = automationInputSchema.parse({ ...base, triggers: [{ type: 'sun', event: 'sunset' }] });
    expect(validateAutomation(input, ctx()).some((i) => i.message.includes('location'))).toBe(true);
    expect(validateAutomation(input, ctx({ homeHasLocation: true })).some((i) => i.severity === 'error')).toBe(false);
  });
  it('rejects too-frequent intervals at the schema level', () => {
    expect(automationInputSchema.safeParse({ ...base, triggers: [{ type: 'interval', everyMinutes: 1 }] }).success).toBe(false);
  });
});

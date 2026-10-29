import { describe, expect, it } from 'vitest';
import {
  deviceCommandSchema,
  expectedStateMatcher,
  isSensitiveCommand,
  redactCommand,
  validateCommandForCapabilities,
  type Capability,
} from '../index.js';

const light: Capability[] = [{ type: 'onOff' }, { type: 'brightness', min: 0, max: 100 }];
const thermostat: Capability[] = [
  { type: 'temperatureSetpoint', min: 16, max: 30, step: 0.5, unit: 'C' },
  { type: 'hvacMode', modes: ['off', 'cool', 'auto'] },
  { type: 'fanSpeed', presets: ['low', 'high'] },
];

describe('command schema', () => {
  it('rejects free-form commands', () => {
    expect(deviceCommandSchema.safeParse({ capability: 'onOff', action: 'rm -rf' }).success).toBe(false);
    expect(deviceCommandSchema.safeParse({ capability: 'shell', action: 'exec', cmd: 'x' }).success).toBe(false);
  });
  it('rejects out-of-range values', () => {
    expect(deviceCommandSchema.safeParse({ capability: 'brightness', action: 'setBrightness', value: 140 }).success).toBe(false);
  });
});

describe('validateCommandForCapabilities', () => {
  it('rejects commands for undeclared capabilities', () => {
    const r = validateCommandForCapabilities({ capability: 'lock', action: 'unlock' }, light);
    expect(r).toMatchObject({ ok: false, code: 'unsupported_capability' });
  });
  it('accepts supported commands', () => {
    expect(validateCommandForCapabilities({ capability: 'onOff', action: 'turnOn' }, light).ok).toBe(true);
  });
  it('enforces setpoint range declared by the device', () => {
    expect(validateCommandForCapabilities({ capability: 'temperatureSetpoint', action: 'setTargetTemperature', value: 35 }, thermostat)).toMatchObject({
      ok: false,
      code: 'invalid_argument',
    });
    expect(validateCommandForCapabilities({ capability: 'temperatureSetpoint', action: 'setTargetTemperature', value: 22 }, thermostat).ok).toBe(true);
  });
  it('enforces declared modes and presets', () => {
    expect(validateCommandForCapabilities({ capability: 'hvacMode', action: 'setHvacMode', mode: 'heat' }, thermostat).ok).toBe(false);
    expect(validateCommandForCapabilities({ capability: 'fanSpeed', action: 'setFanSpeed', speed: 'turbo' }, thermostat).ok).toBe(false);
    expect(validateCommandForCapabilities({ capability: 'fanSpeed', action: 'setFanSpeed', speed: 'low' }, thermostat).ok).toBe(true);
  });
});

describe('sensitivity', () => {
  it('flags unlock, disarm and garage opening', () => {
    expect(isSensitiveCommand({ capability: 'lock', action: 'unlock' })).toBe(true);
    expect(isSensitiveCommand({ capability: 'alarmPanel', action: 'disarm' })).toBe(true);
    expect(isSensitiveCommand({ capability: 'position', action: 'open' }, [{ type: 'position', coverKind: 'garage', canSetPosition: false, canStop: false }])).toBe(true);
    expect(isSensitiveCommand({ capability: 'position', action: 'open' }, [{ type: 'position', coverKind: 'blind', canSetPosition: true, canStop: true }])).toBe(false);
    expect(isSensitiveCommand({ capability: 'onOff', action: 'turnOn' })).toBe(false);
  });
  it('redacts alarm codes', () => {
    expect(redactCommand({ capability: 'alarmPanel', action: 'disarm', code: '1234' })).toMatchObject({ code: '••••' });
  });
});

describe('expectedStateMatcher', () => {
  it('confirms on/off only on matching state', () => {
    const m = expectedStateMatcher({ capability: 'onOff', action: 'turnOn' })!;
    expect(m({ on: true })).toBe(true);
    expect(m({ on: false })).toBe(false);
    expect(m({})).toBe(false);
  });
  it('allows tolerance on numeric targets', () => {
    const m = expectedStateMatcher({ capability: 'brightness', action: 'setBrightness', value: 50 })!;
    expect(m({ on: true, brightness: 51 })).toBe(true);
    expect(m({ on: true, brightness: 60 })).toBe(false);
  });
  it('returns null for momentary commands that cannot be read back', () => {
    expect(expectedStateMatcher({ capability: 'mediaPlayback', action: 'mediaCommand', command: 'next' })).toBeNull();
    expect(expectedStateMatcher({ capability: 'ptz', action: 'ptzMove', direction: 'left' })).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import { commandToService, mapConnectivity, mapEntity, mapHaHttpError, mapState, type HaState } from './mapping.js';

const s = (entity_id: string, state: string, attributes: Record<string, unknown> = {}): HaState => ({ entity_id, state, attributes });

describe('HA entity mapping', () => {
  it('maps a colour-temperature light without RGB', () => {
    const d = mapEntity(s('light.a', 'on', { supported_color_modes: ['color_temp'], brightness: 128, color_temp_kelvin: 3000 }))!;
    expect(d.capabilities.map((c) => c.type)).toEqual(['onOff', 'brightness', 'colorTemperature']);
    expect(d.state).toMatchObject({ on: true, brightness: 50, colorTemperatureK: 3000 });
  });

  it('maps an on/off-only light without brightness', () => {
    const d = mapEntity(s('light.b', 'off', { supported_color_modes: ['onoff'] }))!;
    expect(d.capabilities.map((c) => c.type)).toEqual(['onOff']);
  });

  it('respects cover feature flags', () => {
    const d = mapEntity(s('cover.g', 'closed', { device_class: 'garage', supported_features: 3 }))!;
    expect(d.capabilities[0]).toMatchObject({ type: 'position', coverKind: 'garage', canSetPosition: false, canStop: false });
  });

  it('only exposes media features the player supports', () => {
    const d = mapEntity(s('media_player.x', 'playing', { supported_features: 1 | 16384, volume_level: 0.5 }))!;
    expect(d.capabilities.map((c) => c.type)).toEqual(['mediaPlayback']);
    expect(d.state).toMatchObject({ mediaState: 'playing', volume: 50 });
  });

  it('drops unsupported entities', () => {
    expect(mapEntity(s('sensor.text', 'Cloudy'))).toBeNull();
    expect(mapEntity(s('binary_sensor.update', 'on', { device_class: 'update' }))).toBeNull();
    expect(mapEntity(s('scene.x', 'scening'))).toBeNull();
  });

  it('maps safety binary sensors', () => {
    const d = mapEntity(s('binary_sensor.smoke', 'on', { device_class: 'smoke' }))!;
    expect(d.category).toBe('safety');
    expect(d.state.hazardDetected).toBe(true);
  });

  it('separates connectivity from state', () => {
    expect(mapConnectivity(s('light.a', 'unavailable'))).toBe('unavailable');
    expect(mapConnectivity(s('light.a', 'unknown'))).toBe('online');
    // unknown/unavailable never invent an on/off value
    expect(mapState(s('light.a', 'unavailable', { supported_color_modes: ['onoff'] })).on).toBeUndefined();
    expect(mapState(s('switch.a', 'unknown')).on).toBeUndefined();
  });

  it('normalises energy units', () => {
    expect(mapState(s('sensor.e', '1500', { device_class: 'energy', unit_of_measurement: 'Wh' })).energyKWh).toBe(1.5);
    expect(mapState(s('sensor.p', '1.2', { device_class: 'power', unit_of_measurement: 'kW' })).powerW).toBe(1200);
  });
});

describe('command → service translation', () => {
  it('uses documented services', () => {
    expect(commandToService('light.a', { capability: 'brightness', action: 'setBrightness', value: 30 })).toEqual({ domain: 'light', service: 'turn_on', data: { entity_id: 'light.a', brightness_pct: 30 } });
    expect(commandToService('light.a', { capability: 'brightness', action: 'setBrightness', value: 0 }).service).toBe('turn_off');
    expect(commandToService('climate.t', { capability: 'fanSpeed', action: 'setFanSpeed', speed: 'low' })).toMatchObject({ domain: 'climate', service: 'set_fan_mode' });
    expect(commandToService('fan.f', { capability: 'fanSpeed', action: 'setFanSpeed', speed: 40 })).toMatchObject({ domain: 'fan', service: 'set_percentage' });
    expect(commandToService('alarm_control_panel.a', { capability: 'alarmPanel', action: 'arm', mode: 'armed_away', code: '1' })).toMatchObject({ service: 'alarm_arm_away', data: { code: '1' } });
  });

  it('refuses actions HA does not expose generically', () => {
    expect(() => commandToService('camera.c', { capability: 'ptz', action: 'ptzMove', direction: 'left' })).toThrow(/not available/);
  });
});

describe('error mapping', () => {
  it('maps HTTP and transport errors', () => {
    expect(mapHaHttpError(401).code).toBe('integration_auth_failed');
    expect(mapHaHttpError(404).code).toBe('device_unavailable');
    expect(mapHaHttpError(503)).toMatchObject({ code: 'integration_error', retryable: true });
    expect(mapHaHttpError(null, { name: 'TimeoutError' }).code).toBe('integration_timeout');
    expect(mapHaHttpError(null, new Error('ECONNREFUSED')).code).toBe('integration_disconnected');
  });
});

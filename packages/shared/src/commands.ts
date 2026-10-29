import { z } from 'zod';
import {
  type Capability,
  type CapabilityType,
  type DeviceState,
  SENSITIVE_CAPABILITIES,
  hasCapability,
} from './capabilities.js';

/**
 * Every command the browser can send is one of these typed shapes.
 * There is no free-form "service call" — arbitrary commands are rejected.
 */
export const deviceCommandSchema = z.discriminatedUnion('action', [
  z.object({ capability: z.literal('onOff'), action: z.literal('turnOn') }),
  z.object({ capability: z.literal('onOff'), action: z.literal('turnOff') }),
  z.object({ capability: z.literal('brightness'), action: z.literal('setBrightness'), value: z.number().int().min(0).max(100) }),
  z.object({
    capability: z.literal('colorRgb'),
    action: z.literal('setColor'),
    rgb: z.tuple([z.number().int().min(0).max(255), z.number().int().min(0).max(255), z.number().int().min(0).max(255)]),
  }),
  z.object({ capability: z.literal('colorTemperature'), action: z.literal('setColorTemperature'), kelvin: z.number().int().min(1000).max(10000) }),
  z.object({ capability: z.literal('temperatureSetpoint'), action: z.literal('setTargetTemperature'), value: z.number().min(-20).max(100) }),
  z.object({ capability: z.literal('hvacMode'), action: z.literal('setHvacMode'), mode: z.string().min(1).max(32) }),
  z.object({ capability: z.literal('fanSpeed'), action: z.literal('setFanSpeed'), speed: z.union([z.string().min(1).max(32), z.number().int().min(0).max(100)]) }),
  z.object({ capability: z.literal('swing'), action: z.literal('setSwingMode'), mode: z.string().min(1).max(32) }),
  z.object({ capability: z.literal('position'), action: z.literal('open') }),
  z.object({ capability: z.literal('position'), action: z.literal('close') }),
  z.object({ capability: z.literal('position'), action: z.literal('stop') }),
  z.object({ capability: z.literal('position'), action: z.literal('setPosition'), value: z.number().int().min(0).max(100) }),
  z.object({ capability: z.literal('lock'), action: z.literal('lock') }),
  z.object({ capability: z.literal('lock'), action: z.literal('unlock') }),
  z.object({ capability: z.literal('alarmPanel'), action: z.literal('arm'), mode: z.enum(['armed_home', 'armed_away', 'armed_night']), code: z.string().max(16).optional() }),
  z.object({ capability: z.literal('alarmPanel'), action: z.literal('disarm'), code: z.string().max(16).optional() }),
  z.object({ capability: z.literal('mediaPlayback'), action: z.literal('mediaCommand'), command: z.enum(['play', 'pause', 'stop', 'next', 'previous']) }),
  z.object({ capability: z.literal('volume'), action: z.literal('setVolume'), value: z.number().int().min(0).max(100) }),
  z.object({ capability: z.literal('volume'), action: z.literal('setMuted'), muted: z.boolean() }),
  z.object({ capability: z.literal('mediaSource'), action: z.literal('selectSource'), source: z.string().min(1).max(64) }),
  z.object({ capability: z.literal('ptz'), action: z.literal('ptzMove'), direction: z.enum(['left', 'right', 'up', 'down', 'zoomIn', 'zoomOut']) }),
  z.object({ capability: z.literal('motionDetectionToggle'), action: z.literal('setMotionDetection'), enabled: z.boolean() }),
  z.object({ capability: z.literal('vacuum'), action: z.literal('vacuumCommand'), command: z.enum(['start', 'pause', 'returnToBase', 'locate']) }),
  z.object({ capability: z.literal('valve'), action: z.literal('openValve') }),
  z.object({ capability: z.literal('valve'), action: z.literal('closeValve') }),
  z.object({ capability: z.literal('customAction'), action: z.literal('custom'), actionId: z.string().min(1).max(64) }),
]);

export type DeviceCommand = z.infer<typeof deviceCommandSchema>;
export type DeviceCommandAction = DeviceCommand['action'];

export const COMMAND_STATUSES = ['pending', 'sent', 'confirmed', 'failed', 'timed_out'] as const;
export type CommandStatus = (typeof COMMAND_STATUSES)[number];
export const TERMINAL_COMMAND_STATUSES: ReadonlySet<CommandStatus> = new Set(['confirmed', 'failed', 'timed_out']);

export const createCommandRequestSchema = z.object({
  command: deviceCommandSchema,
  /** Client-generated key; repeated submissions with the same key return the original command. */
  idempotencyKey: z.string().min(8).max(100).optional(),
  /** Required to be true for sensitive commands (unlock, disarm, …). */
  confirmed: z.boolean().optional(),
});
export type CreateCommandRequest = z.infer<typeof createCommandRequestSchema>;

export type CommandValidationResult = { ok: true } | { ok: false; code: CommandErrorCode; message: string };

export const COMMAND_ERROR_CODES = [
  'unsupported_capability',
  'invalid_argument',
  'device_unavailable',
  'integration_disconnected',
  'integration_auth_failed',
  'integration_timeout',
  'integration_error',
  'confirmation_required',
  'forbidden',
  'rate_limited',
  'not_confirmed',
] as const;
export type CommandErrorCode = (typeof COMMAND_ERROR_CODES)[number];

/** Validate a command against the capabilities the device actually declares. */
export function validateCommandForCapabilities(cmd: DeviceCommand, caps: readonly Capability[]): CommandValidationResult {
  const cap = caps.find((c) => c.type === cmd.capability);
  if (!cap) {
    return { ok: false, code: 'unsupported_capability', message: `This device does not support "${cmd.capability}".` };
  }
  switch (cmd.action) {
    case 'setTargetTemperature': {
      const c = hasCapability(caps, 'temperatureSetpoint')!;
      if (cmd.value < c.min || cmd.value > c.max) {
        return { ok: false, code: 'invalid_argument', message: `Target temperature must be between ${c.min} and ${c.max}.` };
      }
      return { ok: true };
    }
    case 'setHvacMode': {
      const c = hasCapability(caps, 'hvacMode')!;
      if (!(c.modes as readonly string[]).includes(cmd.mode)) {
        return { ok: false, code: 'invalid_argument', message: `Mode "${cmd.mode}" is not supported by this device.` };
      }
      return { ok: true };
    }
    case 'setFanSpeed': {
      const c = hasCapability(caps, 'fanSpeed')!;
      if (c.presets && typeof cmd.speed === 'string' && !c.presets.includes(cmd.speed)) {
        return { ok: false, code: 'invalid_argument', message: `Fan speed "${cmd.speed}" is not supported.` };
      }
      if (!c.presets && typeof cmd.speed === 'string') {
        return { ok: false, code: 'invalid_argument', message: 'This fan expects a percentage speed.' };
      }
      return { ok: true };
    }
    case 'setSwingMode': {
      const c = hasCapability(caps, 'swing')!;
      if (!c.modes.includes(cmd.mode)) return { ok: false, code: 'invalid_argument', message: `Swing mode "${cmd.mode}" is not supported.` };
      return { ok: true };
    }
    case 'setColorTemperature': {
      const c = hasCapability(caps, 'colorTemperature')!;
      if (cmd.kelvin < c.minKelvin || cmd.kelvin > c.maxKelvin) {
        return { ok: false, code: 'invalid_argument', message: `Colour temperature must be between ${c.minKelvin}K and ${c.maxKelvin}K.` };
      }
      return { ok: true };
    }
    case 'setPosition': {
      const c = hasCapability(caps, 'position')!;
      if (!c.canSetPosition) return { ok: false, code: 'unsupported_capability', message: 'This cover only supports open and close.' };
      return { ok: true };
    }
    case 'stop': {
      const c = hasCapability(caps, 'position')!;
      if (!c.canStop) return { ok: false, code: 'unsupported_capability', message: 'This cover cannot be stopped mid-travel.' };
      return { ok: true };
    }
    case 'arm': {
      const c = hasCapability(caps, 'alarmPanel')!;
      if (!c.armModes.includes(cmd.mode)) return { ok: false, code: 'invalid_argument', message: `Arm mode "${cmd.mode}" is not supported.` };
      return { ok: true };
    }
    case 'mediaCommand': {
      const c = hasCapability(caps, 'mediaPlayback')!;
      if (!c.features.includes(cmd.command)) return { ok: false, code: 'unsupported_capability', message: `"${cmd.command}" is not supported by this player.` };
      return { ok: true };
    }
    case 'setMuted': {
      const c = hasCapability(caps, 'volume')!;
      if (!c.canMute) return { ok: false, code: 'unsupported_capability', message: 'This device cannot be muted.' };
      return { ok: true };
    }
    case 'selectSource': {
      const c = hasCapability(caps, 'mediaSource')!;
      if (!c.sources.includes(cmd.source)) return { ok: false, code: 'invalid_argument', message: `Source "${cmd.source}" is not available.` };
      return { ok: true };
    }
    case 'ptzMove': {
      const c = hasCapability(caps, 'ptz')!;
      const axis = cmd.direction === 'left' || cmd.direction === 'right' ? 'pan' : cmd.direction === 'up' || cmd.direction === 'down' ? 'tilt' : 'zoom';
      if (!c[axis]) return { ok: false, code: 'unsupported_capability', message: `This camera does not support ${axis}.` };
      return { ok: true };
    }
    case 'vacuumCommand': {
      const c = hasCapability(caps, 'vacuum')!;
      if (cmd.command === 'locate' && !c.canLocate) return { ok: false, code: 'unsupported_capability', message: 'Locate is not supported.' };
      return { ok: true };
    }
    case 'custom': {
      const c = hasCapability(caps, 'customAction')!;
      if (!c.actions.some((a) => a.id === cmd.actionId)) return { ok: false, code: 'invalid_argument', message: 'Unknown device action.' };
      return { ok: true };
    }
    default:
      return { ok: true };
  }
}

/** Whether a command touches physical security and therefore needs elevated permission + confirmation. */
export function isSensitiveCommand(cmd: DeviceCommand, caps: readonly Capability[] = []): boolean {
  if (cmd.action === 'unlock' || cmd.action === 'disarm') return true;
  if (SENSITIVE_CAPABILITIES.has(cmd.capability as CapabilityType)) return true;
  if (cmd.action === 'open' || cmd.action === 'setPosition') {
    const pos = hasCapability(caps, 'position');
    if (pos && (pos.coverKind === 'garage' || pos.coverKind === 'gate')) return true;
  }
  if (cmd.action === 'custom') {
    const c = hasCapability(caps, 'customAction');
    return !!c?.actions.find((a) => a.id === cmd.actionId)?.sensitive;
  }
  return false;
}

/**
 * Given a command, return a predicate that decides whether a reported device
 * state confirms the command reached its requested state. `null` means the
 * command is momentary (e.g. "next track", PTZ nudge) and cannot be verified
 * by state read-back — those are confirmed by integration acknowledgement only,
 * and the UI labels them "Acknowledged".
 */
export function expectedStateMatcher(cmd: DeviceCommand): ((s: DeviceState) => boolean) | null {
  switch (cmd.action) {
    case 'turnOn':
      return (s) => s.on === true;
    case 'turnOff':
      return (s) => s.on === false;
    case 'setBrightness':
      return (s) => s.brightness !== undefined && Math.abs(s.brightness - cmd.value) <= 2 && (cmd.value === 0 || s.on !== false);
    case 'setColor':
      return (s) => !!s.colorRgb && s.colorRgb.every((v, i) => Math.abs(v - cmd.rgb[i]!) <= 6);
    case 'setColorTemperature':
      return (s) => s.colorTemperatureK !== undefined && Math.abs(s.colorTemperatureK - cmd.kelvin) <= 60;
    case 'setTargetTemperature':
      return (s) => s.targetTemperature !== undefined && Math.abs(s.targetTemperature - cmd.value) < 0.26;
    case 'setHvacMode':
      return (s) => s.hvacMode === cmd.mode;
    case 'setFanSpeed':
      return (s) => s.fanSpeed !== undefined && String(s.fanSpeed) === String(cmd.speed);
    case 'setSwingMode':
      return (s) => s.swingMode === cmd.mode;
    case 'open':
      return (s) => s.coverState === 'open' || (s.position !== undefined && s.position >= 99);
    case 'close':
      return (s) => s.coverState === 'closed' || (s.position !== undefined && s.position <= 1);
    case 'setPosition':
      return (s) => s.position !== undefined && Math.abs(s.position - cmd.value) <= 2;
    case 'stop':
      return (s) => s.coverState === 'stopped' || s.coverState === 'open' || s.coverState === 'closed';
    case 'lock':
      return (s) => s.lockState === 'locked' || s.locked === true;
    case 'unlock':
      return (s) => s.lockState === 'unlocked' || s.locked === false;
    case 'arm':
      return (s) => s.alarmState === cmd.mode;
    case 'disarm':
      return (s) => s.alarmState === 'disarmed';
    case 'setVolume':
      return (s) => s.volume !== undefined && Math.abs(s.volume - cmd.value) <= 2;
    case 'setMuted':
      return (s) => s.muted === cmd.muted;
    case 'selectSource':
      return (s) => s.mediaSource === cmd.source;
    case 'mediaCommand':
      if (cmd.command === 'play') return (s) => s.mediaState === 'playing';
      if (cmd.command === 'pause') return (s) => s.mediaState === 'paused';
      if (cmd.command === 'stop') return (s) => s.mediaState === 'idle' || s.mediaState === 'off';
      return null;
    case 'setMotionDetection':
      return (s) => s.motionDetectionEnabled === cmd.enabled;
    case 'vacuumCommand':
      if (cmd.command === 'start') return (s) => s.vacuumState === 'cleaning';
      if (cmd.command === 'pause') return (s) => s.vacuumState === 'paused';
      if (cmd.command === 'returnToBase') return (s) => s.vacuumState === 'returning' || s.vacuumState === 'docked';
      return null;
    case 'openValve':
      return (s) => s.valveOpen === true;
    case 'closeValve':
      return (s) => s.valveOpen === false;
    case 'ptzMove':
    case 'custom':
      return null;
  }
}

/** Human-readable description, used in activity entries and toasts. */
export function describeCommand(cmd: DeviceCommand): string {
  switch (cmd.action) {
    case 'turnOn':
      return 'Turn on';
    case 'turnOff':
      return 'Turn off';
    case 'setBrightness':
      return `Set brightness to ${cmd.value}%`;
    case 'setColor':
      return `Set colour to rgb(${cmd.rgb.join(', ')})`;
    case 'setColorTemperature':
      return `Set colour temperature to ${cmd.kelvin}K`;
    case 'setTargetTemperature':
      return `Set target temperature to ${cmd.value}°`;
    case 'setHvacMode':
      return `Set mode to ${cmd.mode.replace('_', ' ')}`;
    case 'setFanSpeed':
      return `Set fan speed to ${cmd.speed}${typeof cmd.speed === 'number' ? '%' : ''}`;
    case 'setSwingMode':
      return `Set swing to ${cmd.mode}`;
    case 'open':
      return 'Open';
    case 'close':
      return 'Close';
    case 'stop':
      return 'Stop';
    case 'setPosition':
      return `Set position to ${cmd.value}%`;
    case 'lock':
      return 'Lock';
    case 'unlock':
      return 'Unlock';
    case 'arm':
      return `Arm (${cmd.mode.replace('armed_', '')})`;
    case 'disarm':
      return 'Disarm';
    case 'mediaCommand':
      return cmd.command[0]!.toUpperCase() + cmd.command.slice(1);
    case 'setVolume':
      return `Set volume to ${cmd.value}%`;
    case 'setMuted':
      return cmd.muted ? 'Mute' : 'Unmute';
    case 'selectSource':
      return `Select source ${cmd.source}`;
    case 'ptzMove':
      return `Move camera ${cmd.direction}`;
    case 'setMotionDetection':
      return cmd.enabled ? 'Enable motion detection' : 'Disable motion detection';
    case 'vacuumCommand':
      return { start: 'Start cleaning', pause: 'Pause cleaning', returnToBase: 'Return to dock', locate: 'Locate' }[cmd.command];
    case 'openValve':
      return 'Open valve';
    case 'closeValve':
      return 'Close valve';
    case 'custom':
      return `Run action ${cmd.actionId}`;
  }
}

/** Strip secrets (alarm codes) before persisting or logging a command. */
export function redactCommand(cmd: DeviceCommand): DeviceCommand {
  if ((cmd.action === 'arm' || cmd.action === 'disarm') && cmd.code) return { ...cmd, code: '••••' };
  return cmd;
}

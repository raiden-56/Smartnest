import { useMemo } from 'react';
import { Autocomplete, Box, Chip, FormControl, InputLabel, MenuItem, Select, Stack, Switch, FormControlLabel, TextField, Typography } from '@mui/material';
import { ShieldAlert } from 'lucide-react';
import {
  ALARM_STATES, describeCommand, hasCapability, isSensitiveCommand, type AutomationAction, type AutomationCondition, type Capability, type DeviceCommand,
  type DeviceDto, NUMERIC_ATTRIBUTES, WATCHABLE_ATTRIBUTES,
} from '@smartnest/shared';
import { useDevicesQuery } from '../../api/api';
import { AppIcon, deviceIconName } from '../../components/common/AppIcon';
import { tokens } from '../../theme/theme';

// ─── Devices (paged: the API caps pageSize at 100) ──────────────────────────

export function useAllDevices(homeId: string) {
  const base = { homeId, pageSize: 100, sort: 'name' as const, includeHidden: 'true' as const };
  const p1 = useDevicesQuery({ ...base, page: 1 });
  const total = p1.data?.total ?? 0;
  const p2 = useDevicesQuery({ ...base, page: 2 }, { skip: total <= 100 });
  const p3 = useDevicesQuery({ ...base, page: 3 }, { skip: total <= 200 });
  const p4 = useDevicesQuery({ ...base, page: 4 }, { skip: total <= 300 });
  const p5 = useDevicesQuery({ ...base, page: 5 }, { skip: total <= 400 });
  const devices = useMemo(
    () => [p1, p2, p3, p4, p5].flatMap((p) => p.data?.items ?? []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [p1.data, p2.data, p3.data, p4.data, p5.data],
  );
  const byId = useMemo(() => new Map(devices.map((d) => [d.id, d])), [devices]);
  return { devices, byId, isLoading: p1.isLoading, error: p1.error };
}

export function DeviceSelect({
  devices, value, onChange, label = 'Device', filter, size = 'small',
}: { devices: DeviceDto[]; value: string; onChange: (id: string) => void; label?: string; filter?: (d: DeviceDto) => boolean; size?: 'small' | 'medium' }) {
  const options = filter ? devices.filter(filter) : devices;
  const selected = devices.find((d) => d.id === value) ?? null;
  return (
    <Autocomplete
      size={size}
      options={options}
      value={selected}
      onChange={(_, d) => d && onChange(d.id)}
      getOptionLabel={(d) => d.name}
      isOptionEqualToValue={(a, b) => a.id === b.id}
      groupBy={(d) => d.roomName ?? 'No room'}
      renderOption={(props, d) => {
        const { key, ...rest } = props as typeof props & { key: string };
        return (
          <Box component="li" key={key} {...rest} sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
            <AppIcon name={deviceIconName(d.deviceType, d.category)} size={16} />
            <span>{d.name}</span>
            {d.connectivity !== 'online' && (
              <Typography variant="caption" sx={{ ml: 'auto' }}>
                {d.connectivity}
              </Typography>
            )}
          </Box>
        );
      }}
      renderInput={(params) => <TextField {...params} label={label} error={!!value && !selected} helperText={value && !selected ? 'Device no longer exists' : undefined} />}
      sx={{ minWidth: { xs: '100%', sm: 220 }, flex: 1 }}
    />
  );
}

// ─── Attributes automations can watch, filtered to what a device declares ──

type Watchable = (typeof WATCHABLE_ATTRIBUTES)[number];
type NumericAttr = (typeof NUMERIC_ATTRIBUTES)[number];

const WATCHABLE_CAP: Record<Watchable, Capability['type']> = {
  on: 'onOff', motion: 'motion', contactOpen: 'contact', occupied: 'occupancy', present: 'presence', hazardDetected: 'safetyAlarm', lockState: 'lock',
  alarmState: 'alarmPanel', coverState: 'position', hvacMode: 'hvacMode', mediaState: 'mediaPlayback', vacuumState: 'vacuum', valveOpen: 'valve', charging: 'charging',
};

export const ATTRIBUTE_LABEL: Record<string, string> = {
  on: 'Power', motion: 'Motion', contactOpen: 'Door / window open', occupied: 'Occupancy', present: 'Presence', hazardDetected: 'Hazard detected',
  lockState: 'Lock state', alarmState: 'Alarm state', coverState: 'Cover state', hvacMode: 'HVAC mode', mediaState: 'Media state', vacuumState: 'Vacuum state',
  valveOpen: 'Valve open', charging: 'Charging', currentTemperature: 'Current temperature', targetTemperature: 'Target temperature', brightness: 'Brightness',
  batteryLevel: 'Battery level', powerW: 'Power (W)', energyKWh: 'Energy (kWh)', position: 'Position', volume: 'Volume', measurement: 'Sensor reading',
};

export function watchableFor(device: DeviceDto | undefined): Watchable[] {
  if (!device) return [];
  return WATCHABLE_ATTRIBUTES.filter((a) => device.capabilities.some((c) => c.type === WATCHABLE_CAP[a]));
}

/** Allowed values for a watched attribute. `null` = boolean attribute. */
export function attributeValues(device: DeviceDto | undefined, attr: string): { value: string | boolean; label: string }[] {
  const bool = (t: string, f: string) => [{ value: true, label: t }, { value: false, label: f }];
  switch (attr) {
    case 'on': return bool('On', 'Off');
    case 'motion': return bool('Motion detected', 'No motion');
    case 'contactOpen': return bool('Open', 'Closed');
    case 'occupied': return bool('Occupied', 'Clear');
    case 'present': return bool('Home', 'Away');
    case 'hazardDetected': return bool('Hazard detected', 'Clear');
    case 'valveOpen': return bool('Open', 'Closed');
    case 'charging': return bool('Charging', 'Not charging');
    case 'lockState': return ['locked', 'unlocked', 'jammed'].map((v) => ({ value: v, label: v }));
    case 'alarmState': return ALARM_STATES.map((v) => ({ value: v, label: v.replace('_', ' ') }));
    case 'coverState': return ['open', 'closed', 'opening', 'closing', 'stopped'].map((v) => ({ value: v, label: v }));
    case 'hvacMode': return (hasCapability(device?.capabilities ?? [], 'hvacMode')?.modes ?? []).map((v) => ({ value: v, label: v.replace('_', ' ') }));
    case 'mediaState': return ['playing', 'paused', 'idle', 'off'].map((v) => ({ value: v, label: v }));
    case 'vacuumState': return ['cleaning', 'docked', 'returning', 'paused', 'idle', 'error'].map((v) => ({ value: v, label: v }));
    default: return [];
  }
}

const NUMERIC_CAP: Partial<Record<NumericAttr, Capability['type']>> = {
  currentTemperature: 'temperatureSetpoint', targetTemperature: 'temperatureSetpoint', brightness: 'brightness', batteryLevel: 'battery', powerW: 'power',
  energyKWh: 'energy', position: 'position', volume: 'volume',
};

export interface NumericOption { attribute: NumericAttr; measurementKey?: string; label: string; unit?: string }

export function numericOptionsFor(device: DeviceDto | undefined): NumericOption[] {
  if (!device) return [];
  const out: NumericOption[] = [];
  for (const a of NUMERIC_ATTRIBUTES) {
    if (a === 'measurement') continue;
    const cap = NUMERIC_CAP[a];
    if (cap && device.capabilities.some((c) => c.type === cap)) out.push({ attribute: a, label: ATTRIBUTE_LABEL[a] ?? a });
  }
  for (const c of device.capabilities) {
    if (c.type === 'sensor') out.push({ attribute: 'measurement', measurementKey: c.key, label: c.label ?? c.measurement.replace('_', ' '), unit: c.unit });
  }
  return out;
}

export const numericKey = (o: { attribute: string; measurementKey?: string }) => (o.attribute === 'measurement' ? `measurement:${o.measurementKey ?? ''}` : o.attribute);

// ─── Command builder: only offers commands the device declares ─────────────

interface CmdOption {
  id: string;
  label: string;
  make: (d: DeviceDto) => DeviceCommand;
}

export function commandOptions(device: DeviceDto | undefined): CmdOption[] {
  if (!device) return [];
  const out: CmdOption[] = [];
  for (const c of device.capabilities) {
    switch (c.type) {
      case 'onOff':
        out.push({ id: 'turnOn', label: 'Turn on', make: () => ({ capability: 'onOff', action: 'turnOn' }) });
        out.push({ id: 'turnOff', label: 'Turn off', make: () => ({ capability: 'onOff', action: 'turnOff' }) });
        break;
      case 'brightness':
        out.push({ id: 'setBrightness', label: 'Set brightness', make: () => ({ capability: 'brightness', action: 'setBrightness', value: 60 }) });
        break;
      case 'colorRgb':
        out.push({ id: 'setColor', label: 'Set colour', make: () => ({ capability: 'colorRgb', action: 'setColor', rgb: [242, 140, 40] }) });
        break;
      case 'colorTemperature':
        out.push({ id: 'setColorTemperature', label: 'Set colour temperature', make: () => ({ capability: 'colorTemperature', action: 'setColorTemperature', kelvin: Math.round((c.minKelvin + c.maxKelvin) / 2 / 50) * 50 }) });
        break;
      case 'temperatureSetpoint':
        out.push({ id: 'setTargetTemperature', label: 'Set target temperature', make: () => ({ capability: 'temperatureSetpoint', action: 'setTargetTemperature', value: Math.min(c.max, Math.max(c.min, 21)) }) });
        break;
      case 'hvacMode':
        out.push({ id: 'setHvacMode', label: 'Set mode', make: () => ({ capability: 'hvacMode', action: 'setHvacMode', mode: c.modes[0]! }) });
        break;
      case 'fanSpeed':
        out.push({ id: 'setFanSpeed', label: 'Set fan speed', make: () => ({ capability: 'fanSpeed', action: 'setFanSpeed', speed: c.presets?.[0] ?? 50 }) });
        break;
      case 'swing':
        out.push({ id: 'setSwingMode', label: 'Set swing', make: () => ({ capability: 'swing', action: 'setSwingMode', mode: c.modes[0]! }) });
        break;
      case 'position':
        out.push({ id: 'open', label: 'Open', make: () => ({ capability: 'position', action: 'open' }) });
        out.push({ id: 'close', label: 'Close', make: () => ({ capability: 'position', action: 'close' }) });
        if (c.canStop) out.push({ id: 'stop', label: 'Stop', make: () => ({ capability: 'position', action: 'stop' }) });
        if (c.canSetPosition) out.push({ id: 'setPosition', label: 'Set position', make: () => ({ capability: 'position', action: 'setPosition', value: 50 }) });
        break;
      case 'lock':
        out.push({ id: 'lock', label: 'Lock', make: () => ({ capability: 'lock', action: 'lock' }) });
        out.push({ id: 'unlock', label: 'Unlock', make: () => ({ capability: 'lock', action: 'unlock' }) });
        break;
      case 'alarmPanel':
        for (const m of c.armModes) out.push({ id: `arm:${m}`, label: `Arm (${m.replace('armed_', '')})`, make: () => ({ capability: 'alarmPanel', action: 'arm', mode: m }) });
        out.push({ id: 'disarm', label: 'Disarm', make: () => ({ capability: 'alarmPanel', action: 'disarm' }) });
        break;
      case 'mediaPlayback':
        for (const f of c.features) out.push({ id: `media:${f}`, label: f[0]!.toUpperCase() + f.slice(1), make: () => ({ capability: 'mediaPlayback', action: 'mediaCommand', command: f }) });
        break;
      case 'volume':
        out.push({ id: 'setVolume', label: 'Set volume', make: () => ({ capability: 'volume', action: 'setVolume', value: 30 }) });
        if (c.canMute) {
          out.push({ id: 'mute', label: 'Mute', make: () => ({ capability: 'volume', action: 'setMuted', muted: true }) });
          out.push({ id: 'unmute', label: 'Unmute', make: () => ({ capability: 'volume', action: 'setMuted', muted: false }) });
        }
        break;
      case 'mediaSource':
        out.push({ id: 'selectSource', label: 'Select source', make: () => ({ capability: 'mediaSource', action: 'selectSource', source: c.sources[0]! }) });
        break;
      case 'ptz': {
        const dirs = [...(c.pan ? (['left', 'right'] as const) : []), ...(c.tilt ? (['up', 'down'] as const) : []), ...(c.zoom ? (['zoomIn', 'zoomOut'] as const) : [])];
        if (dirs.length) out.push({ id: 'ptzMove', label: 'Move camera', make: () => ({ capability: 'ptz', action: 'ptzMove', direction: dirs[0]! }) });
        break;
      }
      case 'motionDetectionToggle':
        out.push({ id: 'motionOn', label: 'Enable motion detection', make: () => ({ capability: 'motionDetectionToggle', action: 'setMotionDetection', enabled: true }) });
        out.push({ id: 'motionOff', label: 'Disable motion detection', make: () => ({ capability: 'motionDetectionToggle', action: 'setMotionDetection', enabled: false }) });
        break;
      case 'vacuum':
        out.push({ id: 'vac:start', label: 'Start cleaning', make: () => ({ capability: 'vacuum', action: 'vacuumCommand', command: 'start' }) });
        out.push({ id: 'vac:pause', label: 'Pause cleaning', make: () => ({ capability: 'vacuum', action: 'vacuumCommand', command: 'pause' }) });
        out.push({ id: 'vac:returnToBase', label: 'Return to dock', make: () => ({ capability: 'vacuum', action: 'vacuumCommand', command: 'returnToBase' }) });
        if (c.canLocate) out.push({ id: 'vac:locate', label: 'Locate', make: () => ({ capability: 'vacuum', action: 'vacuumCommand', command: 'locate' }) });
        break;
      case 'valve':
        out.push({ id: 'openValve', label: 'Open valve', make: () => ({ capability: 'valve', action: 'openValve' }) });
        out.push({ id: 'closeValve', label: 'Close valve', make: () => ({ capability: 'valve', action: 'closeValve' }) });
        break;
      case 'customAction':
        for (const a of c.actions) out.push({ id: `custom:${a.id}`, label: a.label, make: () => ({ capability: 'customAction', action: 'custom', actionId: a.id }) });
        break;
    }
  }
  return out;
}

export function optionIdOf(cmd: DeviceCommand | undefined): string {
  if (!cmd) return '';
  switch (cmd.action) {
    case 'arm': return `arm:${cmd.mode}`;
    case 'mediaCommand': return `media:${cmd.command}`;
    case 'setMuted': return cmd.muted ? 'mute' : 'unmute';
    case 'setMotionDetection': return cmd.enabled ? 'motionOn' : 'motionOff';
    case 'vacuumCommand': return `vac:${cmd.command}`;
    case 'custom': return `custom:${cmd.actionId}`;
    default: return cmd.action;
  }
}

function num(v: string, fallback: number) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/** Parameter inputs for the selected command. */
function CommandParams({ device, cmd, onChange }: { device: DeviceDto; cmd: DeviceCommand; onChange: (c: DeviceCommand) => void }) {
  const caps = device.capabilities;
  const field = (label: string, value: number, set: (n: number) => void, min?: number, max?: number, step?: number, suffix?: string) => (
    <TextField
      size="small"
      type="number"
      label={label}
      value={value}
      onChange={(e) => set(num(e.target.value, value))}
      inputProps={{ min, max, step }}
      InputProps={suffix ? { endAdornment: <Typography variant="caption">{suffix}</Typography> } : undefined}
      sx={{ width: { xs: '100%', sm: 160 } }}
    />
  );
  const select = (label: string, value: string, options: string[], set: (v: string) => void) => (
    <FormControl size="small" sx={{ minWidth: 160, width: { xs: '100%', sm: 'auto' } }}>
      <InputLabel>{label}</InputLabel>
      <Select label={label} value={value} onChange={(e) => set(String(e.target.value))}>
        {options.map((o) => (
          <MenuItem key={o} value={o} sx={{ textTransform: 'capitalize' }}>
            {o.replace('_', ' ')}
          </MenuItem>
        ))}
      </Select>
    </FormControl>
  );
  switch (cmd.action) {
    case 'setBrightness':
      return field('Brightness', cmd.value, (value) => onChange({ ...cmd, value: Math.max(0, Math.min(100, Math.round(value))) }), 0, 100, 1, '%');
    case 'setPosition':
      return field('Position', cmd.value, (value) => onChange({ ...cmd, value: Math.max(0, Math.min(100, Math.round(value))) }), 0, 100, 1, '%');
    case 'setVolume':
      return field('Volume', cmd.value, (value) => onChange({ ...cmd, value: Math.max(0, Math.min(100, Math.round(value))) }), 0, 100, 1, '%');
    case 'setTargetTemperature': {
      const c = hasCapability(caps, 'temperatureSetpoint');
      return field('Target', cmd.value, (value) => onChange({ ...cmd, value }), c?.min, c?.max, c?.step, `°${c?.unit ?? 'C'}`);
    }
    case 'setColorTemperature': {
      const c = hasCapability(caps, 'colorTemperature');
      return field('Kelvin', cmd.kelvin, (kelvin) => onChange({ ...cmd, kelvin: Math.round(kelvin) }), c?.minKelvin, c?.maxKelvin, 50, 'K');
    }
    case 'setColor': {
      const hex = `#${cmd.rgb.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
      return (
        <TextField
          size="small"
          type="color"
          label="Colour"
          value={hex}
          onChange={(e) => {
            const h = e.target.value;
            onChange({ ...cmd, rgb: [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)] });
          }}
          sx={{ width: 120 }}
        />
      );
    }
    case 'setHvacMode':
      return select('Mode', cmd.mode, hasCapability(caps, 'hvacMode')?.modes ?? [], (mode) => onChange({ ...cmd, mode }));
    case 'setSwingMode':
      return select('Swing', cmd.mode, hasCapability(caps, 'swing')?.modes ?? [], (mode) => onChange({ ...cmd, mode }));
    case 'selectSource':
      return select('Source', cmd.source, hasCapability(caps, 'mediaSource')?.sources ?? [], (source) => onChange({ ...cmd, source }));
    case 'setFanSpeed': {
      const c = hasCapability(caps, 'fanSpeed');
      if (c?.presets) return select('Speed', String(cmd.speed), c.presets, (speed) => onChange({ ...cmd, speed }));
      return field('Speed', typeof cmd.speed === 'number' ? cmd.speed : 50, (speed) => onChange({ ...cmd, speed: Math.max(0, Math.min(100, Math.round(speed))) }), 0, 100, 1, '%');
    }
    case 'ptzMove': {
      const c = hasCapability(caps, 'ptz');
      const dirs = [...(c?.pan ? ['left', 'right'] : []), ...(c?.tilt ? ['up', 'down'] : []), ...(c?.zoom ? ['zoomIn', 'zoomOut'] : [])];
      return select('Direction', cmd.direction, dirs, (direction) => onChange({ ...cmd, direction: direction as typeof cmd.direction }));
    }
    case 'arm':
    case 'disarm':
      return hasCapability(caps, 'alarmPanel')?.codeRequired ? (
        <TextField
          size="small"
          type="password"
          label="Alarm code"
          value={cmd.code ?? ''}
          onChange={(e) => onChange({ ...cmd, code: e.target.value || undefined })}
          helperText="Stored with the rule"
          autoComplete="off"
          sx={{ width: { xs: '100%', sm: 160 } }}
        />
      ) : null;
    default:
      return null;
  }
}

/** Pick a device and a command it actually supports. Used by scenes and automations. */
export function CommandBuilder({
  devices, deviceId, command, onChange, deviceFilter,
}: {
  devices: DeviceDto[];
  deviceId: string;
  command: DeviceCommand | undefined;
  onChange: (deviceId: string, command: DeviceCommand) => void;
  deviceFilter?: (d: DeviceDto) => boolean;
}) {
  const device = devices.find((d) => d.id === deviceId);
  const options = commandOptions(device);
  const currentId = optionIdOf(command);
  const controllable = (d: DeviceDto) => commandOptions(d).length > 0 && (deviceFilter ? deviceFilter(d) : true);
  const sensitive = command && device ? isSensitiveCommand(command, device.capabilities) : false;
  const supported = !!options.find((o) => o.id === currentId);
  return (
    <Stack spacing={1} sx={{ minWidth: 0, flex: 1 }}>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ xs: 'stretch', sm: 'center' }} flexWrap="wrap" useFlexGap>
        <DeviceSelect
          devices={devices}
          value={deviceId}
          filter={controllable}
          onChange={(id) => {
            const d = devices.find((x) => x.id === id);
            const first = commandOptions(d)[0];
            if (d && first) onChange(id, first.make(d));
          }}
        />
        {device && (
          <FormControl size="small" sx={{ minWidth: 180, width: { xs: '100%', sm: 'auto' } }} error={!!command && !supported}>
            <InputLabel id={`cmd-${deviceId}`}>Action</InputLabel>
            <Select
              labelId={`cmd-${deviceId}`}
              label="Action"
              value={supported ? currentId : ''}
              onChange={(e) => {
                const opt = options.find((o) => o.id === e.target.value);
                if (opt) onChange(deviceId, opt.make(device));
              }}
            >
              {options.map((o) => (
                <MenuItem key={o.id} value={o.id}>
                  {o.label}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        )}
        {device && command && supported && <CommandParams device={device} cmd={command} onChange={(c) => onChange(deviceId, c)} />}
      </Stack>
      {device && command && !supported && (
        <Typography variant="caption" color="error">
          “{describeCommand(command)}” is not supported by {device.name}. Choose another action.
        </Typography>
      )}
      {sensitive && (
        <Chip
          size="small"
          icon={<ShieldAlert size={14} />}
          label="Security-sensitive action"
          sx={{ alignSelf: 'flex-start', bgcolor: '#F8EEDC', color: tokens.color.warning, '& .MuiChip-icon': { color: 'inherit' } }}
        />
      )}
    </Stack>
  );
}

export function LabeledSwitch({ checked, onChange, label, description }: { checked: boolean; onChange: (v: boolean) => void; label: string; description?: string }) {
  return (
    <Box>
      <FormControlLabel control={<Switch checked={checked} onChange={(e) => onChange(e.target.checked)} />} label={label} />
      {description && (
        <Typography variant="caption" component="p" sx={{ ml: 7, mt: -0.5 }}>
          {description}
        </Typography>
      )}
    </Box>
  );
}

// ─── Plain-language descriptions ───────────────────────────────────────────

export function describeCondition(c: AutomationCondition, name: (id: string) => string, roomName: (id: string) => string = (x) => x): string {
  switch (c.type) {
    case 'timeWindow':
      return `Between ${c.after} and ${c.before}${c.days && c.days.length < 7 ? ` on ${c.days.map((d) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d]).join(', ')}` : ''}`;
    case 'deviceState':
      return `${name(c.deviceId)} ${ATTRIBUTE_LABEL[c.attribute]?.toLowerCase() ?? c.attribute} is ${String(c.equals)}`;
    case 'numericState':
      return `${name(c.deviceId)} ${c.measurementKey ?? ATTRIBUTE_LABEL[c.attribute]?.toLowerCase() ?? c.attribute} is${c.above !== undefined ? ` above ${c.above}` : ''}${c.above !== undefined && c.below !== undefined ? ' and' : ''}${c.below !== undefined ? ` below ${c.below}` : ''}`;
    case 'roomState':
      return `${roomName(c.roomId)} has ${c.anyOn ? 'something on' : 'everything off'}`;
    case 'presence':
      return c.anyoneHome ? 'Someone is home' : 'Nobody is home';
    case 'securityState':
      return `${name(c.deviceId)} is ${c.alarmState.replace('_', ' ')}`;
    case 'group':
      return `(${c.conditions.map((x) => describeCondition(x, name, roomName)).join(c.operator === 'and' ? ' AND ' : ' OR ')})`;
  }
}

export function describeAutomationAction(a: AutomationAction, name: (id: string) => string, sceneName: (id: string) => string, automationName: (id: string) => string): string {
  switch (a.type) {
    case 'deviceCommand':
      return `${describeCommand(a.command)} · ${name(a.deviceId)}`;
    case 'activateScene':
      return `Activate scene “${sceneName(a.sceneId)}”`;
    case 'notify':
      return `Notify household: “${a.title}”`;
    case 'delay':
      return `Wait ${a.seconds} seconds`;
    case 'runAutomation':
      return `Run automation “${automationName(a.automationId)}”`;
  }
}

export const EXEC_STATUS: Record<string, { label: string; color: 'default' | 'success' | 'warning' | 'error' | 'info' }> = {
  running: { label: 'Running', color: 'info' },
  succeeded: { label: 'Succeeded', color: 'success' },
  partial: { label: 'Partly failed', color: 'warning' },
  failed: { label: 'Failed', color: 'error' },
  skipped: { label: 'Skipped', color: 'default' },
  simulated: { label: 'Simulated', color: 'info' },
};

export function ExecStatusChip({ status }: { status: string | null | undefined }) {
  if (!status) return <Chip size="small" label="Never run" variant="outlined" />;
  const s = EXEC_STATUS[status] ?? { label: status, color: 'default' as const };
  return <Chip size="small" label={s.label} color={s.color} variant={s.color === 'default' ? 'outlined' : 'filled'} />;
}

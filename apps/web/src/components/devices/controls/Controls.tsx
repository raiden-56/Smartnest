import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Box, Button, ButtonGroup, CircularProgress, FormControl, IconButton, InputLabel, MenuItem, Select, Slider, Stack, Switch, TextField, ToggleButton,
  ToggleButtonGroup, Tooltip, Typography,
} from '@mui/material';
import {
  ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Check, ChevronDown, ChevronUp, Home as HomeIcon, Lock, LockOpen, Minus, Pause, Play, Plus, Search,
  SkipBack, SkipForward, Square, Volume2, VolumeX, ZoomIn, ZoomOut,
} from 'lucide-react';
import type { CapabilityOf, CommandDto, DeviceCommand, DeviceDto } from '@smartnest/shared';
import { motion } from 'framer-motion';
import { useFormatTemperature } from '../../../app/hooks';
import { tokens } from '../../../theme/theme';

export interface ControlProps {
  device: DeviceDto;
  send: (c: DeviceCommand) => Promise<CommandDto | null>;
  pending: boolean;
  disabled: boolean;
  compact?: boolean;
  /** The capability definition this control renders */
  cap?: unknown;
}

const label = (text: string) => (
  <Typography variant="overline" color="text.secondary" component="div" sx={{ mb: 0.5 }}>
    {text}
  </Typography>
);

function Spinner({ show }: { show: boolean }) {
  return show ? <CircularProgress size={16} thickness={5} aria-label="Waiting for the device to confirm" /> : null;
}

/** Holds a local value while the user drags; resyncs to device state when idle. */
function useLocalValue<T>(remote: T, pending: boolean): [T, (v: T) => void] {
  const [local, setLocal] = useState(remote);
  const dragging = useRef(false);
  useEffect(() => {
    if (!dragging.current && !pending) setLocal(remote);
  }, [remote, pending]);
  return [
    local,
    (v: T) => {
      dragging.current = true;
      setLocal(v);
      window.setTimeout(() => (dragging.current = false), 600);
    },
  ];
}

// ─── On / off ─────────────────────────────────────────────────────────────

export function OnOffControl({ device, send, pending, disabled, compact }: ControlProps) {
  const on = device.state.on;
  const known = on !== undefined;
  return (
    <Stack direction="row" alignItems="center" spacing={1} justifyContent={compact ? 'flex-end' : 'space-between'}>
      {!compact && (
        <Box>
          {label('Power')}
          <Typography variant="body2">{known ? (on ? 'On' : 'Off') : 'State not reported'}</Typography>
        </Box>
      )}
      <Stack direction="row" alignItems="center" spacing={1}>
        <Spinner show={pending} />
        <motion.div whileTap={{ scale: 0.92 }} transition={{ duration: 0.12 }}>
          <Switch
            checked={!!on}
            disabled={disabled || pending}
            onChange={(e) => void send({ capability: 'onOff', action: e.target.checked ? 'turnOn' : 'turnOff' })}
            inputProps={{ 'aria-label': `${device.name} power${known ? (on ? ', currently on' : ', currently off') : ', state unknown'}` }}
          />
        </motion.div>
      </Stack>
    </Stack>
  );
}

// ─── Lighting ─────────────────────────────────────────────────────────────

export function BrightnessControl({ device, send, pending, disabled }: ControlProps) {
  const remote = device.state.on === false ? 0 : (device.state.brightness ?? 0);
  const [value, setValue] = useLocalValue(remote, pending);
  return (
    <Box>
      <Stack direction="row" justifyContent="space-between" alignItems="center">
        {label('Brightness')}
        <Stack direction="row" spacing={1} alignItems="center">
          <Spinner show={pending} />
          <Typography variant="body2" fontWeight={600}>
            {value}%
          </Typography>
        </Stack>
      </Stack>
      <Slider
        value={value}
        min={0}
        max={100}
        disabled={disabled}
        onChange={(_, v) => setValue(v as number)}
        onChangeCommitted={(_, v) => void send({ capability: 'brightness', action: 'setBrightness', value: v as number })}
        aria-label={`${device.name} brightness`}
        valueLabelDisplay="auto"
        valueLabelFormat={(v) => `${v}%`}
        sx={{ color: 'accent.main' }}
      />
    </Box>
  );
}

const SWATCHES: [number, number, number][] = [[255, 244, 229], [242, 140, 40], [201, 111, 82], [255, 90, 90], [255, 200, 87], [120, 200, 120], [80, 160, 220], [150, 110, 220]];

export function ColorControl({ device, send, pending, disabled }: ControlProps) {
  const rgb = device.state.colorRgb;
  const hex = rgb ? `#${rgb.map((v) => v.toString(16).padStart(2, '0')).join('')}` : '#ffffff';
  return (
    <Box>
      <Stack direction="row" justifyContent="space-between" alignItems="center">
        {label('Colour')}
        <Spinner show={pending} />
      </Stack>
      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap alignItems="center">
        {SWATCHES.map((s) => {
          const active = rgb && s.every((v, i) => Math.abs(v - rgb[i]!) < 8);
          return (
            <Box
              key={s.join(',')}
              component="button"
              type="button"
              disabled={disabled || pending}
              onClick={() => void send({ capability: 'colorRgb', action: 'setColor', rgb: s })}
              aria-label={`Set colour rgb ${s.join(' ')}`}
              aria-pressed={!!active}
              sx={{
                width: 32, height: 32, borderRadius: '50%', border: active ? `3px solid ${tokens.color.text}` : `2px solid ${tokens.color.border}`,
                bgcolor: `rgb(${s.join(',')})`, cursor: 'pointer', p: 0, '&:disabled': { opacity: 0.5, cursor: 'not-allowed' },
              }}
            />
          );
        })}
        <Tooltip title="Custom colour">
          <Box component="label" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, cursor: disabled ? 'not-allowed' : 'pointer' }}>
            <Box
              component="input"
              type="color"
              value={hex}
              disabled={disabled || pending}
              aria-label={`${device.name} custom colour`}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                const h = e.target.value;
                void send({ capability: 'colorRgb', action: 'setColor', rgb: [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)] });
              }}
              sx={{ width: 36, height: 34, border: 'none', bgcolor: 'transparent', p: 0 }}
            />
          </Box>
        </Tooltip>
      </Stack>
    </Box>
  );
}

export function ColorTemperatureControl({ device, send, pending, disabled, cap }: ControlProps) {
  const c = cap as CapabilityOf<'colorTemperature'>;
  const [value, setValue] = useLocalValue(device.state.colorTemperatureK ?? Math.round((c.minKelvin + c.maxKelvin) / 2), pending);
  return (
    <Box>
      <Stack direction="row" justifyContent="space-between" alignItems="center">
        {label('Colour temperature')}
        <Stack direction="row" spacing={1} alignItems="center">
          <Spinner show={pending} />
          <Typography variant="body2" fontWeight={600}>
            {device.state.colorTemperatureK !== undefined ? `${value}K` : 'Not reported'}
          </Typography>
        </Stack>
      </Stack>
      <Slider
        value={value}
        min={c.minKelvin}
        max={c.maxKelvin}
        step={50}
        disabled={disabled}
        onChange={(_, v) => setValue(v as number)}
        onChangeCommitted={(_, v) => void send({ capability: 'colorTemperature', action: 'setColorTemperature', kelvin: v as number })}
        aria-label={`${device.name} colour temperature in kelvin`}
        sx={{ '& .MuiSlider-rail': { background: 'linear-gradient(90deg, #FFB46B, #FFF4E5, #CFE3FF)', opacity: 1 }, '& .MuiSlider-track': { opacity: 0 }, color: tokens.color.text }}
      />
      <Stack direction="row" justifyContent="space-between">
        <Typography variant="caption">Warm</Typography>
        <Typography variant="caption">Cool</Typography>
      </Stack>
    </Box>
  );
}

// ─── Climate ──────────────────────────────────────────────────────────────

export function ThermostatControl({ device, send, pending, disabled, cap, compact }: ControlProps) {
  const c = cap as CapabilityOf<'temperatureSetpoint'>;
  const fmt = useFormatTemperature();
  const remote = device.state.targetTemperature;
  const [target, setTarget] = useState(remote);
  const timer = useRef<number | null>(null);
  useEffect(() => {
    if (!timer.current && !pending) setTarget(remote);
  }, [remote, pending]);

  const nudge = (delta: number) => {
    const base = target ?? remote ?? (c.min + c.max) / 2;
    const next = Math.min(c.max, Math.max(c.min, Math.round((base + delta) / c.step) * c.step));
    setTarget(next);
    if (timer.current) window.clearTimeout(timer.current);
    // Batch rapid taps into one command
    timer.current = window.setTimeout(() => {
      timer.current = null;
      void send({ capability: 'temperatureSetpoint', action: 'setTargetTemperature', value: next });
    }, 700);
  };
  const off = device.state.hvacMode === 'off';
  return (
    <Box>
      {!compact && label('Target temperature')}
      <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1}>
        <IconButton aria-label="Decrease target temperature" onClick={() => nudge(-c.step)} disabled={disabled || target === undefined || target <= c.min} sx={{ border: `1px solid ${tokens.color.border}`, borderRadius: '50%' }}>
          <Minus size={compact ? 16 : 18} />
        </IconButton>
        <Box sx={{ textAlign: 'center', minWidth: 0 }}>
          <Typography sx={{ fontSize: compact ? '1.5rem' : '2.6rem', fontWeight: 700, lineHeight: 1.05, opacity: off ? 0.5 : 1 }} aria-live="polite">
            {target !== undefined ? fmt(target, c.unit) : '—'}
          </Typography>
          {!compact && (
            <Typography variant="caption" component="div">
              {pending ? 'Waiting for confirmation…' : device.state.currentTemperature !== undefined ? `Currently ${fmt(device.state.currentTemperature, c.unit)}` : 'Current temperature not reported'}
            </Typography>
          )}
        </Box>
        <IconButton aria-label="Increase target temperature" onClick={() => nudge(c.step)} disabled={disabled || target === undefined || target >= c.max} sx={{ border: `1px solid ${tokens.color.border}`, borderRadius: '50%' }}>
          <Plus size={compact ? 16 : 18} />
        </IconButton>
      </Stack>
    </Box>
  );
}

const MODE_LABEL: Record<string, string> = { off: 'Off', heat: 'Heat', cool: 'Cool', heat_cool: 'Heat/Cool', auto: 'Auto', dry: 'Dry', fan_only: 'Fan' };

export function HvacModeControl({ device, send, pending, disabled, cap }: ControlProps) {
  const c = cap as CapabilityOf<'hvacMode'>;
  return (
    <Box>
      <Stack direction="row" justifyContent="space-between" alignItems="center">
        {label('Mode')}
        <Spinner show={pending} />
      </Stack>
      <ToggleButtonGroup
        exclusive
        size="small"
        value={device.state.hvacMode ?? null}
        onChange={(_, v) => v && void send({ capability: 'hvacMode', action: 'setHvacMode', mode: v })}
        aria-label={`${device.name} operating mode`}
        disabled={disabled || pending}
        sx={{ flexWrap: 'wrap', gap: 0.5, '& .MuiToggleButton-root': { borderRadius: '999px !important', border: `1px solid ${tokens.color.border} !important`, px: 1.5 } }}
      >
        {c.modes.map((m) => (
          <ToggleButton key={m} value={m}>
            {MODE_LABEL[m] ?? m}
          </ToggleButton>
        ))}
      </ToggleButtonGroup>
    </Box>
  );
}

export function FanSpeedControl({ device, send, pending, disabled, cap }: ControlProps) {
  const c = cap as CapabilityOf<'fanSpeed'>;
  const [pct, setPct] = useLocalValue(typeof device.state.fanSpeed === 'number' ? device.state.fanSpeed : 0, pending);
  if (c.presets) {
    return (
      <Box>
        <Stack direction="row" justifyContent="space-between" alignItems="center">
          {label('Fan speed')}
          <Spinner show={pending} />
        </Stack>
        <ToggleButtonGroup
          exclusive
          size="small"
          value={device.state.fanSpeed !== undefined ? String(device.state.fanSpeed) : null}
          onChange={(_, v) => v && void send({ capability: 'fanSpeed', action: 'setFanSpeed', speed: v })}
          aria-label={`${device.name} fan speed`}
          disabled={disabled || pending}
          sx={{ flexWrap: 'wrap', gap: 0.5, '& .MuiToggleButton-root': { borderRadius: '999px !important', border: `1px solid ${tokens.color.border} !important`, px: 1.5, textTransform: 'capitalize' } }}
        >
          {c.presets.map((p) => (
            <ToggleButton key={p} value={p}>
              {p}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
      </Box>
    );
  }
  return (
    <Box>
      <Stack direction="row" justifyContent="space-between">
        {label('Fan speed')}
        <Typography variant="body2" fontWeight={600}>
          {pct}%
        </Typography>
      </Stack>
      <Slider value={pct} disabled={disabled} onChange={(_, v) => setPct(v as number)} onChangeCommitted={(_, v) => void send({ capability: 'fanSpeed', action: 'setFanSpeed', speed: v as number })} aria-label={`${device.name} fan speed percentage`} />
    </Box>
  );
}

export function SwingControl({ device, send, pending, disabled, cap }: ControlProps) {
  const c = cap as CapabilityOf<'swing'>;
  return (
    <FormControl size="small" fullWidth disabled={disabled || pending}>
      <InputLabel id={`swing-${device.id}`}>Swing</InputLabel>
      <Select labelId={`swing-${device.id}`} label="Swing" value={device.state.swingMode ?? ''} onChange={(e) => void send({ capability: 'swing', action: 'setSwingMode', mode: String(e.target.value) })}>
        {c.modes.map((m) => (
          <MenuItem key={m} value={m} sx={{ textTransform: 'capitalize' }}>
            {m}
          </MenuItem>
        ))}
      </Select>
    </FormControl>
  );
}

// ─── Covers, locks, alarm ─────────────────────────────────────────────────

export function PositionControl({ device, send, pending, disabled, cap, compact }: ControlProps) {
  const c = cap as CapabilityOf<'position'>;
  const [pos, setPos] = useLocalValue(device.state.position ?? 0, pending);
  const st = device.state.coverState;
  const moving = st === 'opening' || st === 'closing';
  const noun = c.coverKind === 'garage' ? 'garage door' : c.coverKind === 'gate' ? 'gate' : c.coverKind;
  return (
    <Box>
      {!compact && (
        <Stack direction="row" justifyContent="space-between" alignItems="center">
          {label('Position')}
          <Stack direction="row" spacing={1} alignItems="center">
            <Spinner show={pending} />
            <Typography variant="body2" fontWeight={600}>
              {st ? `${st[0]!.toUpperCase()}${st.slice(1)}` : 'Not reported'}
              {device.state.position !== undefined ? ` · ${device.state.position}%` : ''}
            </Typography>
          </Stack>
        </Stack>
      )}
      <ButtonGroup variant="outlined" size="small" fullWidth={!compact} disabled={disabled} aria-label={`${device.name} ${noun} controls`}>
        <Button onClick={() => void send({ capability: 'position', action: 'open' })} startIcon={<ChevronUp size={16} />} disabled={st === 'open' && !moving}>
          Open
        </Button>
        {c.canStop && (
          <Button onClick={() => void send({ capability: 'position', action: 'stop' })} startIcon={<Square size={12} />} disabled={!moving && !pending}>
            Stop
          </Button>
        )}
        <Button onClick={() => void send({ capability: 'position', action: 'close' })} startIcon={<ChevronDown size={16} />} disabled={st === 'closed' && !moving}>
          Close
        </Button>
      </ButtonGroup>
      {c.canSetPosition && !compact && (
        <Slider
          sx={{ mt: 2 }}
          value={pos}
          disabled={disabled}
          onChange={(_, v) => setPos(v as number)}
          onChangeCommitted={(_, v) => void send({ capability: 'position', action: 'setPosition', value: v as number })}
          aria-label={`${device.name} position`}
          valueLabelDisplay="auto"
          valueLabelFormat={(v) => `${v}%`}
        />
      )}
    </Box>
  );
}

export function LockControl({ device, send, pending, disabled, compact }: ControlProps) {
  const st = device.state.lockState;
  const locked = st === 'locked';
  return (
    <Stack direction="row" alignItems="center" justifyContent={compact ? 'flex-end' : 'space-between'} spacing={1.5}>
      {!compact && (
        <Box>
          {label('Lock')}
          <Stack direction="row" spacing={1} alignItems="center">
            {locked ? <Lock size={18} color={tokens.color.success} aria-hidden /> : <LockOpen size={18} color={tokens.color.warning} aria-hidden />}
            <Typography fontWeight={600}>{st ? st[0]!.toUpperCase() + st.slice(1) : 'State not reported'}</Typography>
          </Stack>
        </Box>
      )}
      <Stack direction="row" spacing={1} alignItems="center">
        <Spinner show={pending} />
        <Button
          variant={locked ? 'outlined' : 'contained'}
          color={locked ? 'warning' : 'primary'}
          size="small"
          disabled={disabled || pending || st === 'locking' || st === 'unlocking'}
          startIcon={locked ? <LockOpen size={16} /> : <Lock size={16} />}
          onClick={() => void send({ capability: 'lock', action: locked ? 'unlock' : 'lock' })}
        >
          {locked ? 'Unlock' : 'Lock'}
        </Button>
      </Stack>
    </Stack>
  );
}

const ARM_LABEL = { armed_home: 'Arm home', armed_away: 'Arm away', armed_night: 'Arm night' } as const;

export function AlarmControl({ device, send, pending, disabled, cap }: ControlProps) {
  const c = cap as CapabilityOf<'alarmPanel'>;
  const [code, setCode] = useState('');
  const st = device.state.alarmState;
  const withCode = <T extends DeviceCommand>(cmd: T): T => (c.codeRequired && code ? { ...cmd, code } : cmd);
  return (
    <Box>
      <Stack direction="row" justifyContent="space-between" alignItems="center">
        {label('Alarm')}
        <Stack direction="row" spacing={1} alignItems="center">
          <Spinner show={pending} />
          <Typography fontWeight={600} sx={{ color: st === 'triggered' ? 'error.main' : st === 'disarmed' ? 'text.primary' : 'success.main' }}>
            {st ? st.replace('_', ' ').replace(/^\w/, (x) => x.toUpperCase()) : 'Not reported'}
          </Typography>
        </Stack>
      </Stack>
      {c.codeRequired && <TextField size="small" type="password" label="Alarm code" value={code} onChange={(e) => setCode(e.target.value)} inputProps={{ inputMode: 'numeric', autoComplete: 'off' }} sx={{ my: 1 }} />}
      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mt: 1 }}>
        {c.armModes.map((m) => (
          <Button key={m} size="small" variant={st === m ? 'contained' : 'outlined'} disabled={disabled || pending || (c.codeRequired && !code)} onClick={() => void send(withCode({ capability: 'alarmPanel', action: 'arm', mode: m }))}>
            {ARM_LABEL[m]}
          </Button>
        ))}
        <Button size="small" color="warning" variant="outlined" disabled={disabled || pending || st === 'disarmed' || (c.codeRequired && !code)} onClick={() => void send(withCode({ capability: 'alarmPanel', action: 'disarm' }))}>
          Disarm
        </Button>
      </Stack>
    </Box>
  );
}

// ─── Media ────────────────────────────────────────────────────────────────

export function MediaControl({ device, send, pending, disabled, cap, compact }: ControlProps) {
  const c = cap as CapabilityOf<'mediaPlayback'>;
  const playing = device.state.mediaState === 'playing';
  const btn = (key: 'play' | 'pause' | 'stop' | 'next' | 'previous', icon: ReactNode, text: string) =>
    c.features.includes(key) && (
      <Tooltip title={text} key={key}>
        <span>
          <IconButton aria-label={`${text} on ${device.name}`} disabled={disabled || pending} onClick={() => void send({ capability: 'mediaPlayback', action: 'mediaCommand', command: key })}>
            {icon}
          </IconButton>
        </span>
      </Tooltip>
    );
  return (
    <Box>
      {!compact && (
        <>
          {label('Playback')}
          <Typography variant="body2" noWrap sx={{ mb: 0.5 }}>
            {device.state.mediaTitle ?? (device.state.mediaState ? device.state.mediaState[0]!.toUpperCase() + device.state.mediaState.slice(1) : 'Nothing reported')}
          </Typography>
        </>
      )}
      <Stack direction="row" alignItems="center" spacing={0.5} justifyContent={compact ? 'flex-end' : 'flex-start'}>
        {!compact && btn('previous', <SkipBack size={18} />, 'Previous')}
        {playing ? btn('pause', <Pause size={20} />, 'Pause') || btn('stop', <Square size={16} />, 'Stop') : btn('play', <Play size={20} />, 'Play')}
        {!compact && btn('next', <SkipForward size={18} />, 'Next')}
        {!compact && playing && c.features.includes('pause') && btn('stop', <Square size={16} />, 'Stop')}
        <Spinner show={pending} />
      </Stack>
    </Box>
  );
}

export function VolumeControl({ device, send, pending, disabled, cap }: ControlProps) {
  const c = cap as CapabilityOf<'volume'>;
  const [vol, setVol] = useLocalValue(device.state.volume ?? 0, pending);
  const muted = device.state.muted;
  return (
    <Box>
      {label('Volume')}
      <Stack direction="row" spacing={1.5} alignItems="center">
        {c.canMute && (
          <IconButton aria-label={muted ? `Unmute ${device.name}` : `Mute ${device.name}`} aria-pressed={!!muted} disabled={disabled || pending} onClick={() => void send({ capability: 'volume', action: 'setMuted', muted: !muted })}>
            {muted ? <VolumeX size={18} /> : <Volume2 size={18} />}
          </IconButton>
        )}
        <Slider value={vol} disabled={disabled} onChange={(_, v) => setVol(v as number)} onChangeCommitted={(_, v) => void send({ capability: 'volume', action: 'setVolume', value: v as number })} aria-label={`${device.name} volume`} valueLabelDisplay="auto" />
        <Typography variant="body2" sx={{ minWidth: 36 }}>
          {device.state.volume !== undefined ? `${vol}%` : '—'}
        </Typography>
      </Stack>
    </Box>
  );
}

export function SourceControl({ device, send, pending, disabled, cap }: ControlProps) {
  const c = cap as CapabilityOf<'mediaSource'>;
  return (
    <FormControl size="small" fullWidth disabled={disabled || pending}>
      <InputLabel id={`src-${device.id}`}>Source</InputLabel>
      <Select labelId={`src-${device.id}`} label="Source" value={device.state.mediaSource ?? ''} onChange={(e) => void send({ capability: 'mediaSource', action: 'selectSource', source: String(e.target.value) })}>
        {c.sources.map((s) => (
          <MenuItem key={s} value={s}>
            {s}
          </MenuItem>
        ))}
      </Select>
    </FormControl>
  );
}

// ─── Cameras ──────────────────────────────────────────────────────────────

export function PtzControl({ device, send, pending, disabled, cap }: ControlProps) {
  const c = cap as CapabilityOf<'ptz'>;
  const move = (direction: 'left' | 'right' | 'up' | 'down' | 'zoomIn' | 'zoomOut') => void send({ capability: 'ptz', action: 'ptzMove', direction });
  const b = (dir: Parameters<typeof move>[0], icon: ReactNode, text: string, enabled: boolean) => (
    <IconButton aria-label={text} disabled={!enabled || disabled || pending} onClick={() => move(dir)} sx={{ border: `1px solid ${tokens.color.border}` }}>
      {icon}
    </IconButton>
  );
  return (
    <Box>
      {label('Pan / tilt / zoom')}
      <Stack direction="row" spacing={3} alignItems="center">
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, 40px)', gap: 0.5 }}>
          <span />
          {b('up', <ArrowUp size={16} />, 'Tilt up', c.tilt)}
          <span />
          {b('left', <ArrowLeft size={16} />, 'Pan left', c.pan)}
          <Box sx={{ display: 'grid', placeItems: 'center' }}>
            <Spinner show={pending} />
          </Box>
          {b('right', <ArrowRight size={16} />, 'Pan right', c.pan)}
          <span />
          {b('down', <ArrowDown size={16} />, 'Tilt down', c.tilt)}
          <span />
        </Box>
        <Stack spacing={0.5}>
          {b('zoomIn', <ZoomIn size={16} />, 'Zoom in', c.zoom)}
          {b('zoomOut', <ZoomOut size={16} />, 'Zoom out', c.zoom)}
        </Stack>
      </Stack>
      <Typography variant="caption" component="p" sx={{ mt: 1 }}>
        Movement commands are acknowledged by the integration; position is not reported back.
      </Typography>
    </Box>
  );
}

export function MotionDetectionControl({ device, send, pending, disabled }: ControlProps) {
  const on = device.state.motionDetectionEnabled;
  return (
    <Stack direction="row" alignItems="center" justifyContent="space-between">
      <Box>
        {label('Motion detection')}
        <Typography variant="body2">{on === undefined ? 'Not reported' : on ? 'Enabled' : 'Disabled'}</Typography>
      </Box>
      <Stack direction="row" spacing={1} alignItems="center">
        <Spinner show={pending} />
        <Switch checked={!!on} disabled={disabled || pending} onChange={(e) => void send({ capability: 'motionDetectionToggle', action: 'setMotionDetection', enabled: e.target.checked })} inputProps={{ 'aria-label': `${device.name} motion detection` }} />
      </Stack>
    </Stack>
  );
}

// ─── Appliances ───────────────────────────────────────────────────────────

export function VacuumControl({ device, send, pending, disabled, cap, compact }: ControlProps) {
  const c = cap as CapabilityOf<'vacuum'>;
  const st = device.state.vacuumState;
  const cleaning = st === 'cleaning';
  return (
    <Box>
      {!compact && (
        <Stack direction="row" justifyContent="space-between">
          {label('Cleaning')}
          <Typography variant="body2" fontWeight={600}>
            {st ? st[0]!.toUpperCase() + st.slice(1) : 'Not reported'}
          </Typography>
        </Stack>
      )}
      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap justifyContent={compact ? 'flex-end' : 'flex-start'} alignItems="center">
        <Spinner show={pending} />
        {cleaning ? (
          <Button size="small" variant="outlined" startIcon={<Pause size={14} />} disabled={disabled || pending} onClick={() => void send({ capability: 'vacuum', action: 'vacuumCommand', command: 'pause' })}>
            Pause
          </Button>
        ) : (
          <Button size="small" variant="contained" startIcon={<Play size={14} />} disabled={disabled || pending} onClick={() => void send({ capability: 'vacuum', action: 'vacuumCommand', command: 'start' })}>
            Start
          </Button>
        )}
        {!compact && (
          <Button size="small" variant="outlined" startIcon={<HomeIcon size={14} />} disabled={disabled || pending || st === 'docked'} onClick={() => void send({ capability: 'vacuum', action: 'vacuumCommand', command: 'returnToBase' })}>
            Dock
          </Button>
        )}
        {!compact && c.canLocate && (
          <Button size="small" startIcon={<Search size={14} />} disabled={disabled || pending} onClick={() => void send({ capability: 'vacuum', action: 'vacuumCommand', command: 'locate' })}>
            Locate
          </Button>
        )}
      </Stack>
    </Box>
  );
}

export function ValveControl({ device, send, pending, disabled, compact }: ControlProps) {
  const open = device.state.valveOpen;
  return (
    <Stack direction="row" alignItems="center" justifyContent={compact ? 'flex-end' : 'space-between'} spacing={1}>
      {!compact && (
        <Box>
          {label('Valve')}
          <Typography variant="body2">{open === undefined ? 'Not reported' : open ? 'Open' : 'Closed'}</Typography>
        </Box>
      )}
      <Stack direction="row" spacing={1} alignItems="center">
        <Spinner show={pending} />
        <Button size="small" variant={open ? 'outlined' : 'contained'} disabled={disabled || pending} onClick={() => void send({ capability: 'valve', action: open ? 'closeValve' : 'openValve' })}>
          {open ? 'Close valve' : 'Open valve'}
        </Button>
      </Stack>
    </Stack>
  );
}

export function CustomActionsControl({ device, send, pending, disabled, cap }: ControlProps) {
  const c = cap as CapabilityOf<'customAction'>;
  return (
    <Box>
      {label('Actions')}
      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
        {c.actions.map((a) => (
          <Button key={a.id} size="small" variant="outlined" color={a.sensitive ? 'warning' : 'primary'} startIcon={<Check size={14} />} disabled={disabled || pending} onClick={() => void send({ capability: 'customAction', action: 'custom', actionId: a.id })}>
            {a.label}
          </Button>
        ))}
        <Spinner show={pending} />
      </Stack>
      <Typography variant="caption" component="p" sx={{ mt: 1 }}>
        Device actions are acknowledged by the integration; their effect may not be reported back.
      </Typography>
    </Box>
  );
}


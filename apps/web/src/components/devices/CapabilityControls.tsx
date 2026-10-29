import { useEffect, useState, type ReactNode } from 'react';
import { Alert, Box, Button, Chip, Divider, Stack, Tooltip, Typography } from '@mui/material';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle, BatteryLow, BatteryMedium, CheckCircle2, Clock, Loader2, RefreshCw, XCircle } from 'lucide-react';
import { LOW_BATTERY_THRESHOLD, formatEnergy, formatPower, hasCapability, type Capability, type CommandDto, type DeviceDto } from '@smartnest/shared';
import { useFormatTemperature } from '../../app/hooks';
import { tokens } from '../../theme/theme';
import { NotAvailable } from '../common/States';
import {
  AlarmControl, BrightnessControl, ColorControl, ColorTemperatureControl, CustomActionsControl, FanSpeedControl, HvacModeControl, LockControl, MediaControl,
  MotionDetectionControl, OnOffControl, PositionControl, PtzControl, SourceControl, SwingControl, ThermostatControl, VacuumControl, ValveControl, VolumeControl,
  type ControlProps,
} from './controls/Controls';
import { controlsDisabledReason, useDeviceCommand } from './useDeviceCommand';

type ControlComponent = (p: ControlProps) => ReactNode;

/** Capability → control. Capabilities without an entry are read-only and shown as readings. */
const CONTROL_FOR: Partial<Record<Capability['type'], ControlComponent>> = {
  onOff: OnOffControl,
  temperatureSetpoint: ThermostatControl,
  hvacMode: HvacModeControl,
  brightness: BrightnessControl,
  colorTemperature: ColorTemperatureControl,
  colorRgb: ColorControl,
  fanSpeed: FanSpeedControl,
  swing: SwingControl,
  position: PositionControl,
  lock: LockControl,
  alarmPanel: AlarmControl,
  mediaPlayback: MediaControl,
  volume: VolumeControl,
  mediaSource: SourceControl,
  ptz: PtzControl,
  motionDetectionToggle: MotionDetectionControl,
  vacuum: VacuumControl,
  valve: ValveControl,
  customAction: CustomActionsControl,
};

/** Order in which full controls appear in the detail panel. */
const ORDER: Capability['type'][] = ['onOff', 'temperatureSetpoint', 'hvacMode', 'brightness', 'colorTemperature', 'colorRgb', 'fanSpeed', 'swing', 'position', 'lock', 'alarmPanel', 'mediaPlayback', 'volume', 'mediaSource', 'vacuum', 'valve', 'motionDetectionToggle', 'ptz', 'customAction'];

/** The single most useful control for a compact card. */
const PRIMARY: Capability['type'][] = ['lock', 'position', 'temperatureSetpoint', 'vacuum', 'valve', 'onOff', 'mediaPlayback'];

export function FullDeviceControls({ device, canControlCameras = true }: { device: DeviceDto; canControlCameras?: boolean }) {
  const { send, pendingFor, latest } = useDeviceCommand(device);
  const disabledReason = controlsDisabledReason(device);
  const caps = ORDER.flatMap((t) => device.capabilities.filter((c) => c.type === t)).filter((c) => (c.type === 'ptz' || c.type === 'motionDetectionToggle' ? canControlCameras : true));
  if (!caps.length) {
    return <Typography color="text.secondary">This device only reports information; it has no controls.</Typography>;
  }
  return (
    <Stack spacing={2.5} divider={<Divider flexItem />}>
      {disabledReason && <Alert severity="warning">{disabledReason} Controls are unavailable until it reconnects.</Alert>}
      {caps.map((cap, i) => {
        const C = CONTROL_FOR[cap.type]!;
        return (
          <Box key={`${cap.type}-${i}`}>
            <C device={device} cap={cap} send={send} pending={pendingFor(cap.type)} disabled={!!disabledReason} />
          </Box>
        );
      })}
      <CommandStatus command={latest} onRetry={latest ? () => void send(latest.command) : undefined} />
    </Stack>
  );
}

export function QuickControl({ device }: { device: DeviceDto }) {
  const { send, pendingFor, latest } = useDeviceCommand(device);
  const disabled = !!controlsDisabledReason(device);
  const cap = PRIMARY.map((t) => hasCapability(device.capabilities, t)).find(Boolean);
  return (
    <Stack spacing={0.5} alignItems="flex-end">
      {cap ? (
        (() => {
          const C = CONTROL_FOR[cap.type]!;
          return <C device={device} cap={cap} send={send} pending={pendingFor(cap.type)} disabled={disabled} compact />;
        })()
      ) : (
        <PrimaryReading device={device} />
      )}
      <CommandStatus command={latest} compact onRetry={latest ? () => void send(latest.command) : undefined} />
    </Stack>
  );
}

/** Shows command lifecycle feedback: pending → confirmed / failed / not confirmed. */
export function CommandStatus({ command, compact, onRetry }: { command?: CommandDto; compact?: boolean; onRetry?: () => void }) {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    setVisible(true);
    if (command?.status === 'confirmed') {
      const t = window.setTimeout(() => setVisible(false), 4000);
      return () => window.clearTimeout(t);
    }
  }, [command?.id, command?.status]);
  if (!command || !visible) return compact ? null : <Box sx={{ minHeight: 0 }} />;
  const retryable = onRetry && command.status !== 'confirmed' && command.status !== 'pending' && command.status !== 'sent' && !(command.command.action === 'arm' || command.command.action === 'disarm');
  const meta = {
    pending: { icon: <Loader2 size={14} className="spin" />, text: 'Sending…', color: tokens.color.textSecondary },
    sent: { icon: <Loader2 size={14} className="spin" />, text: 'Waiting for device…', color: tokens.color.textSecondary },
    confirmed: { icon: <CheckCircle2 size={14} />, text: command.verified ? 'Confirmed' : 'Acknowledged', color: tokens.color.success },
    failed: { icon: <XCircle size={14} />, text: 'Failed', color: tokens.color.error },
    timed_out: { icon: <Clock size={14} />, text: 'Not confirmed', color: tokens.color.warning },
  }[command.status];
  return (
    <AnimatePresence>
      <motion.div key={command.id + command.status} initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
        <Stack direction="row" spacing={0.75} alignItems="center" sx={{ color: meta.color }}>
          {meta.icon}
          <Tooltip title={command.errorMessage ?? (command.verified ? 'The device reported the requested state.' : command.status === 'confirmed' ? 'The integration accepted the command; this action cannot be read back.' : '')}>
            <Typography variant="caption" sx={{ color: 'inherit', fontWeight: 600 }}>
              {compact ? meta.text : `${command.description}: ${meta.text}`}
            </Typography>
          </Tooltip>
          {retryable && (
            <Button size="small" onClick={onRetry} startIcon={<RefreshCw size={12} />} sx={{ minHeight: 24, py: 0, px: 1, fontSize: '0.75rem' }}>
              Retry
            </Button>
          )}
        </Stack>
        {!compact && command.errorMessage && command.status !== 'confirmed' && (
          <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 0.5 }}>
            {command.errorMessage}
          </Typography>
        )}
      </motion.div>
    </AnimatePresence>
  );
}

/** Read-only values the device reports. Missing values say "Not available". */
export function DeviceReadings({ device }: { device: DeviceDto }) {
  const fmt = useFormatTemperature();
  const s = device.state;
  const rows: { label: string; value: ReactNode }[] = [];
  for (const cap of device.capabilities) {
    switch (cap.type) {
      case 'sensor': {
        const v = s.measurements?.[cap.key];
        rows.push({ label: cap.label ?? cap.measurement.replace('_', ' '), value: v === undefined ? <NotAvailable /> : cap.measurement === 'temperature' ? fmt(v, cap.unit.includes('F') ? 'F' : 'C') : `${v} ${cap.unit}` });
        break;
      }
      case 'battery':
        rows.push({ label: 'Battery', value: s.batteryLevel === undefined ? <NotAvailable /> : <BatteryValue level={s.batteryLevel} /> });
        break;
      case 'power':
        rows.push({ label: 'Power', value: s.powerW === undefined ? <NotAvailable /> : formatPower(s.powerW) });
        break;
      case 'energy':
        rows.push({ label: 'Energy (total)', value: s.energyKWh === undefined ? <NotAvailable /> : formatEnergy(s.energyKWh) });
        break;
      case 'motion':
        rows.push({ label: 'Motion', value: s.motion === undefined ? <NotAvailable /> : s.motion ? 'Detected' : 'Clear' });
        break;
      case 'contact':
        rows.push({ label: 'Contact', value: s.contactOpen === undefined ? <NotAvailable /> : s.contactOpen ? 'Open' : 'Closed' });
        break;
      case 'occupancy':
        rows.push({ label: 'Occupancy', value: s.occupied === undefined ? <NotAvailable /> : s.occupied ? 'Occupied' : 'Clear' });
        break;
      case 'presence':
        rows.push({ label: 'Presence', value: s.present === undefined ? <NotAvailable /> : s.present ? 'Home' : 'Away' });
        break;
      case 'safetyAlarm':
        rows.push({
          label: cap.hazard.replace('_', ' '),
          value: s.hazardDetected === undefined ? <NotAvailable /> : s.hazardDetected ? (
            <Chip size="small" color="error" icon={<AlertTriangle size={14} />} label="Hazard detected" />
          ) : (
            'Clear'
          ),
        });
        break;
      case 'recording':
        rows.push({ label: 'Recording', value: s.recording === undefined ? <NotAvailable label="Not exposed by integration" /> : s.recording ? 'Recording' : 'Not recording' });
        break;
      case 'charging':
        rows.push({ label: 'Charging', value: s.charging === undefined ? <NotAvailable /> : (s.chargingState ?? (s.charging ? 'Charging' : 'Not charging')) });
        break;
      case 'hvacMode':
        if (s.hvacAction) rows.push({ label: 'Currently', value: s.hvacAction.replace('_', ' ') });
        break;
    }
  }
  if (!rows.length) return null;
  return (
    <Box component="dl" sx={{ display: 'grid', gridTemplateColumns: 'auto 1fr', columnGap: 3, rowGap: 1.25, m: 0 }}>
      {rows.map((r, i) => (
        <Box key={i} sx={{ display: 'contents' }}>
          <Typography component="dt" variant="body2" color="text.secondary" sx={{ textTransform: 'capitalize' }}>
            {r.label}
          </Typography>
          <Typography component="dd" variant="body2" fontWeight={600} sx={{ m: 0, textAlign: 'right' }}>
            {r.value}
          </Typography>
        </Box>
      ))}
    </Box>
  );
}

function BatteryValue({ level }: { level: number }) {
  const low = level <= LOW_BATTERY_THRESHOLD;
  return (
    <Stack direction="row" spacing={0.5} alignItems="center" justifyContent="flex-end" sx={{ color: low ? 'error.main' : 'inherit' }}>
      {low ? <BatteryLow size={16} aria-hidden /> : <BatteryMedium size={16} aria-hidden />}
      <span>
        {level}%{low ? ' (low)' : ''}
      </span>
    </Stack>
  );
}

/** Short headline value for read-only devices in cards. */
export function PrimaryReading({ device }: { device: DeviceDto }) {
  const fmt = useFormatTemperature();
  const s = device.state;
  const sensor = device.capabilities.find((c): c is Extract<Capability, { type: 'sensor' }> => c.type === 'sensor');
  let text: string | null = null;
  if (sensor && s.measurements?.[sensor.key] !== undefined) {
    const v = s.measurements[sensor.key]!;
    text = sensor.measurement === 'temperature' ? fmt(v, 'C') : `${v} ${sensor.unit}`;
  } else if (hasCapability(device.capabilities, 'power') && s.powerW !== undefined) text = formatPower(s.powerW);
  else if (hasCapability(device.capabilities, 'battery') && s.batteryLevel !== undefined) text = `${s.batteryLevel}% battery`;
  return (
    <Typography variant="h4" component="p" sx={{ fontWeight: 700 }}>
      {text ?? <NotAvailable />}
    </Typography>
  );
}

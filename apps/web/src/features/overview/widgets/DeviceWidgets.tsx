import { Box, Button, Chip, Stack, Typography } from '@mui/material';
import { AlertTriangle, BatteryLow, CheckCircle2, Lock, LockOpen, ShieldCheck, Star, Thermometer } from 'lucide-react';
import { Link as RouterLink } from 'react-router-dom';
import { describeOperatingState, hasCapability, type DeviceDto } from '@smartnest/shared';
import { useDevicesQuery } from '../../../api/api';
import { timeAgo, useFormatTemperature, useHome } from '../../../app/hooks';
import { useLiveDevice, useLiveDevices } from '../../../app/store';
import { DeviceCard, DeviceTile } from '../../../components/devices/DeviceCard';
import { CommandStatus } from '../../../components/devices/CapabilityControls';
import { HvacModeControl, ThermostatControl } from '../../../components/devices/controls/Controls';
import { controlsDisabledReason, useDeviceCommand } from '../../../components/devices/useDeviceCommand';
import { ConnectivityBadge, DemoBadge } from '../../../components/common/StatusBadge';
import { ErrorState, ListSkeleton, NotAvailable } from '../../../components/common/States';
import { tokens } from '../../../theme/theme';
import { WidgetCard, WidgetEmpty, WidgetRow, useWidgetContext, type WidgetProps } from './WidgetFrame';
import { attentionReason, isLowBattery, useAttentionDevices, useSecurityDevices } from './useOverviewData';

const deviceLink = (d: DeviceDto) => (
  <Typography component={RouterLink} to={`/devices/${d.id}`} variant="body2" fontWeight={600} sx={{ color: 'text.primary', textDecoration: 'none', '&:hover': { textDecoration: 'underline' } }} noWrap>
    {d.name}
  </Typography>
);

// ─── Favourites ───────────────────────────────────────────────────────────

export function FavouritesWidget(_: WidgetProps) {
  const { homeId, can } = useHome();
  const { stacked } = useWidgetContext();
  const q = useDevicesQuery({ homeId, favourite: 'true', pageSize: 24 }, { skip: !can('devices.view') });
  const devices = useLiveDevices(q.data?.items);
  return (
    <WidgetCard
      title="Favourite devices"
      action={
        <Button component={RouterLink} to="/devices?favourite=true" size="small">
          All devices
        </Button>
      }
    >
      {q.isLoading ? (
        <ListSkeleton rows={3} />
      ) : q.error ? (
        <ErrorState error={q.error} onRetry={q.refetch} title="Could not load favourites" />
      ) : !devices.length ? (
        <WidgetEmpty
          icon={<Star size={20} />}
          title="No favourites yet"
          description="Star devices from their menu to control them from here."
          action={
            <Button component={RouterLink} to="/devices" size="small" variant="outlined">
              Browse devices
            </Button>
          }
        />
      ) : (
        <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: stacked ? '1fr' : 'repeat(auto-fill, minmax(230px, 1fr))', pb: 0.5 }}>
          {devices.map((d) => (
            <DeviceCard key={d.id} device={d} />
          ))}
        </Box>
      )}
    </WidgetCard>
  );
}

// ─── Security ─────────────────────────────────────────────────────────────

function securityState(d: DeviceDto): { text: string; ok: boolean | null } {
  if (d.connectivity !== 'online') return { text: d.connectivity === 'unknown' ? 'Unknown' : `${d.connectivity[0]!.toUpperCase()}${d.connectivity.slice(1)}`, ok: null };
  const s = d.state;
  if (hasCapability(d.capabilities, 'lock')) return s.lockState ? { text: s.lockState[0]!.toUpperCase() + s.lockState.slice(1), ok: s.lockState === 'locked' } : { text: 'Not reported', ok: null };
  if (hasCapability(d.capabilities, 'alarmPanel')) return s.alarmState ? { text: s.alarmState.replace('_', ' ').replace(/^\w/, (c) => c.toUpperCase()), ok: s.alarmState !== 'triggered' } : { text: 'Not reported', ok: null };
  if (hasCapability(d.capabilities, 'safetyAlarm')) return s.hazardDetected === undefined ? { text: 'Not reported', ok: null } : { text: s.hazardDetected ? 'Hazard detected' : 'Clear', ok: !s.hazardDetected };
  if (hasCapability(d.capabilities, 'contact')) return s.contactOpen === undefined ? { text: 'Not reported', ok: null } : { text: s.contactOpen ? 'Open' : 'Closed', ok: !s.contactOpen };
  return { text: describeOperatingState(s, d.capabilities) ?? 'Not reported', ok: null };
}

export function SecurityWidget(_: WidgetProps) {
  const { devices, isLoading, error, refetch } = useSecurityDevices();
  const order = (d: DeviceDto) => (hasCapability(d.capabilities, 'alarmPanel') ? 0 : hasCapability(d.capabilities, 'lock') ? 1 : hasCapability(d.capabilities, 'safetyAlarm') ? 2 : 3);
  const sorted = [...devices].sort((a, b) => order(a) - order(b) || a.name.localeCompare(b.name));
  return (
    <WidgetCard title="Security">
      {isLoading ? (
        <ListSkeleton rows={3} height={44} />
      ) : error ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : !sorted.length ? (
        <WidgetEmpty icon={<ShieldCheck size={20} />} title="No security devices" description="Locks, alarm panels, door/window and safety sensors appear here once imported." />
      ) : (
        <Box>
          {sorted.map((d) => {
            const st = securityState(d);
            const Icon = hasCapability(d.capabilities, 'lock') ? (d.state.lockState === 'locked' ? Lock : LockOpen) : st.ok === false ? AlertTriangle : st.ok ? CheckCircle2 : ShieldCheck;
            return (
              <WidgetRow
                key={d.id}
                leading={<DeviceTile device={d} size={32} />}
                primary={deviceLink(d)}
                secondary={d.roomName ?? 'No room'}
                trailing={
                  <Stack direction="row" spacing={0.5} alignItems="center" sx={{ color: st.ok === false ? 'error.main' : st.ok ? 'success.main' : 'text.secondary' }}>
                    <Icon size={15} aria-hidden />
                    <Typography variant="caption" sx={{ color: 'inherit', fontWeight: 700 }}>
                      {st.text}
                    </Typography>
                  </Stack>
                }
              />
            );
          })}
        </Box>
      )}
    </WidgetCard>
  );
}

// ─── Low battery ──────────────────────────────────────────────────────────

export function LowBatteryWidget(_: WidgetProps) {
  const { homeId, can } = useHome();
  const q = useDevicesQuery({ homeId, battery: 'low', pageSize: 50 }, { pollingInterval: 120_000, skip: !can('devices.view') });
  const devices = useLiveDevices(q.data?.items).filter(isLowBattery).sort((a, b) => (a.state.batteryLevel ?? 0) - (b.state.batteryLevel ?? 0));
  return (
    <WidgetCard title="Low battery">
      {q.isLoading ? (
        <ListSkeleton rows={3} height={44} />
      ) : q.error ? (
        <ErrorState error={q.error} onRetry={q.refetch} />
      ) : !devices.length ? (
        <WidgetEmpty icon={<CheckCircle2 size={20} />} title="All batteries OK" description="No battery-powered device reports 20% or less." />
      ) : (
        <Box>
          {devices.map((d) => (
            <WidgetRow
              key={d.id}
              leading={<DeviceTile device={d} size={32} />}
              primary={deviceLink(d)}
              secondary={`${d.roomName ?? 'No room'} · reported ${timeAgo(d.stateUpdatedAt)}`}
              trailing={<Chip size="small" icon={<BatteryLow size={14} />} label={`${d.state.batteryLevel}%`} sx={{ bgcolor: '#F8E4E2', color: 'error.main', '& .MuiChip-icon': { color: 'inherit' } }} />}
            />
          ))}
        </Box>
      )}
    </WidgetCard>
  );
}

// ─── Needs attention ──────────────────────────────────────────────────────

export function AttentionWidget(_: WidgetProps) {
  const { devices, isLoading, error, refetch } = useAttentionDevices();
  return (
    <WidgetCard title="Needs attention" action={devices.length ? <Chip size="small" label={devices.length} sx={{ bgcolor: '#F8EEDC', color: 'warning.dark' }} aria-label={`${devices.length} devices need attention`} /> : undefined}>
      {isLoading ? (
        <ListSkeleton rows={3} height={44} />
      ) : error ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : !devices.length ? (
        <WidgetEmpty icon={<CheckCircle2 size={20} />} title="Everything is reachable" description="No offline, unavailable or erroring devices." />
      ) : (
        <Box>
          {devices.map((d) => {
            const reason = attentionReason(d)!;
            const conn = d.connectivity !== 'online' || d.integrationDisconnected;
            return (
              <WidgetRow
                key={d.id}
                leading={<DeviceTile device={d} size={32} />}
                primary={deviceLink(d)}
                secondary={conn ? `${d.roomName ?? 'No room'} · last seen ${timeAgo(d.lastSeenAt)}` : reason}
                trailing={conn ? <ConnectivityBadge state={d.connectivity} integrationDisconnected={d.integrationDisconnected} /> : <Chip size="small" icon={<AlertTriangle size={13} />} label="Error" sx={{ bgcolor: '#F8EEDC', color: 'warning.dark', '& .MuiChip-icon': { color: 'inherit' } }} />}
              />
            );
          })}
        </Box>
      )}
    </WidgetCard>
  );
}

// ─── Climate ──────────────────────────────────────────────────────────────

function ClimatePanel({ device: initial }: { device: DeviceDto }) {
  const device = useLiveDevice(initial);
  const fmt = useFormatTemperature();
  const { send, pendingFor, latest } = useDeviceCommand(device);
  const disabledReason = controlsDisabledReason(device);
  const setpoint = hasCapability(device.capabilities, 'temperatureSetpoint');
  const modes = hasCapability(device.capabilities, 'hvacMode');
  const unit = setpoint?.unit ?? 'C';
  const current = device.state.currentTemperature ?? device.state.measurements?.temperature;
  const humidity = device.state.measurements?.humidity;
  return (
    <Stack spacing={1.5}>
      <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0 }}>
        <Box sx={{ minWidth: 0, flex: 1 }}>
          {deviceLink(device)}
          <Typography variant="caption" component="div" noWrap>
            {device.roomName ?? 'No room'}
            {device.state.hvacAction ? ` · ${device.state.hvacAction.replace('_', ' ')}` : ''}
          </Typography>
        </Box>
        {device.isDemo && <DemoBadge compact />}
      </Stack>
      <ConnectivityBadge state={device.connectivity} integrationDisconnected={device.integrationDisconnected} />
      {disabledReason && (
        <Typography variant="caption" color="warning.dark">
          {disabledReason}
        </Typography>
      )}
      {setpoint && <ThermostatControl device={device} cap={setpoint} send={send} pending={pendingFor('temperatureSetpoint')} disabled={!!disabledReason} />}
      {modes && <HvacModeControl device={device} cap={modes} send={send} pending={pendingFor('hvacMode')} disabled={!!disabledReason} />}
      <Stack direction="row" spacing={2} sx={{ pt: 0.5, borderTop: `1px solid ${tokens.color.border}` }}>
        <Box>
          <Typography variant="caption" component="div">
            Current
          </Typography>
          <Typography fontWeight={700}>{current !== undefined ? fmt(current, unit) : <NotAvailable />}</Typography>
        </Box>
        <Box>
          <Typography variant="caption" component="div">
            Humidity
          </Typography>
          <Typography fontWeight={700}>{humidity !== undefined ? `${Math.round(humidity)}%` : <NotAvailable />}</Typography>
        </Box>
        <Box sx={{ ml: 'auto', textAlign: 'right' }}>
          <Typography variant="caption" component="div">
            Updated
          </Typography>
          <Typography variant="caption" fontWeight={600} component="div">
            {timeAgo(device.stateUpdatedAt)}
          </Typography>
        </Box>
      </Stack>
      <CommandStatus command={latest} onRetry={latest ? () => void send(latest.command) : undefined} />
    </Stack>
  );
}

export function ClimateWidget({ widget }: WidgetProps) {
  const { homeId, can } = useHome();
  const q = useDevicesQuery({ homeId, capability: 'temperatureSetpoint', pageSize: 50 }, { skip: !can('devices.view') });
  const configured = typeof widget.config.deviceId === 'string' ? widget.config.deviceId : null;
  const device = q.data?.items.find((d) => d.id === configured) ?? q.data?.items[0];
  return (
    <WidgetCard title="Climate">
      {q.isLoading ? (
        <ListSkeleton rows={3} />
      ) : q.error ? (
        <ErrorState error={q.error} onRetry={q.refetch} />
      ) : !device ? (
        <WidgetEmpty icon={<Thermometer size={20} />} title="No climate devices" description="Thermostats and air conditioners with a temperature setpoint appear here." />
      ) : (
        <ClimatePanel device={device} />
      )}
    </WidgetCard>
  );
}

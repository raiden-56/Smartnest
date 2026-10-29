import { useMemo, useState } from 'react';
import {
  Alert, Box, Breadcrumbs, Button, Chip, Divider, FormControl, IconButton, InputLabel, Link, List, ListItem, ListItemText, MenuItem, Select, Stack, Switch, TextField,
  ToggleButton, ToggleButtonGroup, Tooltip, Typography,
} from '@mui/material';
import { Check, EyeOff, Pencil, RefreshCw, Star, Trash2, X } from 'lucide-react';
import { Link as RouterLink, useNavigate, useParams } from 'react-router-dom';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip as ChartTooltip, XAxis, YAxis } from 'recharts';
import { format } from 'date-fns';
import { CATEGORY_INFO, DEVICE_CATEGORIES, describeOperatingState, hasCapability, type DeviceDto, type DeviceState } from '@smartnest/shared';
import {
  toApiError, useActivityQuery, useDeviceCommandsQuery, useDeviceHistoryQuery, useDeviceQuery, useRefreshDeviceMutation, useRemoveDeviceMutation, useRoomsQuery,
  useUpdateDeviceMutation,
} from '../../api/api';
import { formatDateTime, timeAgo, useHome } from '../../app/hooks';
import { deviceUpdated, pushToast, useAppDispatch, useLiveDevice } from '../../app/store';
import { useConfirm } from '../../components/common/Dialogs';
import { ChartSkeleton, DetailSkeleton, EmptyState, ErrorState, ListSkeleton, PageHeader, SectionCard } from '../../components/common/States';
import { ConnectivityBadge, DemoBadge, SeverityDot } from '../../components/common/StatusBadge';
import { DeviceReadings, FullDeviceControls } from '../../components/devices/CapabilityControls';
import { DeviceTile } from '../../components/devices/DeviceCard';
import { tokens } from '../../theme/theme';

const CAP_LABEL: Record<string, string> = {
  onOff: 'On/off', brightness: 'Brightness', colorRgb: 'Colour', colorTemperature: 'Colour temperature', temperatureSetpoint: 'Temperature setpoint', hvacMode: 'Operating mode',
  fanSpeed: 'Fan speed', swing: 'Swing', position: 'Position', lock: 'Lock', alarmPanel: 'Alarm panel', mediaPlayback: 'Media playback', volume: 'Volume', mediaSource: 'Source',
  battery: 'Battery', power: 'Power', energy: 'Energy', motion: 'Motion', contact: 'Contact', occupancy: 'Occupancy', presence: 'Presence', safetyAlarm: 'Safety alarm',
  sensor: 'Sensor', cameraStream: 'Camera stream', ptz: 'Pan/tilt/zoom', motionDetectionToggle: 'Motion detection', recording: 'Recording', charging: 'Charging',
  vacuum: 'Vacuum', valve: 'Valve', customAction: 'Device actions',
};

const STATUS_CHIP: Record<string, { label: string; color: 'default' | 'success' | 'error' | 'warning' }> = {
  pending: { label: 'Pending', color: 'default' },
  sent: { label: 'Sent', color: 'default' },
  confirmed: { label: 'Confirmed', color: 'success' },
  failed: { label: 'Failed', color: 'error' },
  timed_out: { label: 'Not confirmed', color: 'warning' },
};

/** Pick the most meaningful numeric series the device actually reports. */
function pickSeries(d: DeviceDto): { key: string; label: string; unit: string; get: (s: DeviceState) => number | undefined; step?: boolean } | null {
  if (hasCapability(d.capabilities, 'power')) return { key: 'powerW', label: 'Power', unit: 'W', get: (s) => s.powerW };
  const sensor = d.capabilities.find((c) => c.type === 'sensor') as { key: string; unit: string; label?: string; measurement: string } | undefined;
  if (sensor) return { key: sensor.key, label: sensor.label ?? sensor.measurement, unit: sensor.unit, get: (s) => s.measurements?.[sensor.key] };
  if (hasCapability(d.capabilities, 'brightness')) return { key: 'brightness', label: 'Brightness', unit: '%', get: (s) => (s.on === false ? 0 : s.brightness) };
  if (hasCapability(d.capabilities, 'position')) return { key: 'position', label: 'Position', unit: '%', get: (s) => s.position };
  if (hasCapability(d.capabilities, 'onOff')) return { key: 'on', label: 'Power state', unit: '', get: (s) => (s.on === undefined ? undefined : s.on ? 1 : 0), step: true };
  return null;
}

function HistoryChart({ device }: { device: DeviceDto }) {
  const { homeId } = useHome();
  const [hours, setHours] = useState(24);
  const q = useDeviceHistoryQuery({ homeId, deviceId: device.id, hours });
  const series = pickSeries(device);
  const data = useMemo(
    () => (q.data?.history ?? []).map((h) => ({ t: new Date(h.t).getTime(), v: series?.get(h.state as DeviceState) ?? null })).filter((x) => x.v !== null),
    [q.data, series],
  );
  if (!series) return null;
  return (
    <SectionCard
      title={`${series.label} history`}
      action={
        <ToggleButtonGroup size="small" exclusive value={hours} onChange={(_, v) => v && setHours(v)} aria-label="History range">
          <ToggleButton value={6}>6h</ToggleButton>
          <ToggleButton value={24}>24h</ToggleButton>
          <ToggleButton value={168}>7d</ToggleButton>
        </ToggleButtonGroup>
      }
    >
      {q.isLoading ? (
        <ChartSkeleton height={220} />
      ) : data.length < 2 ? (
        <Typography color="text.secondary" variant="body2" sx={{ py: 4, textAlign: 'center' }}>
          Not enough recorded history yet. SmartNest keeps sampled state history for {''}
          the retention period set in Settings → Privacy &amp; data.
        </Typography>
      ) : (
        <Box role="img" aria-label={`${series.label} over the last ${hours} hours, ${data.length} samples`} sx={{ height: 220 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
              <CartesianGrid stroke={tokens.color.border} vertical={false} />
              <XAxis dataKey="t" type="number" domain={['dataMin', 'dataMax']} scale="time" tickFormatter={(t) => format(t, hours > 24 ? 'EEE HH:mm' : 'HH:mm')} stroke={tokens.color.textSecondary} fontSize={12} />
              <YAxis stroke={tokens.color.textSecondary} fontSize={12} unit={series.unit ? ` ${series.unit}` : ''} width={64} {...(series.step ? { ticks: [0, 1], tickFormatter: (v: number) => (v ? 'On' : 'Off') } : {})} />
              <ChartTooltip labelFormatter={(t) => format(Number(t), 'd MMM HH:mm')} formatter={(v: number) => [series.step ? (v ? 'On' : 'Off') : `${v} ${series.unit}`, series.label]} />
              <Line type={series.step ? 'stepAfter' : 'monotone'} dataKey="v" stroke={tokens.color.primary} strokeWidth={2} dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </Box>
      )}
    </SectionCard>
  );
}

function ManagementCard({ device, energyRole }: { device: DeviceDto; energyRole: string | null }) {
  const { homeId } = useHome();
  const rooms = useRoomsQuery(homeId);
  const [update] = useUpdateDeviceMutation();
  const [remove] = useRemoveDeviceMutation();
  const confirm = useConfirm();
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const save = async (body: { roomId?: string | null; category?: string; energyRole?: string; isFavourite?: boolean; isHidden?: boolean }, ok: string) => {
    try {
      const r = await update({ homeId, deviceId: device.id, ...body }).unwrap();
      dispatch(deviceUpdated(r.device));
      dispatch(pushToast({ message: ok, severity: 'success' }));
    } catch (e) {
      dispatch(pushToast({ message: toApiError(e).message, severity: 'error' }));
    }
  };
  const supportsEnergy = device.capabilities.some((c) => c.type === 'power' || c.type === 'energy');
  return (
    <SectionCard title="Manage">
      <Stack spacing={2}>
        <FormControl size="small" fullWidth>
          <InputLabel id="room-sel">Room</InputLabel>
          <Select labelId="room-sel" label="Room" value={device.roomId ?? ''} onChange={(e) => void save({ roomId: e.target.value || null }, 'Room updated')}>
            <MenuItem value="">
              <em>No room</em>
            </MenuItem>
            {rooms.data?.rooms.map((r) => (
              <MenuItem key={r.id} value={r.id}>
                {r.name}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <FormControl size="small" fullWidth>
          <InputLabel id="cat-sel">Category</InputLabel>
          <Select labelId="cat-sel" label="Category" value={device.category} onChange={(e) => void save({ category: e.target.value }, 'Category updated')}>
            {DEVICE_CATEGORIES.map((c) => (
              <MenuItem key={c} value={c}>
                {CATEGORY_INFO[c].label}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        {supportsEnergy && (
          <FormControl size="small" fullWidth>
            <InputLabel id="role-sel">Energy role</InputLabel>
            <Select labelId="role-sel" label="Energy role" value={energyRole ?? 'device'} onChange={(e) => void save({ energyRole: e.target.value }, 'Energy role updated')}>
              <MenuItem value="device">Individual device</MenuItem>
              <MenuItem value="consumption">Whole-home consumption (meter)</MenuItem>
              <MenuItem value="solar">Solar generation</MenuItem>
              <MenuItem value="battery">Home battery</MenuItem>
              <MenuItem value="ev">EV charging</MenuItem>
            </Select>
          </FormControl>
        )}
        <Stack direction="row" alignItems="center" justifyContent="space-between">
          <Box>
            <Typography variant="body2" fontWeight={600}>
              Favourite
            </Typography>
            <Typography variant="caption">Shown on your dashboard.</Typography>
          </Box>
          <Switch checked={device.isFavourite} onChange={(e) => void save({ isFavourite: e.target.checked }, e.target.checked ? 'Added to favourites' : 'Removed from favourites')} inputProps={{ 'aria-label': 'Favourite' }} />
        </Stack>
        <Stack direction="row" alignItems="center" justifyContent="space-between">
          <Box>
            <Typography variant="body2" fontWeight={600}>
              Hide / ignore
            </Typography>
            <Typography variant="caption">Stays connected, but is excluded from lists and counts.</Typography>
          </Box>
          <Switch checked={device.isHidden} onChange={(e) => void save({ isHidden: e.target.checked }, e.target.checked ? 'Device hidden' : 'Device shown')} inputProps={{ 'aria-label': 'Hide device' }} />
        </Stack>
        <Divider />
        <Box>
          <Button
            color="error"
            variant="outlined"
            startIcon={<Trash2 size={16} />}
            onClick={async () => {
              const ok = await confirm({
                title: `Remove ${device.name} from SmartNest?`,
                message: `Removes this device, its scene actions and its history from SmartNest. The physical device and its ${device.integrationName} entity are not changed; you can re-import it later.`,
                tone: 'danger',
                confirmLabel: 'Remove',
              });
              if (!ok) return;
              try {
                await remove({ homeId, deviceId: device.id }).unwrap();
                dispatch(pushToast({ message: `${device.name} removed`, severity: 'success' }));
                navigate('/devices');
              } catch (e) {
                dispatch(pushToast({ message: toApiError(e).message, severity: 'error' }));
              }
            }}
          >
            Remove from SmartNest
          </Button>
          <Typography variant="caption" component="p" sx={{ mt: 1 }}>
            To stop SmartNest syncing a whole integration, use <Link component={RouterLink} to={`/integrations/${device.integrationId}`}>Disconnect integration</Link>. Turning a device off is a normal
            command and does not remove or disconnect it.
          </Typography>
        </Box>
      </Stack>
    </SectionCard>
  );
}

export default function DeviceDetailPage() {
  const { deviceId = '' } = useParams();
  const { homeId, can } = useHome();
  const q = useDeviceQuery({ homeId, deviceId });
  const device = useLiveDevice(q.data?.device);
  const commands = useDeviceCommandsQuery({ homeId, deviceId });
  const activity = useActivityQuery({ homeId, deviceId, limit: 10 }, { skip: !can('activity.view') });
  const [refresh, refreshState] = useRefreshDeviceMutation();
  const [update] = useUpdateDeviceMutation();
  const [editingName, setEditingName] = useState<string | null>(null);
  const dispatch = useAppDispatch();
  const navigate = useNavigate();

  if (q.isLoading) return <DetailSkeleton />;
  if (q.error) {
    if (toApiError(q.error).status === 404) return <EmptyState title="Device not found" description="It may have been removed." action={<Button onClick={() => navigate('/devices')}>Back to devices</Button>} />;
    return <ErrorState error={q.error} onRetry={q.refetch} />;
  }
  if (!device) return null;
  const op = describeOperatingState(device.state, device.capabilities);
  const manage = can('devices.manage');

  const saveName = async () => {
    if (!editingName?.trim()) return;
    try {
      const r = await update({ homeId, deviceId, name: editingName.trim() }).unwrap();
      dispatch(deviceUpdated(r.device));
      setEditingName(null);
    } catch (e) {
      dispatch(pushToast({ message: toApiError(e).message, severity: 'error' }));
    }
  };

  return (
    <>
      <Breadcrumbs sx={{ mb: 1 }}>
        <Link component={RouterLink} to="/devices" underline="hover" color="inherit">
          Devices
        </Link>
        {device.roomId && (
          <Link component={RouterLink} to={`/rooms/${device.roomId}`} underline="hover" color="inherit">
            {device.roomName}
          </Link>
        )}
        <Typography color="text.primary">{device.name}</Typography>
      </Breadcrumbs>
      <PageHeader
        title={
          <Stack direction="row" spacing={1.5} alignItems="center">
            <DeviceTile device={device} size={52} />
            {editingName !== null ? (
              <Stack direction="row" spacing={0.5} alignItems="center" component="span">
                <TextField size="small" value={editingName} onChange={(e) => setEditingName(e.target.value)} autoFocus inputProps={{ 'aria-label': 'Device name', maxLength: 80 }} onKeyDown={(e) => e.key === 'Enter' && void saveName()} />
                <IconButton aria-label="Save name" onClick={() => void saveName()}>
                  <Check size={18} />
                </IconButton>
                <IconButton aria-label="Cancel renaming" onClick={() => setEditingName(null)}>
                  <X size={18} />
                </IconButton>
              </Stack>
            ) : (
              <Stack direction="row" spacing={0.5} alignItems="center" component="span" sx={{ minWidth: 0 }}>
                <span>{device.name}</span>
                {manage && (
                  <IconButton aria-label="Rename device" onClick={() => setEditingName(device.name)} size="small">
                    <Pencil size={16} />
                  </IconButton>
                )}
              </Stack>
            )}
          </Stack>
        }
        subtitle={
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap component="span" sx={{ mt: 0.5 }}>
            <ConnectivityBadge state={device.connectivity} integrationDisconnected={device.integrationDisconnected} size="medium" />
            {device.isDemo && <DemoBadge />}
            {device.isFavourite && <Chip size="small" icon={<Star size={13} />} label="Favourite" />}
            {device.isHidden && <Chip size="small" icon={<EyeOff size={13} />} label="Hidden" />}
            <span>{op ? `${device.connectivity === 'online' ? '' : 'Last known: '}${op}` : ''}</span>
          </Stack>
        }
        actions={
          <Tooltip title="Ask the integration for this device's current state">
            <span>
              <Button
                variant="outlined"
                startIcon={<RefreshCw size={16} className={refreshState.isLoading ? 'spin' : undefined} />}
                disabled={refreshState.isLoading || device.integrationDisconnected}
                onClick={async () => {
                  try {
                    const r = await refresh({ homeId, deviceId }).unwrap();
                    dispatch(deviceUpdated(r.device));
                    dispatch(pushToast({ message: 'State refreshed from the integration', severity: 'success' }));
                  } catch (e) {
                    dispatch(pushToast({ message: toApiError(e).message, severity: 'error' }));
                  }
                }}
              >
                Refresh state
              </Button>
            </span>
          </Tooltip>
        }
      />

      {q.data?.metadata.demoNote && (
        <Alert severity="info" sx={{ mb: 2 }}>
          Demo: {q.data.metadata.demoNote}
        </Alert>
      )}
      {device.integrationDisconnected && (
        <Alert severity="warning" sx={{ mb: 2 }} action={can('integrations.manage') && <Button component={RouterLink} to={`/integrations/${device.integrationId}`} color="inherit" size="small">Reconnect</Button>}>
          {device.integrationName} is disconnected. This device's record is kept, but its state cannot be read or controlled until the integration is reconnected.
        </Alert>
      )}
      {device.lastError && device.connectivity === 'online' && !device.integrationDisconnected && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          Last command problem: {device.lastError}
        </Alert>
      )}

      <Box sx={{ display: 'grid', gap: 2.5, gridTemplateColumns: { xs: '1fr', lg: 'minmax(0, 1fr) 360px' }, alignItems: 'start' }}>
        <Stack spacing={2.5} sx={{ minWidth: 0 }}>
          {can('devices.control') ? (
            <SectionCard title="Controls">
              <FullDeviceControls device={device} canControlCameras={can('cameras.control')} />
            </SectionCard>
          ) : (
            <Alert severity="info">Your role can view this device but not control it.</Alert>
          )}
          <HistoryChart device={device} />
          <SectionCard title="Recent commands">
            {commands.isLoading ? (
              <ListSkeleton rows={3} height={44} />
            ) : commands.data?.commands.length ? (
              <List dense disablePadding>
                {commands.data.commands.map((c) => (
                  <ListItem key={c.id} disableGutters divider sx={{ gap: 1, alignItems: 'flex-start' }}>
                    <ListItemText
                      primary={c.description}
                      secondary={`${formatDateTime(c.createdAt)} · ${c.source}${c.errorMessage ? ` · ${c.errorMessage}` : ''}`}
                      primaryTypographyProps={{ fontWeight: 600, variant: 'body2' }}
                    />
                    <Chip size="small" label={c.status === 'confirmed' && !c.verified ? 'Acknowledged' : STATUS_CHIP[c.status]!.label} color={STATUS_CHIP[c.status]!.color} variant="outlined" />
                  </ListItem>
                ))}
              </List>
            ) : (
              <Typography variant="body2" color="text.secondary">
                No commands have been sent to this device yet.
              </Typography>
            )}
          </SectionCard>
          {can('activity.view') && (
            <SectionCard title="Activity" action={<Button size="small" component={RouterLink} to="/activity">All activity</Button>}>
              {activity.data?.items.length ? (
                <List dense disablePadding>
                  {activity.data.items.map((a) => (
                    <ListItem key={a.id} disableGutters sx={{ gap: 1.25, alignItems: 'flex-start' }}>
                      <Box sx={{ pt: 1 }}>
                        <SeverityDot severity={a.severity} />
                      </Box>
                      <ListItemText primary={a.title} secondary={`${timeAgo(a.createdAt)}${a.actorName ? ` · ${a.actorName}` : ''}`} primaryTypographyProps={{ variant: 'body2' }} />
                    </ListItem>
                  ))}
                </List>
              ) : (
                <Typography variant="body2" color="text.secondary">
                  No recent activity.
                </Typography>
              )}
            </SectionCard>
          )}
        </Stack>

        <Stack spacing={2.5}>
          <SectionCard title="Readings">
            <DeviceReadings device={device} />
            {!device.capabilities.some((c) => ['sensor', 'battery', 'power', 'energy', 'motion', 'contact', 'occupancy', 'presence', 'safetyAlarm', 'recording', 'charging', 'hvacMode'].includes(c.type)) && (
              <Typography variant="body2" color="text.secondary">
                This device does not report sensor readings.
              </Typography>
            )}
          </SectionCard>
          <SectionCard title="Details">
            <Box component="dl" sx={{ display: 'grid', gridTemplateColumns: 'auto 1fr', columnGap: 2, rowGap: 1, m: 0, '& dt': { color: 'text.secondary', fontSize: '0.85rem' }, '& dd': { m: 0, fontSize: '0.85rem', fontWeight: 600, textAlign: 'right', wordBreak: 'break-word' } }}>
              <dt>Integration</dt>
              <dd>
                {can('integrations.view') ? (
                  <Link component={RouterLink} to={`/integrations/${device.integrationId}`}>
                    {device.integrationName}
                  </Link>
                ) : (
                  device.integrationName
                )}
              </dd>
              <dt>Integration ID</dt>
              <dd style={{ fontFamily: 'monospace' }}>{device.externalId}</dd>
              <dt>Manufacturer</dt>
              <dd>{device.manufacturer ?? 'Not reported'}</dd>
              <dt>Model</dt>
              <dd>{device.model ?? 'Not reported'}</dd>
              <dt>Category</dt>
              <dd>{CATEGORY_INFO[device.category].label}</dd>
              <dt>Last update</dt>
              <dd>{formatDateTime(device.stateUpdatedAt)}</dd>
              <dt>Last seen</dt>
              <dd>{formatDateTime(device.lastSeenAt)}</dd>
              <dt>Last successful command</dt>
              <dd>{formatDateTime(device.lastCommandAt)}</dd>
            </Box>
            <Typography variant="overline" color="text.secondary" component="p" sx={{ mt: 2, mb: 0.75 }}>
              Supported capabilities
            </Typography>
            <Stack direction="row" flexWrap="wrap" useFlexGap gap={0.75}>
              {device.capabilities.map((c, i) => (
                <Chip key={i} size="small" variant="outlined" label={c.type === 'sensor' ? `Sensor: ${c.label ?? c.measurement}` : (CAP_LABEL[c.type] ?? c.type)} />
              ))}
            </Stack>
          </SectionCard>
          {manage && <ManagementCard device={device} energyRole={q.data?.metadata.energyRole ?? null} />}
        </Stack>
      </Box>
    </>
  );
}

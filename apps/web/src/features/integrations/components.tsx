import { useEffect, useMemo, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  Alert, Box, Button, Checkbox, Chip, CircularProgress, FormControl, InputAdornment, InputLabel, MenuItem, Select, Stack, TextField, Tooltip, Typography,
} from '@mui/material';
import { AlertTriangle, CheckCircle2, CircleDashed, CircleHelp, KeyRound, Loader2, PlugZap, Search, XCircle } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { CATEGORY_INFO, homeAssistantConnectSchema, type DiscoveredDeviceDto, type IntegrationDto } from '@smartnest/shared';
import { toApiError, useConnectHomeAssistantMutation, useImportDevicesMutation, useRoomsQuery, type ImportResult } from '../../api/api';
import { AppIcon } from '../../components/common/AppIcon';
import { ConnectivityBadge } from '../../components/common/StatusBadge';
import { tokens } from '../../theme/theme';

// ─── Status chip ──────────────────────────────────────────────────────────

const STATUS: Record<IntegrationDto['status'], { label: string; icon: typeof CheckCircle2; color: string; bg: string }> = {
  connected: { label: 'Connected', icon: CheckCircle2, color: tokens.color.success, bg: '#E3F0E7' },
  connecting: { label: 'Connecting', icon: Loader2, color: tokens.color.textSecondary, bg: tokens.color.disabled },
  error: { label: 'Error', icon: AlertTriangle, color: tokens.color.error, bg: '#F8E4E2' },
  auth_failed: { label: 'Authentication failed', icon: KeyRound, color: tokens.color.error, bg: '#F8E4E2' },
  disconnected: { label: 'Disconnected', icon: PlugZap, color: tokens.color.textSecondary, bg: tokens.color.disabled },
};

/** Integration status: icon + text, never colour alone. */
export function IntegrationStatusChip({ status, size = 'small' }: { status: IntegrationDto['status']; size?: 'small' | 'medium' }) {
  const s = STATUS[status];
  const Icon = s.icon;
  return (
    <Chip
      size={size}
      icon={<Icon size={14} className={status === 'connecting' ? 'spin' : undefined} aria-hidden />}
      label={s.label}
      sx={{ bgcolor: s.bg, color: s.color, '& .MuiChip-icon': { color: 'inherit', ml: '6px' } }}
    />
  );
}

export function prettyCapability(type: string): string {
  const map: Record<string, string> = {
    onOff: 'On/off', colorRgb: 'Colour', colorTemperature: 'Colour temp', temperatureSetpoint: 'Setpoint', hvacMode: 'HVAC mode', fanSpeed: 'Fan speed',
    alarmPanel: 'Alarm panel', mediaPlayback: 'Playback', mediaSource: 'Source', safetyAlarm: 'Safety alarm', cameraStream: 'Camera', ptz: 'PTZ',
    motionDetectionToggle: 'Motion detection', customAction: 'Actions',
  };
  return map[type] ?? type.replace(/([A-Z])/g, ' $1').replace(/^\w/, (c) => c.toUpperCase());
}

// ─── Home Assistant connect form ─────────────────────────────────────────

const haFormSchema = z.object({
  name: z.string().trim().min(1, 'Give the integration a name').max(60),
  baseUrl: homeAssistantConnectSchema.shape.baseUrl,
  accessToken: homeAssistantConnectSchema.shape.accessToken,
});
type HaForm = z.infer<typeof haFormSchema>;

function haErrorMessage(err: unknown): string {
  const e = toApiError(err);
  if (e.status === 401) return 'Home Assistant rejected the access token. Create a new long-lived access token in your Home Assistant profile and paste it again.';
  if (e.status === 400) return e.message;
  if (e.status === 502 || e.status === 504) return `SmartNest could not reach Home Assistant at that address. Check the URL and that the SmartNest server can reach it. (${e.message})`;
  if (e.status === 403) return 'You do not have permission to add integrations to this home.';
  return e.message;
}

/**
 * Connects Home Assistant. Nothing is saved unless SmartNest verifies the URL
 * and token against Home Assistant first.
 */
export function HomeAssistantForm({
  homeId,
  onConnected,
}: {
  homeId: string;
  onConnected: (r: { integration: IntegrationDto; discovered: DiscoveredDeviceDto[] }) => void;
}) {
  const [connect, { isLoading }] = useConnectHomeAssistantMutation();
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, formState } = useForm<HaForm>({
    resolver: zodResolver(haFormSchema),
    defaultValues: { name: 'Home Assistant', baseUrl: '', accessToken: '' },
  });
  return (
    <form
      noValidate
      onSubmit={handleSubmit(async (v) => {
        setError(null);
        try {
          const r = await connect({ homeId, ...v }).unwrap();
          onConnected(r);
        } catch (e) {
          setError(haErrorMessage(e));
        }
      })}
    >
      <Stack spacing={2}>
        {error && (
          <Alert severity="error" role="alert">
            {error}
          </Alert>
        )}
        <TextField label="Name" {...register('name')} error={!!formState.errors.name} helperText={formState.errors.name?.message} disabled={isLoading} />
        <TextField
          label="Home Assistant URL"
          placeholder="http://homeassistant.local:8123"
          inputMode="url"
          autoComplete="url"
          {...register('baseUrl')}
          error={!!formState.errors.baseUrl}
          helperText={formState.errors.baseUrl?.message ?? 'The address the SmartNest server uses to reach Home Assistant.'}
          disabled={isLoading}
        />
        <TextField
          label="Long-lived access token"
          type="password"
          autoComplete="off"
          {...register('accessToken')}
          error={!!formState.errors.accessToken}
          helperText={
            formState.errors.accessToken?.message ??
            'Encrypted at rest on the server and never shown again — not even to you. To rotate it, reconnect with a new token.'
          }
          disabled={isLoading}
          InputProps={{ startAdornment: (<InputAdornment position="start"><KeyRound size={16} /></InputAdornment>) }}
        />
        <Button type="submit" variant="contained" size="large" disabled={isLoading} startIcon={isLoading ? <CircularProgress size={16} color="inherit" /> : undefined}>
          {isLoading ? 'Verifying connection…' : 'Connect Home Assistant'}
        </Button>
        {isLoading && (
          <Typography variant="caption" role="status">
            SmartNest is checking the URL, verifying the token with Home Assistant and listing the entities it can map. This can take a few seconds.
          </Typography>
        )}
      </Stack>
    </form>
  );
}

// ─── Discovery review & import ───────────────────────────────────────────

interface Selection {
  selected: boolean;
  name: string;
  roomId: string | null;
}

export function DiscoveryReview({
  homeId,
  integrationId,
  discovered,
  onImported,
}: {
  homeId: string;
  integrationId: string;
  discovered: DiscoveredDeviceDto[];
  onImported: (results: ImportResult[]) => void;
}) {
  const rooms = useRoomsQuery(homeId);
  const [importDevices, { isLoading }] = useImportDevicesMutation();
  const [sel, setSel] = useState<Record<string, Selection>>({});
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Initialise selections once rooms are known (prefill rooms from integration areas)
  useEffect(() => {
    if (!rooms.data) return;
    setSel((prev) => {
      const next = { ...prev };
      for (const d of discovered) {
        if (next[d.externalId]) continue;
        const match = d.suggestedRoom ? rooms.data!.rooms.find((r) => r.name.toLowerCase() === d.suggestedRoom!.toLowerCase()) : undefined;
        next[d.externalId] = { selected: !d.alreadyImported, name: d.name, roomId: match?.id ?? null };
      }
      return next;
    });
  }, [discovered, rooms.data]);

  const categories = useMemo(() => [...new Set(discovered.map((d) => d.category))].sort(), [discovered]);
  const visible = discovered.filter(
    (d) => (!category || d.category === category) && (!q || `${d.name} ${d.externalId} ${d.manufacturer ?? ''}`.toLowerCase().includes(q.toLowerCase())),
  );
  const importable = visible.filter((d) => !d.alreadyImported);
  const selectedIds = discovered.filter((d) => !d.alreadyImported && sel[d.externalId]?.selected).map((d) => d.externalId);
  const allVisibleSelected = importable.length > 0 && importable.every((d) => sel[d.externalId]?.selected);

  const update = (id: string, patch: Partial<Selection>) => setSel((s) => ({ ...s, [id]: { ...s[id]!, ...patch } }));
  const setAll = (v: boolean) => setSel((s) => {
    const next = { ...s };
    for (const d of importable) next[d.externalId] = { ...next[d.externalId]!, selected: v };
    return next;
  });

  const submit = async () => {
    setError(null);
    const devices = selectedIds.map((externalId) => ({ externalId, name: sel[externalId]!.name.trim() || externalId, roomId: sel[externalId]!.roomId }));
    try {
      const r = await importDevices({ homeId, integrationId, devices }).unwrap();
      onImported(r.results);
    } catch (e) {
      setError(toApiError(e).message);
    }
  };

  if (!discovered.length) {
    return (
      <Alert severity="info">
        The integration did not report any devices SmartNest can map. Check the integration's entities, then run discovery again.
      </Alert>
    );
  }

  return (
    <Stack spacing={2}>
      <Alert severity="info" icon={<CircleHelp size={18} />}>
        Discovery lists what the integration reports. It does not grant SmartNest permission to control anything you don't own — only import devices you are allowed to
        control.
      </Alert>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
        <TextField
          size="small"
          placeholder="Search discovered devices"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          inputProps={{ 'aria-label': 'Search discovered devices' }}
          InputProps={{ startAdornment: (<InputAdornment position="start"><Search size={16} /></InputAdornment>) }}
        />
        <FormControl size="small" sx={{ minWidth: 200 }}>
          <InputLabel id="disc-cat">Category</InputLabel>
          <Select labelId="disc-cat" label="Category" value={category} onChange={(e) => setCategory(String(e.target.value))}>
            <MenuItem value="">All categories</MenuItem>
            {categories.map((c) => (
              <MenuItem key={c} value={c}>
                {CATEGORY_INFO[c]?.label ?? c}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      </Stack>
      <Stack direction="row" alignItems="center" justifyContent="space-between" flexWrap="wrap" useFlexGap spacing={1}>
        <Stack direction="row" alignItems="center">
          <Checkbox
            checked={allVisibleSelected}
            indeterminate={!allVisibleSelected && importable.some((d) => sel[d.externalId]?.selected)}
            onChange={(e) => setAll(e.target.checked)}
            disabled={!importable.length}
            inputProps={{ 'aria-label': 'Select all shown devices' }}
          />
          <Typography variant="body2">
            {selectedIds.length} of {discovered.filter((d) => !d.alreadyImported).length} new devices selected
          </Typography>
        </Stack>
        <Stack direction="row" spacing={1}>
          <Button size="small" onClick={() => setAll(true)} disabled={!importable.length}>
            Select all shown
          </Button>
          <Button size="small" onClick={() => setAll(false)} disabled={!importable.length}>
            Select none
          </Button>
        </Stack>
      </Stack>

      <Stack spacing={1} sx={{ maxHeight: 520, overflowY: 'auto', pr: 0.5 }} role="list" aria-label="Discovered devices">
        {visible.map((d) => {
          const s = sel[d.externalId];
          const disabled = d.alreadyImported;
          return (
            <Box
              key={d.externalId}
              role="listitem"
              sx={{
                p: 1.5, border: `1px solid ${s?.selected && !disabled ? tokens.color.primary : tokens.color.border}`, borderRadius: `${tokens.radius.md}px`,
                bgcolor: disabled ? tokens.color.disabled : 'background.paper', display: 'grid', gap: 1.25,
                gridTemplateColumns: { xs: 'auto 1fr', md: 'auto minmax(180px, 1.3fr) minmax(150px, 1fr) minmax(160px, 1fr)' }, alignItems: 'center',
              }}
            >
              <Checkbox
                checked={!disabled && !!s?.selected}
                disabled={disabled}
                onChange={(e) => update(d.externalId, { selected: e.target.checked })}
                inputProps={{ 'aria-label': `Import ${d.name}` }}
              />
              <Box sx={{ minWidth: 0 }}>
                <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5 }}>
                  <AppIcon name={CATEGORY_INFO[d.category]?.icon ?? 'box'} size={16} color={tokens.color.primary} />
                  <Typography variant="caption" noWrap title={d.externalId}>
                    {d.externalId}
                  </Typography>
                </Stack>
                <TextField
                  size="small"
                  value={s?.name ?? d.name}
                  onChange={(e) => update(d.externalId, { name: e.target.value })}
                  disabled={disabled}
                  inputProps={{ 'aria-label': `Name for ${d.externalId}`, maxLength: 80 }}
                />
              </Box>
              <FormControl size="small" disabled={disabled} sx={{ gridColumn: { xs: '2', md: 'auto' } }}>
                <InputLabel id={`room-${d.externalId}`}>Room</InputLabel>
                <Select
                  labelId={`room-${d.externalId}`}
                  label="Room"
                  value={s?.roomId ?? ''}
                  onChange={(e) => update(d.externalId, { roomId: e.target.value ? String(e.target.value) : null })}
                >
                  <MenuItem value="">No room</MenuItem>
                  {rooms.data?.rooms.map((r) => (
                    <MenuItem key={r.id} value={r.id}>
                      {r.name}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              <Stack spacing={0.75} sx={{ gridColumn: { xs: '2', md: 'auto' }, minWidth: 0 }}>
                <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                  <ConnectivityBadge state={d.connectivity} />
                  {d.alreadyImported && <Chip size="small" label="Already imported" icon={<CheckCircle2 size={13} />} />}
                </Stack>
                <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                  {d.capabilities.slice(0, 4).map((c, i) => (
                    <Chip key={`${c.type}-${i}`} size="small" variant="outlined" label={prettyCapability(c.type)} sx={{ height: 22, fontSize: '0.7rem' }} />
                  ))}
                  {d.capabilities.length > 4 && (
                    <Tooltip title={d.capabilities.slice(4).map((c) => prettyCapability(c.type)).join(', ')}>
                      <Chip size="small" variant="outlined" label={`+${d.capabilities.length - 4}`} sx={{ height: 22, fontSize: '0.7rem' }} />
                    </Tooltip>
                  )}
                </Stack>
              </Stack>
            </Box>
          );
        })}
        {!visible.length && (
          <Typography color="text.secondary" sx={{ py: 3, textAlign: 'center' }}>
            No discovered devices match your filters.
          </Typography>
        )}
      </Stack>

      {error && <Alert severity="error">{error}</Alert>}
      <Stack direction="row" justifyContent="flex-end">
        <Button variant="contained" size="large" disabled={!selectedIds.length || isLoading} onClick={() => void submit()} startIcon={isLoading ? <CircularProgress size={16} color="inherit" /> : undefined}>
          {isLoading ? 'Importing and testing…' : `Import ${selectedIds.length} device${selectedIds.length === 1 ? '' : 's'}`}
        </Button>
      </Stack>
    </Stack>
  );
}

/** Per-device import and connectivity-test results. */
export function ImportResults({ results, discovered }: { results: ImportResult[]; discovered?: DiscoveredDeviceDto[] }) {
  const nameOf = (id: string) => discovered?.find((d) => d.externalId === id)?.name ?? id;
  const imported = results.filter((r) => r.status === 'imported');
  const problems = imported.filter((r) => !r.tested || r.connectivity !== 'online').length + results.filter((r) => r.status === 'not_found').length;
  return (
    <Stack spacing={2}>
      <Alert severity={problems ? 'warning' : 'success'}>
        {imported.length} device{imported.length === 1 ? '' : 's'} imported.{' '}
        {problems ? `${problems} need${problems === 1 ? 's' : ''} attention — see details below.` : 'Every imported device responded to a state read-back.'}
      </Alert>
      <Stack spacing={1} role="list" aria-label="Import results">
        {results.map((r) => {
          const ok = r.status === 'imported' && r.tested && r.connectivity === 'online';
          const Icon = r.status === 'not_found' ? XCircle : r.status === 'already_imported' ? CircleDashed : ok ? CheckCircle2 : AlertTriangle;
          const color = r.status === 'not_found' ? tokens.color.error : r.status === 'already_imported' ? tokens.color.textSecondary : ok ? tokens.color.success : tokens.color.warning;
          return (
            <Stack key={r.externalId} role="listitem" direction="row" spacing={1.5} alignItems="flex-start" sx={{ p: 1.5, border: `1px solid ${tokens.color.border}`, borderRadius: `${tokens.radius.md}px` }}>
              <Box sx={{ color, pt: 0.25 }}>
                <Icon size={18} aria-hidden />
              </Box>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography fontWeight={600} noWrap>
                  {nameOf(r.externalId)}
                </Typography>
                <Typography variant="caption" component="p">
                  {r.status === 'imported' ? 'Imported' : r.status === 'already_imported' ? 'Already imported — skipped' : 'Not found in latest discovery'}
                  {r.status === 'imported' && (r.tested ? ' · state read back successfully' : ' · could not be tested yet')}
                </Typography>
                {r.message && (
                  <Typography variant="caption" component="p" sx={{ color: 'warning.dark' }}>
                    {r.message}
                  </Typography>
                )}
              </Box>
              {r.connectivity && <ConnectivityBadge state={r.connectivity as 'online' | 'offline' | 'unavailable' | 'unknown'} />}
            </Stack>
          );
        })}
      </Stack>
    </Stack>
  );
}

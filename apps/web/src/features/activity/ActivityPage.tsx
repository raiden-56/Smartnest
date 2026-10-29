import { useEffect, useMemo, useState } from 'react';
import { Box, Button, Card, Chip, InputAdornment, Link, MenuItem, Stack, TextField, Typography } from '@mui/material';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Activity as ActivityIcon, AlertTriangle, BatteryLow, Bot, Camera, CheckCircle2, Clock, Plug, PlugZap, Power, Search, Shield, Sparkles, Trash2, UserPlus, Wifi, XCircle, Zap,
  type LucideIcon,
} from 'lucide-react';
import { Link as RouterLink, useSearchParams } from 'react-router-dom';
import { format, isToday, isYesterday } from 'date-fns';
import { ACTIVITY_TYPES, CATEGORY_INFO, DEVICE_CATEGORIES, type ActivityDto, type ActivityType } from '@smartnest/shared';
import { api, useActivityQuery, useDevicesQuery, useRoomsQuery, type ActivityArgs } from '../../api/api';
import { formatTime, useHome } from '../../app/hooks';
import { EmptyState, ErrorState, ListSkeleton, PageHeader, PermissionDenied } from '../../components/common/States';
import { DemoBadge, SeverityDot } from '../../components/common/StatusBadge';
import { tokens } from '../../theme/theme';

export const ACTIVITY_LABELS: Record<ActivityType, string> = {
  'device.command': 'Device command',
  'device.state': 'Device state change',
  'device.connectivity': 'Connectivity change',
  'device.battery_low': 'Low battery',
  'device.added': 'Device added',
  'device.removed': 'Device removed',
  'scene.executed': 'Scene run',
  'automation.executed': 'Automation run',
  'automation.failed': 'Automation failure',
  'security.event': 'Security event',
  'camera.event': 'Camera event',
  'integration.connected': 'Integration connected',
  'integration.error': 'Integration error',
  'integration.disconnected': 'Integration disconnected',
  'home.member': 'Household member',
  'energy.threshold': 'Energy alert',
};

const TYPE_ICON: Record<ActivityType, LucideIcon> = {
  'device.command': Power,
  'device.state': ActivityIcon,
  'device.connectivity': Wifi,
  'device.battery_low': BatteryLow,
  'device.added': Plug,
  'device.removed': Trash2,
  'scene.executed': Sparkles,
  'automation.executed': Bot,
  'automation.failed': Bot,
  'security.event': Shield,
  'camera.event': Camera,
  'integration.connected': Plug,
  'integration.error': PlugZap,
  'integration.disconnected': PlugZap,
  'home.member': UserPlus,
  'energy.threshold': Zap,
};

const SEVERITY_LABEL = { info: 'Info', success: 'Success', warning: 'Warning', critical: 'Critical' } as const;
const SOURCE_LABEL = { user: 'User', automation: 'Automation', scene: 'Scene', integration: 'Integration', system: 'System' } as const;

type TimeRange = 'all' | '24h' | '7d' | '30d' | 'custom';

interface Filters {
  q: string;
  deviceId: string;
  roomId: string;
  category: string;
  severity: string;
  type: string;
  source: string;
  time: TimeRange;
  from: string;
  to: string;
}

const EMPTY: Filters = { q: '', deviceId: '', roomId: '', category: '', severity: '', type: '', source: '', time: 'all', from: '', to: '' };

function dayLabel(iso: string): string {
  const d = new Date(iso);
  if (isToday(d)) return 'Today';
  if (isYesterday(d)) return 'Yesterday';
  return format(d, 'EEEE d MMMM yyyy');
}

function ResultChip({ result }: { result: ActivityDto['result'] }) {
  if (!result) return null;
  const m = {
    success: { icon: <CheckCircle2 size={13} />, label: 'Success', color: tokens.color.success, bg: '#E3F0E7' },
    failure: { icon: <XCircle size={13} />, label: 'Failed', color: tokens.color.error, bg: '#F8E4E2' },
    pending: { icon: <Clock size={13} />, label: 'Pending', color: tokens.color.textSecondary, bg: tokens.color.disabled },
  }[result];
  return <Chip size="small" icon={m.icon} label={m.label} sx={{ height: 22, bgcolor: m.bg, color: m.color, '& .MuiChip-icon': { color: 'inherit' } }} />;
}

function ActivityEntry({ a }: { a: ActivityDto }) {
  const Icon = TYPE_ICON[a.type] ?? ActivityIcon;
  const critical = a.severity === 'critical' || a.severity === 'warning';
  return (
    <Stack direction="row" spacing={1.5} sx={{ py: 1.5, px: { xs: 1.5, sm: 2 }, borderBottom: `1px solid ${tokens.color.border}` }}>
      <Box
        aria-hidden
        sx={{
          width: 36, height: 36, borderRadius: '50%', flexShrink: 0, display: 'grid', placeItems: 'center',
          bgcolor: a.severity === 'critical' ? '#F8E4E2' : a.severity === 'warning' ? '#F8EEDC' : 'sage.main',
          color: a.severity === 'critical' ? 'error.main' : a.severity === 'warning' ? 'warning.dark' : 'primary.dark',
        }}
      >
        {a.severity === 'critical' ? <AlertTriangle size={17} /> : <Icon size={17} />}
      </Box>
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
          <SeverityDot severity={a.severity} />
          <Box component="span" sx={{ position: 'absolute', left: -9999 }}>
            Severity: {SEVERITY_LABEL[a.severity]}.
          </Box>
          <Typography fontWeight={critical ? 700 : 600} sx={{ wordBreak: 'break-word' }}>
            {a.title}
          </Typography>
          <ResultChip result={a.result} />
          {a.isDemo && <DemoBadge compact />}
        </Stack>
        {a.detail && (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25, wordBreak: 'break-word' }}>
            {a.detail}
          </Typography>
        )}
        <Typography variant="caption" component="p" sx={{ mt: 0.5 }}>
          {ACTIVITY_LABELS[a.type]} · {SOURCE_LABEL[a.source]}
          {a.actorName ? ` · by ${a.actorName}` : ''}
          {a.deviceId && a.deviceName && (
            <>
              {' · '}
              <Link component={RouterLink} to={`/devices/${a.deviceId}`} underline="hover">
                {a.deviceName}
              </Link>
            </>
          )}
        </Typography>
      </Box>
      <Typography variant="caption" component="time" dateTime={a.createdAt} sx={{ flexShrink: 0, pt: 0.5 }} title={format(new Date(a.createdAt), 'd MMM yyyy, HH:mm:ss')}>
        {formatTime(a.createdAt)}
      </Typography>
    </Stack>
  );
}

function toQueryArgs(homeId: string, f: Filters, q: string): ActivityArgs | null {
  const now = Date.now();
  let from: string | undefined;
  let to: string | undefined;
  if (f.time === '24h') from = new Date(now - 86400_000).toISOString();
  if (f.time === '7d') from = new Date(now - 7 * 86400_000).toISOString();
  if (f.time === '30d') from = new Date(now - 30 * 86400_000).toISOString();
  if (f.time === 'custom') {
    if (f.from) from = new Date(f.from).toISOString();
    if (f.to) to = new Date(f.to).toISOString();
    if (from && to && to <= from) return null;
  }
  return {
    homeId, limit: 30, q: q || undefined, deviceId: f.deviceId || undefined, roomId: f.roomId || undefined, category: f.category || undefined, severity: f.severity || undefined,
    type: f.type || undefined, source: f.source || undefined, from, to,
  };
}

export default function ActivityPage() {
  const { homeId, can } = useHome();
  const allowed = can('activity.view');
  const [params] = useSearchParams();
  const [filters, setFilters] = useState<Filters>(() => ({ ...EMPTY, q: params.get('q') ?? '' }));
  const [debouncedQ, setDebouncedQ] = useState(filters.q);
  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedQ(filters.q.trim()), 300);
    return () => window.clearTimeout(t);
  }, [filters.q]);

  // Time-based filters are computed once per filter change so the query key stays stable.
  const args = useMemo(() => toQueryArgs(homeId, filters, debouncedQ), [homeId, debouncedQ, filters.deviceId, filters.roomId, filters.category, filters.severity, filters.type, filters.source, filters.time, filters.from, filters.to]); // eslint-disable-line react-hooks/exhaustive-deps
  const first = useActivityQuery(args ?? { homeId }, { skip: !allowed || !args });
  const [loadMore, more] = api.endpoints.activity.useLazyQuery();
  const [extra, setExtra] = useState<ActivityDto[]>([]);
  const [extraCursor, setExtraCursor] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    setExtra([]);
    setExtraCursor(undefined);
  }, [args]);

  const devices = useDevicesQuery({ homeId, pageSize: 100, sort: 'name' }, { skip: !allowed });
  const rooms = useRoomsQuery(homeId, { skip: !allowed });

  const items = useMemo(() => {
    const seen = new Set<string>();
    return [...(first.data?.items ?? []), ...extra].filter((a) => (seen.has(a.id) ? false : (seen.add(a.id), true)));
  }, [first.data, extra]);
  const nextCursor = extraCursor === undefined ? first.data?.nextCursor : extraCursor;
  const groups = useMemo(() => {
    const m = new Map<string, ActivityDto[]>();
    for (const a of items) {
      const k = dayLabel(a.createdAt);
      m.set(k, [...(m.get(k) ?? []), a]);
    }
    return [...m.entries()];
  }, [items]);

  if (!allowed) {
    return (
      <>
        <PageHeader title="Activity" />
        <PermissionDenied />
      </>
    );
  }

  const set = <K extends keyof Filters>(k: K, v: Filters[K]) => setFilters((f) => ({ ...f, [k]: v }));
  const filtered = JSON.stringify({ ...filters, q: filters.q.trim() }) !== JSON.stringify(EMPTY);
  const select = (key: keyof Filters, label: string, options: { value: string; label: string }[], minWidth = 150) => (
    <TextField select size="small" label={label} value={filters[key]} onChange={(e) => set(key, e.target.value as never)} sx={{ minWidth, flex: { xs: '1 1 45%', md: '0 0 auto' } }}>
      <MenuItem value="">Any</MenuItem>
      {options.map((o) => (
        <MenuItem key={o.value} value={o.value}>
          {o.label}
        </MenuItem>
      ))}
    </TextField>
  );

  return (
    <>
      <PageHeader title="Activity" subtitle="Everything that happened in your home — commands, automations, scenes, connectivity and security events" />
      <Card sx={{ p: 2, mb: 2.5 }}>
        <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap>
          <TextField
            size="small"
            placeholder="Search activity"
            value={filters.q}
            onChange={(e) => set('q', e.target.value)}
            inputProps={{ 'aria-label': 'Search activity' }}
            InputProps={{ startAdornment: (<InputAdornment position="start"><Search size={16} /></InputAdornment>) }}
            sx={{ flex: { xs: '1 1 100%', md: '1 1 220px' }, maxWidth: { md: 300 } }}
          />
          {select('time', 'Time', [
            { value: '24h', label: 'Last 24 hours' },
            { value: '7d', label: 'Last 7 days' },
            { value: '30d', label: 'Last 30 days' },
            { value: 'custom', label: 'Custom range' },
          ], 160)}
          {select('severity', 'Severity', (['info', 'success', 'warning', 'critical'] as const).map((s) => ({ value: s, label: SEVERITY_LABEL[s] })))}
          {select('type', 'Event type', ACTIVITY_TYPES.map((t) => ({ value: t, label: ACTIVITY_LABELS[t] })), 180)}
          {select('source', 'Source', (Object.keys(SOURCE_LABEL) as (keyof typeof SOURCE_LABEL)[]).map((s) => ({ value: s, label: SOURCE_LABEL[s] })))}
          {select('deviceId', 'Device', (devices.data?.items ?? []).map((d) => ({ value: d.id, label: d.name })), 180)}
          {select('roomId', 'Room', (rooms.data?.rooms ?? []).map((r) => ({ value: r.id, label: r.name })))}
          {select('category', 'Category', DEVICE_CATEGORIES.filter((c) => c !== 'other').map((c) => ({ value: c, label: CATEGORY_INFO[c].label })), 170)}
          {filters.time === 'custom' && (
            <>
              <TextField size="small" type="datetime-local" label="From" value={filters.from} onChange={(e) => set('from', e.target.value)} InputLabelProps={{ shrink: true }} />
              <TextField
                size="small"
                type="datetime-local"
                label="To"
                value={filters.to}
                onChange={(e) => set('to', e.target.value)}
                InputLabelProps={{ shrink: true }}
                error={!args}
                helperText={!args ? '"To" must be after "From"' : undefined}
              />
            </>
          )}
          {filtered && (
            <Button onClick={() => setFilters(EMPTY)} sx={{ alignSelf: 'center' }}>
              Clear filters
            </Button>
          )}
        </Stack>
      </Card>

      {first.isLoading ? (
        <Card sx={{ p: 2 }}>
          <ListSkeleton rows={8} />
        </Card>
      ) : first.error ? (
        <ErrorState error={first.error} onRetry={first.refetch} title="Could not load activity" />
      ) : !items.length ? (
        filtered ? (
          <EmptyState icon={<Search size={24} />} title="No matching activity" description="Nothing matches these filters." action={<Button onClick={() => setFilters(EMPTY)}>Clear filters</Button>} />
        ) : (
          <EmptyState icon={<ActivityIcon size={24} />} title="No activity yet" description="Commands, automation runs, connectivity changes and security events will appear here as they happen." />
        )
      ) : (
        <Stack spacing={2.5}>
          {groups.map(([day, list]) => (
            <Box component="section" key={day} aria-label={day}>
              <Typography variant="overline" component="h2" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
                {day}
              </Typography>
              <Card>
                <Box component="ul" sx={{ m: 0, p: 0 }}>
                  <AnimatePresence initial={false}>
                    {list.map((a) => (
                      <motion.li key={a.id} initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} transition={{ duration: tokens.motion.base }} style={{ listStyle: 'none', overflow: 'hidden' }}>
                        <ActivityEntry a={a} />
                      </motion.li>
                    ))}
                  </AnimatePresence>
                </Box>
              </Card>
            </Box>
          ))}
          {nextCursor && args && (
            <Box sx={{ textAlign: 'center' }}>
              <Button
                variant="outlined"
                disabled={more.isFetching}
                onClick={async () => {
                  const r = await loadMore({ ...args, cursor: nextCursor }).unwrap().catch(() => null);
                  if (r) {
                    setExtra((x) => [...x, ...r.items]);
                    setExtraCursor(r.nextCursor);
                  }
                }}
              >
                {more.isFetching ? 'Loading…' : 'Load more'}
              </Button>
              {more.error && (
                <Typography variant="caption" color="error" component="p" sx={{ mt: 1 }}>
                  Could not load more activity. Try again.
                </Typography>
              )}
            </Box>
          )}
        </Stack>
      )}
    </>
  );
}

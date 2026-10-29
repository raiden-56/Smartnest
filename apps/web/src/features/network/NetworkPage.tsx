import { useMemo, useState } from 'react';
import {
  Alert, Box, Button, Card, Chip, InputAdornment, Link, MenuItem, Stack, Table, TableBody, TableCell, TableHead, TableRow, TableSortLabel, TextField, Typography,
  useMediaQuery, useTheme,
} from '@mui/material';
import { motion } from 'framer-motion';
import { AlertTriangle, Cable, CheckCircle2, CircleHelp, Home, Router, Search, Signal, SignalLow, SignalMedium, Wifi, WifiOff, XCircle } from 'lucide-react';
import { Link as RouterLink } from 'react-router-dom';
import type { NetworkDto } from '@smartnest/shared';
import { useNetworkQuery } from '../../api/api';
import { timeAgo, useHome } from '../../app/hooks';
import { EmptyState, ErrorState, ListSkeleton, PageHeader, PermissionDenied, SectionCard, SummaryCardsSkeleton } from '../../components/common/States';
import { DemoBadge } from '../../components/common/StatusBadge';
import { tokens } from '../../theme/theme';

type Client = NetworkDto['clients'][number];
type SortKey = 'name' | 'ip' | 'connection' | 'signal' | 'lastSeen' | 'online';

const HEALTH = {
  good: { icon: CheckCircle2, label: 'Healthy', color: tokens.color.success },
  degraded: { icon: AlertTriangle, label: 'Degraded', color: tokens.color.warning },
  down: { icon: XCircle, label: 'Down', color: tokens.color.error },
  unknown: { icon: CircleHelp, label: 'Not reported', color: tokens.color.textSecondary },
} as const;

export function formatUptime(s: number | null): string {
  if (s === null) return 'Not reported';
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`;
}

function signalQuality(dbm: number): { label: string; Icon: typeof Signal } {
  if (dbm >= -55) return { label: 'Excellent', Icon: Signal };
  if (dbm >= -67) return { label: 'Good', Icon: SignalMedium };
  if (dbm >= -75) return { label: 'Fair', Icon: SignalLow };
  return { label: 'Weak', Icon: SignalLow };
}

function SignalCell({ dbm }: { dbm: number | null }) {
  if (dbm === null) return <Typography variant="body2" color="text.secondary">—</Typography>;
  const q = signalQuality(dbm);
  return (
    <Stack direction="row" spacing={0.75} alignItems="center">
      <q.Icon size={16} aria-hidden />
      <Typography variant="body2">
        {dbm} dBm <Box component="span" sx={{ color: 'text.secondary' }}>({q.label})</Box>
      </Typography>
    </Stack>
  );
}

function OnlineStatus({ online }: { online: boolean }) {
  return (
    <Stack direction="row" spacing={0.5} alignItems="center" sx={{ color: online ? 'success.main' : 'text.secondary' }}>
      {online ? <Wifi size={15} aria-hidden /> : <WifiOff size={15} aria-hidden />}
      <Typography variant="body2" sx={{ color: 'inherit', fontWeight: 600 }}>
        {online ? 'Online' : 'Offline'}
      </Typography>
    </Stack>
  );
}

function TypeChip({ client }: { client: Client }) {
  return client.smartHomeDeviceId ? (
    <Chip size="small" icon={<Home size={13} />} label="Smart-home device" component={RouterLink} to={`/devices/${client.smartHomeDeviceId}`} clickable sx={{ bgcolor: 'sage.main', color: 'primary.dark', '& .MuiChip-icon': { color: 'inherit' } }} />
  ) : (
    <Chip size="small" label="Network client" variant="outlined" />
  );
}

function MacCell({ mac }: { mac: string | null }) {
  const [shown, setShown] = useState(false);
  if (!mac) return <Typography variant="body2" color="text.secondary">Not reported</Typography>;
  return shown ? (
    <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
      {mac}
    </Typography>
  ) : (
    <Button size="small" onClick={() => setShown(true)} sx={{ minHeight: 24, px: 1 }} aria-label="Reveal MAC address">
      Hidden · show
    </Button>
  );
}

const connLabel = (c: Client['connection']) => (c === 'wifi' ? 'Wi-Fi' : c === 'ethernet' ? 'Ethernet' : 'Unknown');

export default function NetworkPage() {
  const { homeId, can } = useHome();
  const allowed = can('network.view');
  const q = useNetworkQuery(homeId, { skip: !allowed, pollingInterval: 30_000 });
  const theme = useTheme();
  const mobile = useMediaQuery(theme.breakpoints.down('md'));
  const [search, setSearch] = useState('');
  const [kind, setKind] = useState<'all' | 'smart' | 'other'>('all');
  const [status, setStatus] = useState<'all' | 'online' | 'offline'>('all');
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'online', dir: 'desc' });

  const clients = useMemo(() => {
    const list = (q.data?.clients ?? []).filter((c) => {
      if (kind === 'smart' && !c.smartHomeDeviceId) return false;
      if (kind === 'other' && c.smartHomeDeviceId) return false;
      if (status !== 'all' && c.online !== (status === 'online')) return false;
      const s = search.trim().toLowerCase();
      return !s || c.name.toLowerCase().includes(s) || (c.ip ?? '').includes(s);
    });
    const val = (c: Client): string | number => {
      switch (sort.key) {
        case 'name':
          return c.name.toLowerCase();
        case 'ip':
          return (c.ip ?? '').split('.').map((p) => p.padStart(3, '0')).join('.');
        case 'connection':
          return c.connection;
        case 'signal':
          return c.signalDbm ?? -999;
        case 'lastSeen':
          return c.lastSeenAt ?? '';
        case 'online':
          return c.online ? 1 : 0;
      }
    };
    return [...list].sort((a, b) => {
      const r = val(a) < val(b) ? -1 : val(a) > val(b) ? 1 : a.name.localeCompare(b.name);
      return sort.dir === 'asc' ? r : -r;
    });
  }, [q.data, kind, status, search, sort]);

  if (!allowed) {
    return (
      <>
        <PageHeader title="Network" />
        <PermissionDenied />
      </>
    );
  }

  const n = q.data;
  const header = (key: SortKey, label: string) => (
    <TableCell sortDirection={sort.key === key ? sort.dir : false}>
      <TableSortLabel active={sort.key === key} direction={sort.key === key ? sort.dir : 'asc'} onClick={() => setSort((s) => ({ key, dir: s.key === key && s.dir === 'asc' ? 'desc' : 'asc' }))}>
        {label}
      </TableSortLabel>
    </TableCell>
  );

  return (
    <>
      <PageHeader title="Network" subtitle="Routers, access points and connected clients reported by your integrations" />
      {q.isLoading ? (
        <Stack spacing={2.5}>
          <SummaryCardsSkeleton count={3} />
          <ListSkeleton rows={8} />
        </Stack>
      ) : q.error ? (
        <ErrorState error={q.error} onRetry={q.refetch} title="Could not load network status" />
      ) : !n?.available ? (
        <EmptyState
          icon={<Router size={24} />}
          title="No network data"
          description="Network information requires a compatible router integration — for example Home Assistant device trackers from a supported router. SmartNest never scans your network to discover devices."
          action={
            can('integrations.manage') && (
              <Button component={RouterLink} to="/integrations/add" variant="contained">
                Add an integration
              </Button>
            )
          }
        />
      ) : (
        <Stack spacing={2.5}>
          <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', lg: 'repeat(4, 1fr)' } }}>
            {(() => {
              const h = HEALTH[n.health];
              return (
                <Card sx={{ p: 2 }}>
                  <Typography variant="body2" color="text.secondary" fontWeight={600}>
                    Network health
                  </Typography>
                  <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 1, color: h.color }}>
                    <h.icon size={22} aria-hidden />
                    <Typography sx={{ fontSize: '1.35rem', fontWeight: 700, color: 'inherit' }}>{h.label}</Typography>
                  </Stack>
                </Card>
              );
            })()}
            <Card sx={{ p: 2 }}>
              <Typography variant="body2" color="text.secondary" fontWeight={600}>
                Connected clients
              </Typography>
              <Typography sx={{ fontSize: '1.35rem', fontWeight: 700, mt: 1 }}>
                {n.clients.filter((c) => c.online).length} <Box component="span" sx={{ fontSize: '0.9rem', color: 'text.secondary', fontWeight: 500 }}>of {n.clients.length} known</Box>
              </Typography>
            </Card>
            <Card sx={{ p: 2 }}>
              <Typography variant="body2" color="text.secondary" fontWeight={600}>
                Bandwidth
              </Typography>
              {n.bandwidth ? (
                <>
                  <Typography sx={{ fontSize: '1.35rem', fontWeight: 700, mt: 1 }}>
                    ↓ {n.bandwidth.downMbps} · ↑ {n.bandwidth.upMbps} <Box component="span" sx={{ fontSize: '0.9rem', fontWeight: 500 }}>Mbps</Box>
                  </Typography>
                  <Typography variant="caption">Measured {timeAgo(n.bandwidth.measuredAt)}</Typography>
                </>
              ) : (
                <Typography variant="body2" color="text.secondary" sx={{ mt: 1, fontStyle: 'italic' }}>
                  Not reported by your integration
                </Typography>
              )}
            </Card>
            <Card sx={{ p: 2 }}>
              <Typography variant="body2" color="text.secondary" fontWeight={600}>
                Guest network
              </Typography>
              <Typography variant="body2" sx={{ mt: 1 }}>
                {!n.guestNetwork
                  ? 'Not reported by your integration'
                  : !n.guestNetwork.supported
                    ? `Status: ${n.guestNetwork.enabled ? 'enabled' : 'disabled'} · cannot be changed from SmartNest`
                    : n.guestNetwork.enabled
                      ? 'Enabled'
                      : 'Disabled'}
              </Typography>
            </Card>
          </Box>

          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
            <Typography variant="body2" color="text.secondary">
              Data from:
            </Typography>
            {n.sources.map((s) => (
              <Stack key={s.integrationId} direction="row" spacing={0.75} alignItems="center">
                <Link component={RouterLink} to={`/integrations/${s.integrationId}`} variant="body2">
                  {s.integrationName}
                </Link>
                {s.isDemo && <DemoBadge compact />}
              </Stack>
            ))}
          </Stack>

          {n.routers.length > 0 && (
            <SectionCard title="Routers & access points">
              <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 240px), 1fr))' }}>
                {n.routers.map((r, i) => (
                  <motion.div key={r.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: tokens.motion.base, delay: i * 0.04 }}>
                    <Box sx={{ p: 2, border: `1px solid ${tokens.color.border}`, borderRadius: `${tokens.radius.md}px` }}>
                      <Stack direction="row" spacing={1.25} alignItems="center">
                        <Box sx={{ width: 38, height: 38, borderRadius: 2, bgcolor: r.status === 'online' ? 'sage.main' : tokens.color.disabled, color: 'primary.dark', display: 'grid', placeItems: 'center' }} aria-hidden>
                          <Router size={18} />
                        </Box>
                        <Box sx={{ minWidth: 0 }}>
                          <Typography fontWeight={700} noWrap>
                            {r.name}
                          </Typography>
                          <Typography variant="caption">{r.kind === 'router' ? 'Router' : r.kind === 'access_point' ? 'Access point' : 'Switch'}</Typography>
                        </Box>
                      </Stack>
                      <Stack spacing={0.5} sx={{ mt: 1.5 }}>
                        <Stack direction="row" justifyContent="space-between">
                          <Typography variant="body2" color="text.secondary">Status</Typography>
                          {r.status === 'unknown' ? <Typography variant="body2">Not reported</Typography> : <OnlineStatus online={r.status === 'online'} />}
                        </Stack>
                        <Stack direction="row" justifyContent="space-between">
                          <Typography variant="body2" color="text.secondary">Clients</Typography>
                          <Typography variant="body2">{r.clients ?? 'Not reported'}</Typography>
                        </Stack>
                        <Stack direction="row" justifyContent="space-between">
                          <Typography variant="body2" color="text.secondary">Uptime</Typography>
                          <Typography variant="body2">{formatUptime(r.uptimeSeconds)}</Typography>
                        </Stack>
                        <Stack direction="row" justifyContent="space-between">
                          <Typography variant="body2" color="text.secondary">Firmware</Typography>
                          <Typography variant="body2">{r.firmware ?? 'Not reported'}</Typography>
                        </Stack>
                      </Stack>
                    </Box>
                  </motion.div>
                ))}
              </Box>
            </SectionCard>
          )}

          <SectionCard title={`Clients (${clients.length})`}>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ mb: 2 }}>
              <TextField
                size="small"
                placeholder="Search name or IP"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                inputProps={{ 'aria-label': 'Search clients' }}
                InputProps={{ startAdornment: (<InputAdornment position="start"><Search size={16} /></InputAdornment>) }}
                sx={{ maxWidth: { sm: 280 } }}
              />
              <TextField select size="small" label="Type" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} sx={{ minWidth: 180, maxWidth: { sm: 220 } }}>
                <MenuItem value="all">All clients</MenuItem>
                <MenuItem value="smart">Smart-home devices</MenuItem>
                <MenuItem value="other">Other network clients</MenuItem>
              </TextField>
              <TextField select size="small" label="Status" value={status} onChange={(e) => setStatus(e.target.value as typeof status)} sx={{ minWidth: 140, maxWidth: { sm: 180 } }}>
                <MenuItem value="all">Any</MenuItem>
                <MenuItem value="online">Online</MenuItem>
                <MenuItem value="offline">Offline</MenuItem>
              </TextField>
            </Stack>
            {!clients.length ? (
              <Typography color="text.secondary" variant="body2">
                No clients match these filters.
              </Typography>
            ) : mobile ? (
              <Stack spacing={1.25}>
                {clients.map((c) => (
                  <Box key={c.id} sx={{ p: 1.5, border: `1px solid ${tokens.color.border}`, borderRadius: `${tokens.radius.md}px` }}>
                    <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1}>
                      <Typography fontWeight={700} noWrap>
                        {c.name}
                      </Typography>
                      <OnlineStatus online={c.online} />
                    </Stack>
                    <Box sx={{ mt: 1 }}>
                      <TypeChip client={c} />
                    </Box>
                    <Box sx={{ display: 'grid', gridTemplateColumns: 'auto 1fr', columnGap: 2, rowGap: 0.5, mt: 1 }}>
                      <Typography variant="caption">IP</Typography>
                      <Typography variant="body2">{c.ip ?? 'Not reported'}</Typography>
                      <Typography variant="caption">Connection</Typography>
                      <Typography variant="body2">{connLabel(c.connection)}</Typography>
                      <Typography variant="caption">Signal</Typography>
                      <SignalCell dbm={c.signalDbm} />
                      <Typography variant="caption">Last seen</Typography>
                      <Typography variant="body2">{timeAgo(c.lastSeenAt)}</Typography>
                      {c.mac && (
                        <>
                          <Typography variant="caption">MAC</Typography>
                          <MacCell mac={c.mac} />
                        </>
                      )}
                    </Box>
                  </Box>
                ))}
              </Stack>
            ) : (
              <Box sx={{ overflowX: 'auto' }}>
                <Table size="small" aria-label="Network clients">
                  <TableHead>
                    <TableRow>
                      {header('name', 'Name')}
                      <TableCell>Type</TableCell>
                      {header('ip', 'IP address')}
                      <TableCell>MAC</TableCell>
                      {header('connection', 'Connection')}
                      {header('signal', 'Signal')}
                      {header('lastSeen', 'Last seen')}
                      {header('online', 'Status')}
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {clients.map((c) => (
                      <TableRow key={c.id} hover>
                        <TableCell sx={{ fontWeight: 600 }}>{c.name}</TableCell>
                        <TableCell>
                          <TypeChip client={c} />
                        </TableCell>
                        <TableCell>{c.ip ?? <Typography variant="body2" color="text.secondary">Not reported</Typography>}</TableCell>
                        <TableCell>
                          <MacCell mac={c.mac} />
                        </TableCell>
                        <TableCell>
                          <Stack direction="row" spacing={0.75} alignItems="center">
                            {c.connection === 'ethernet' ? <Cable size={15} aria-hidden /> : c.connection === 'wifi' ? <Wifi size={15} aria-hidden /> : <CircleHelp size={15} aria-hidden />}
                            <span>{connLabel(c.connection)}</span>
                          </Stack>
                        </TableCell>
                        <TableCell>
                          <SignalCell dbm={c.signalDbm} />
                        </TableCell>
                        <TableCell>{timeAgo(c.lastSeenAt)}</TableCell>
                        <TableCell>
                          <OnlineStatus online={c.online} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Box>
            )}
          </SectionCard>

          <Alert severity="info">
            SmartNest only shows what your integration reports and does not identify every client on your network. Router administration (restarting, blocking clients,
            changing Wi-Fi) is not offered: only documented integration actions are exposed, and none are implemented for the connected integrations.
          </Alert>
        </Stack>
      )}
    </>
  );
}

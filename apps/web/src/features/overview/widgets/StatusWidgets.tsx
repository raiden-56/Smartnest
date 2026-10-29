import { Box, Button, Chip, Stack, Tooltip, Typography } from '@mui/material';
import { Activity, AlertTriangle, Bot, CheckCircle2, CircleHelp, Cpu, Network, ShieldAlert, Wifi, WifiOff, XCircle, Zap } from 'lucide-react';
import { Area, AreaChart, ResponsiveContainer, Tooltip as ChartTooltip, XAxis } from 'recharts';
import { Link as RouterLink } from 'react-router-dom';
import { formatEnergy, formatPower } from '@smartnest/shared';
import { useActivityQuery, useAutomationsQuery, useDeviceCountsQuery, useEnergyQuery, useNetworkQuery, useRoomsQuery } from '../../../api/api';
import { formatTime, timeAgo, useFormatTemperature, useHome } from '../../../app/hooks';
import { AppIcon } from '../../../components/common/AppIcon';
import { DemoBadge, DemoMark, SeverityDot } from '../../../components/common/StatusBadge';
import { ChartSkeleton, ErrorState, ListSkeleton, NotAvailable } from '../../../components/common/States';
import { tokens } from '../../../theme/theme';
import { MoreLink, WidgetCard, WidgetEmpty, WidgetRow, type WidgetProps } from './WidgetFrame';
import { computeSecurityAlerts, useSecurityDevices } from './useOverviewData';

// ─── Summary ──────────────────────────────────────────────────────────────

function Stat({ icon, label, value, tone = 'default', to, hint }: { icon: React.ReactNode; label: string; value: React.ReactNode; tone?: 'default' | 'good' | 'warn' | 'bad'; to?: string; hint?: string }) {
  const colors = { default: ['sage.main', 'primary.dark'], good: ['#E3F0E7', 'success.main'], warn: ['#F8EEDC', 'warning.dark'], bad: ['#F8E4E2', 'error.main'] }[tone];
  const content = (
    <Stack
      direction="row"
      spacing={1.25}
      alignItems="center"
      sx={{
        px: 1.5, py: 1.125, height: '100%', bgcolor: 'background.paper', border: `1px solid ${tokens.color.border}`, borderRadius: `${tokens.radius.md}px`,
        transition: 'border-color 150ms, box-shadow 150ms', ...(to ? { '&:hover': { borderColor: 'primary.light', boxShadow: tokens.shadow.card } } : {}),
      }}
    >
      <Box sx={{ width: 32, height: 32, borderRadius: '10px', bgcolor: colors[0], color: colors[1], display: 'grid', placeItems: 'center', flexShrink: 0 }} aria-hidden>
        {icon}
      </Box>
      <Box sx={{ minWidth: 0 }}>
        <Typography sx={{ fontWeight: 750, fontSize: '1.2rem', lineHeight: 1.15 }} noWrap>
          {value}
        </Typography>
        <Typography variant="caption" component="div" noWrap>
          {label}
        </Typography>
      </Box>
    </Stack>
  );
  const body = to ? (
    <Box component={RouterLink} to={to} sx={{ textDecoration: 'none', color: 'inherit', display: 'block', height: '100%', borderRadius: `${tokens.radius.md}px` }}>
      {content}
    </Box>
  ) : (
    content
  );
  return hint ? (
    <Tooltip title={<span style={{ whiteSpace: 'pre-line' }}>{hint}</span>}>
      <Box sx={{ minWidth: 0 }}>{body}</Box>
    </Tooltip>
  ) : (
    <Box sx={{ minWidth: 0 }}>{body}</Box>
  );
}

/** Compact KPI strip — rendered without a surrounding card. */
export function SummaryWidget(_: WidgetProps) {
  const { homeId, can } = useHome();
  const counts = useDeviceCountsQuery(homeId, { skip: !can('devices.view'), pollingInterval: 60_000 });
  const energy = useEnergyQuery({ homeId, range: 'live' }, { skip: !can('energy.view'), pollingInterval: 60_000 });
  const security = useSecurityDevices();
  const alerts = computeSecurityAlerts(security.devices);
  const c = counts.data;
  const dash = (v: number | undefined) => (v === undefined ? '—' : v);
  return (
    <Box component="section" aria-labelledby="summary-title" data-tour="summary">
      <Typography id="summary-title" component="h2" sx={{ position: 'absolute', width: '1px', height: '1px', overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>
        Home summary
      </Typography>
      {counts.error ? (
        <ErrorState error={counts.error} onRetry={counts.refetch} title="Could not load device counts" />
      ) : (
        <Box sx={{ display: 'grid', gap: 1.25, gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }} aria-busy={counts.isLoading}>
          <Stat icon={<Cpu size={17} />} label="Total devices" value={dash(c?.total)} to="/devices" />
          <Stat icon={<Wifi size={17} />} label="Online" value={dash(c?.online)} tone="good" to="/devices?connectivity=online" />
          <Stat icon={<WifiOff size={17} />} label="Offline" value={dash(c?.offline)} tone={c?.offline ? 'bad' : 'default'} to="/devices?connectivity=offline" />
          <Stat
            icon={<CircleHelp size={17} />}
            label="Unavailable / unknown"
            hint="Unavailable: the integration reports the device unavailable. Unknown: SmartNest cannot currently determine connectivity."
            value={c ? `${c.unavailable} / ${c.unknown}` : '—'}
            tone={c && c.unavailable + c.unknown > 0 ? 'warn' : 'default'}
            to="/devices?connectivity=unavailable"
          />
          <Stat
            icon={<ShieldAlert size={17} />}
            label="Security alerts"
            value={security.isLoading ? '—' : alerts.length}
            tone={alerts.length ? 'bad' : 'good'}
            hint={alerts.map((a) => `${a.device.name}: ${a.reason}`).join('\n') || 'No active alerts reported'}
          />
          <Stat
            icon={<Zap size={17} />}
            label={energy.data?.sources.some((s) => s.isDemo) ? 'Power now (demo)' : 'Power now'}
            value={!can('energy.view') ? <NotAvailable /> : energy.isLoading ? '—' : energy.data?.currentPowerW != null ? formatPower(energy.data.currentPowerW) : <NotAvailable />}
            to={can('energy.view') ? '/energy' : undefined}
          />
        </Box>
      )}
    </Box>
  );
}

// ─── Rooms ────────────────────────────────────────────────────────────────

const ROOMS_SHOWN = 5;

export function RoomsWidget(_: WidgetProps) {
  const { homeId } = useHome();
  const fmt = useFormatTemperature();
  const q = useRoomsQuery(homeId);
  return (
    <WidgetCard
      title="Rooms"
      action={
        <Button component={RouterLink} to="/rooms" size="small">
          Manage
        </Button>
      }
    >
      {q.isLoading ? (
        <ListSkeleton rows={4} height={48} />
      ) : q.error ? (
        <ErrorState error={q.error} onRetry={q.refetch} />
      ) : !q.data?.rooms.length ? (
        <WidgetEmpty
          icon={<AppIcon name="sofa" size={20} />}
          title="No rooms yet"
          action={
            <Button component={RouterLink} to="/rooms?new=1" size="small" variant="outlined">
              Add a room
            </Button>
          }
        />
      ) : (
        <Box>
          {q.data.rooms.slice(0, ROOMS_SHOWN).map((r) => (
            <Box key={r.id} component={RouterLink} to={`/rooms/${r.id}`} sx={{ display: 'block', textDecoration: 'none', color: 'inherit', borderRadius: 2, '&:hover': { bgcolor: 'action.hover' } }}>
              <WidgetRow
                leading={
                  <Box sx={{ width: 34, height: 34, borderRadius: '10px', bgcolor: r.activeCount ? 'accent.main' : 'sage.main', color: r.activeCount ? '#fff' : 'primary.dark', display: 'grid', placeItems: 'center' }} aria-hidden>
                    <AppIcon name={r.icon} size={17} />
                  </Box>
                }
                primary={r.name}
                secondary={`${r.deviceCount} device${r.deviceCount === 1 ? '' : 's'} · ${r.onlineCount} online${r.activeCount ? ` · ${r.activeCount} on` : ''}`}
                trailing={
                  r.environment.temperature !== undefined ? (
                    <Typography variant="body2" fontWeight={700}>
                      {fmt(r.environment.temperature)}
                      {r.environment.humidity !== undefined && (
                        <Typography component="span" variant="caption">
                          {' '}
                          · {Math.round(r.environment.humidity)}%
                        </Typography>
                      )}
                    </Typography>
                  ) : undefined
                }
              />
            </Box>
          ))}
          <MoreLink to="/rooms" hidden={q.data.rooms.length - ROOMS_SHOWN} noun="rooms" />
        </Box>
      )}
    </WidgetCard>
  );
}

// ─── Activity ─────────────────────────────────────────────────────────────

export function ActivityWidget(_: WidgetProps) {
  const { homeId, can } = useHome();
  const allowed = can('activity.view');
  const q = useActivityQuery({ homeId, limit: 5 }, { skip: !allowed });
  return (
    <WidgetCard
      title="Recent activity"
      action={
        allowed && (
          <Button component={RouterLink} to="/activity" size="small">
            View all
          </Button>
        )
      }
    >
      {!allowed ? (
        <WidgetEmpty icon={<Activity size={20} />} title="Activity is not available for your role" />
      ) : q.isLoading ? (
        <ListSkeleton rows={5} height={40} />
      ) : q.error ? (
        <ErrorState error={q.error} onRetry={q.refetch} />
      ) : !q.data?.items.length ? (
        <WidgetEmpty icon={<Activity size={20} />} title="No activity yet" description="Device changes, scenes and automations will appear here." />
      ) : (
        <Box component="ol" sx={{ listStyle: 'none', m: 0, p: 0 }}>
          {q.data.items.map((a) => (
            <Box component="li" key={a.id}>
              <WidgetRow
                leading={<SeverityDot severity={a.severity} />}
                primary={a.title}
                secondary={
                  <>
                    {timeAgo(a.createdAt)}
                    {a.actorName ? ` · ${a.actorName}` : a.source !== 'user' ? ` · ${a.source}` : ''}
                    {a.result === 'failure' ? ' · failed' : ''}
                  </>
                }
                trailing={a.isDemo ? <DemoMark /> : undefined}
              />
            </Box>
          ))}
        </Box>
      )}
    </WidgetCard>
  );
}

// ─── Automations ──────────────────────────────────────────────────────────

const RUN_STATUS: Record<string, { label: string; icon: React.ReactNode; color: string }> = {
  succeeded: { label: 'Succeeded', icon: <CheckCircle2 size={13} />, color: tokens.color.success },
  partial: { label: 'Partly failed', icon: <AlertTriangle size={13} />, color: tokens.color.warning },
  failed: { label: 'Failed', icon: <XCircle size={13} />, color: tokens.color.error },
  skipped: { label: 'Skipped', icon: <CircleHelp size={13} />, color: tokens.color.textSecondary },
  running: { label: 'Running', icon: <Activity size={13} />, color: tokens.color.textSecondary },
  simulated: { label: 'Tested', icon: <CheckCircle2 size={13} />, color: tokens.color.textSecondary },
};

export function AutomationsWidget(_: WidgetProps) {
  const { homeId, can } = useHome();
  const allowed = can('automations.view');
  const q = useAutomationsQuery(homeId, { skip: !allowed });
  const enabled = q.data?.automations.filter((a) => a.enabled && !a.isDraft) ?? [];
  return (
    <WidgetCard
      title="Active automations"
      action={
        allowed && (
          <Button component={RouterLink} to="/automations" size="small">
            Manage
          </Button>
        )
      }
    >
      {!allowed ? (
        <WidgetEmpty icon={<Bot size={20} />} title="Automations are not available for your role" />
      ) : q.isLoading ? (
        <ListSkeleton rows={3} height={44} />
      ) : q.error ? (
        <ErrorState error={q.error} onRetry={q.refetch} />
      ) : !enabled.length ? (
        <WidgetEmpty
          icon={<Bot size={20} />}
          title="No automations are enabled"
          action={
            can('automations.manage') ? (
              <Button component={RouterLink} to="/automations/new" size="small" variant="outlined">
                Create automation
              </Button>
            ) : undefined
          }
        />
      ) : (
        <Box>
          {enabled.slice(0, 4).map((a) => {
            const st = a.lastRunStatus ? RUN_STATUS[a.lastRunStatus] : null;
            return (
              <Box key={a.id} component={RouterLink} to={`/automations/${a.id}`} sx={{ display: 'block', textDecoration: 'none', color: 'inherit', borderRadius: 2, '&:hover': { bgcolor: 'action.hover' } }}>
                <WidgetRow
                  leading={<Bot size={18} color={tokens.color.primary} aria-hidden />}
                  primary={a.name}
                  secondary={`${a.executor === 'home_assistant' ? 'Runs in Home Assistant' : 'Runs in SmartNest'} · last run ${timeAgo(a.lastRunAt)}`}
                  trailing={
                    st ? (
                      <Stack direction="row" spacing={0.5} alignItems="center" sx={{ color: st.color }}>
                        {st.icon}
                        <Typography variant="caption" sx={{ color: 'inherit', fontWeight: 700 }}>
                          {st.label}
                        </Typography>
                      </Stack>
                    ) : undefined
                  }
                />
              </Box>
            );
          })}
          <MoreLink to="/automations" hidden={enabled.length - 4} noun="automations" />
        </Box>
      )}
    </WidgetCard>
  );
}

// ─── Energy ───────────────────────────────────────────────────────────────

export function EnergyWidget(_: WidgetProps) {
  const { homeId, can } = useHome();
  const allowed = can('energy.view');
  const q = useEnergyQuery({ homeId, range: 'today' }, { skip: !allowed, pollingInterval: 5 * 60_000 });
  const e = q.data;
  const demo = !!e?.sources.some((s) => s.isDemo);
  return (
    <WidgetCard
      title="Energy today"
      action={
        allowed && (
          <Stack direction="row" spacing={1} alignItems="center">
            {demo && <DemoBadge compact />}
            <Button component={RouterLink} to="/energy" size="small">
              Details
            </Button>
          </Stack>
        )
      }
    >
      {!allowed ? (
        <WidgetEmpty icon={<Zap size={20} />} title="Energy data is not available for your role" />
      ) : q.isLoading ? (
        <ChartSkeleton height={160} />
      ) : q.error ? (
        <ErrorState error={q.error} onRetry={q.refetch} />
      ) : !e?.available ? (
        <WidgetEmpty icon={<Zap size={20} />} title="No energy data" description="Connect a smart meter, energy-monitoring plug or solar inverter through an integration to see consumption here." />
      ) : (
        <Stack spacing={1.25}>
          <Stack direction="row" spacing={3} flexWrap="wrap" useFlexGap>
            <Box>
              <Typography variant="caption" component="div">
                Used today
              </Typography>
              <Typography fontWeight={750} fontSize="1.2rem">
                {e.totals.todayKWh !== null ? formatEnergy(e.totals.todayKWh) : <NotAvailable />}
              </Typography>
            </Box>
            <Box>
              <Typography variant="caption" component="div">
                Now
              </Typography>
              <Typography fontWeight={750} fontSize="1.2rem">
                {e.currentPowerW !== null ? formatPower(e.currentPowerW) : <NotAvailable />}
              </Typography>
            </Box>
            {e.totals.solarTodayKWh !== null && (
              <Box>
                <Typography variant="caption" component="div">
                  Solar today
                </Typography>
                <Typography fontWeight={750} fontSize="1.2rem">
                  {formatEnergy(e.totals.solarTodayKWh)}
                </Typography>
              </Box>
            )}
          </Stack>
          <Box sx={{ height: 120 }} role="img" aria-label={`Hourly energy use today. Total ${e.totals.todayKWh ?? 0} kilowatt hours.`}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={e.series} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
                <defs>
                  <linearGradient id="ov-energy" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={tokens.color.orange} stopOpacity={0.45} />
                    <stop offset="100%" stopColor={tokens.color.orange} stopOpacity={0.02} />
                  </linearGradient>
                  <linearGradient id="ov-solar" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={tokens.color.primary} stopOpacity={0.35} />
                    <stop offset="100%" stopColor={tokens.color.primary} stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="t" tickFormatter={(t: string) => formatTime(t)} tick={{ fontSize: 11, fill: tokens.color.textSecondary }} axisLine={false} tickLine={false} minTickGap={28} />
                <ChartTooltip
                  formatter={(v: number, name: string) => [`${v.toFixed(2)} kWh`, name === 'consumptionKWh' ? 'Consumption' : 'Solar']}
                  labelFormatter={(t: string) => formatTime(t)}
                  contentStyle={{ borderRadius: 12, border: `1px solid ${tokens.color.border}` }}
                />
                <Area type="monotone" dataKey="consumptionKWh" stroke={tokens.color.orange} strokeWidth={2} fill="url(#ov-energy)" isAnimationActive={false} />
                {e.totals.solarTodayKWh !== null && <Area type="monotone" dataKey="solarKWh" stroke={tokens.color.primary} strokeWidth={2} fill="url(#ov-solar)" isAnimationActive={false} />}
              </AreaChart>
            </ResponsiveContainer>
          </Box>
        </Stack>
      )}
    </WidgetCard>
  );
}

// ─── Network ──────────────────────────────────────────────────────────────

const HEALTH = {
  good: { label: 'Healthy', color: tokens.color.success, bg: '#E3F0E7', icon: <CheckCircle2 size={14} /> },
  degraded: { label: 'Degraded', color: tokens.color.warning, bg: '#F8EEDC', icon: <AlertTriangle size={14} /> },
  down: { label: 'Down', color: tokens.color.error, bg: '#F8E4E2', icon: <XCircle size={14} /> },
  unknown: { label: 'Unknown', color: tokens.color.textSecondary, bg: tokens.color.disabled, icon: <CircleHelp size={14} /> },
} as const;

export function NetworkWidget(_: WidgetProps) {
  const { homeId, can } = useHome();
  const allowed = can('network.view');
  const q = useNetworkQuery(homeId, { skip: !allowed, pollingInterval: 120_000 });
  const n = q.data;
  const h = HEALTH[n?.health ?? 'unknown'];
  return (
    <WidgetCard
      title="Network"
      action={
        allowed &&
        n?.available && (
          <Button component={RouterLink} to="/network" size="small">
            Details
          </Button>
        )
      }
    >
      {!allowed ? (
        <WidgetEmpty icon={<Network size={20} />} title="Network data is not available for your role" />
      ) : q.isLoading ? (
        <ListSkeleton rows={3} height={40} />
      ) : q.error ? (
        <ErrorState error={q.error} onRetry={q.refetch} />
      ) : !n?.available ? (
        <WidgetEmpty icon={<Network size={20} />} title="No network integration" description="Router and access-point data appears when an integration reports it." />
      ) : (
        <Stack spacing={1.25}>
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
            <Chip size="small" icon={h.icon} label={h.label} sx={{ bgcolor: h.bg, color: h.color, '& .MuiChip-icon': { color: 'inherit' } }} />
            {n.sources.some((s) => s.isDemo) && <DemoBadge compact />}
          </Stack>
          <Stack direction="row" spacing={3}>
            <Box>
              <Typography variant="caption" component="div">
                Clients online
              </Typography>
              <Typography fontWeight={750} fontSize="1.2rem">
                {n.clients.filter((c) => c.online).length}
                <Typography component="span" variant="caption">
                  {' '}
                  / {n.clients.length}
                </Typography>
              </Typography>
            </Box>
            <Box>
              <Typography variant="caption" component="div">
                Bandwidth
              </Typography>
              <Typography fontWeight={750} fontSize="1.2rem">
                {n.bandwidth ? `${n.bandwidth.downMbps}↓ ${n.bandwidth.upMbps}↑` : <NotAvailable />}
              </Typography>
            </Box>
          </Stack>
          {n.routers.slice(0, 3).map((r) => (
            <WidgetRow
              key={r.id}
              leading={r.status === 'online' ? <Wifi size={16} color={tokens.color.success} aria-hidden /> : <WifiOff size={16} color={r.status === 'offline' ? tokens.color.error : tokens.color.textSecondary} aria-hidden />}
              primary={r.name}
              secondary={`${r.status[0]!.toUpperCase()}${r.status.slice(1)}${r.clients !== null ? ` · ${r.clients} clients` : ''}`}
            />
          ))}
        </Stack>
      )}
    </WidgetCard>
  );
}

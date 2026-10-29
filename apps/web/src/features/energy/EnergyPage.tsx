import { useMemo, useState } from 'react';
import {
  Alert, Box, Button, Card, FormControlLabel, LinearProgress, Link, Stack, Switch, Table, TableBody, TableCell, TableHead, TableRow, TextField, ToggleButton,
  ToggleButtonGroup, Typography,
} from '@mui/material';
import { motion } from 'framer-motion';
import { BatteryCharging, Car, Gauge, Plug, Sun, Zap } from 'lucide-react';
import { Link as RouterLink } from 'react-router-dom';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip as ChartTooltip, XAxis, YAxis } from 'recharts';
import { format } from 'date-fns';
import { formatEnergy, formatPower, type EnergyDto } from '@smartnest/shared';
import { useEnergyQuery } from '../../api/api';
import { useHome } from '../../app/hooks';
import { ChartSkeleton, EmptyState, ErrorState, NotAvailable, PageHeader, PermissionDenied, SectionCard, SummaryCardsSkeleton } from '../../components/common/States';
import { DemoBadge } from '../../components/common/StatusBadge';
import { tokens } from '../../theme/theme';

type Range = 'live' | 'today' | '7d' | '30d' | 'custom';
const RANGES: { value: Range; label: string }[] = [
  { value: 'live', label: 'Live' },
  { value: 'today', label: 'Today' },
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
  { value: 'custom', label: 'Custom' },
];

const toLocalInput = (d: Date) => format(d, "yyyy-MM-dd'T'HH:mm");

function StatCard({ icon, label, value, hint }: { icon: React.ReactNode; label: string; value: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: tokens.motion.base }} style={{ height: '100%' }}>
      <Card sx={{ p: 2, height: '100%' }}>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ color: 'text.secondary', mb: 1 }}>
          <Box sx={{ color: 'primary.main', display: 'flex' }} aria-hidden>
            {icon}
          </Box>
          <Typography variant="body2" color="inherit" fontWeight={600}>
            {label}
          </Typography>
        </Stack>
        <Typography sx={{ fontSize: '1.45rem', fontWeight: 700, lineHeight: 1.2 }}>{value}</Typography>
        {hint && (
          <Typography variant="caption" component="p" sx={{ mt: 0.5 }}>
            {hint}
          </Typography>
        )}
      </Card>
    </motion.div>
  );
}

const v = (x: string | null, raw: number | null) => (raw === null ? <NotAvailable /> : x);

export default function EnergyPage() {
  const { homeId, can } = useHome();
  const allowed = can('energy.view');
  const [range, setRange] = useState<Range>('today');
  const [from, setFrom] = useState(() => toLocalInput(new Date(Date.now() - 3 * 86400_000)));
  const [to, setTo] = useState(() => toLocalInput(new Date()));
  const [showTable, setShowTable] = useState(false);

  const customValid = range !== 'custom' || (!!from && !!to && new Date(to) > new Date(from));
  const args = range === 'custom' ? { homeId, range, from: new Date(from).toISOString(), to: new Date(to).toISOString() } : { homeId, range };
  const q = useEnergyQuery(args, { skip: !allowed || !customValid, pollingInterval: range === 'live' || range === 'today' ? 30_000 : 0 });
  const e = q.data;

  if (!allowed) {
    return (
      <>
        <PageHeader title="Energy" />
        <PermissionDenied />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Energy"
        subtitle="Consumption, generation and storage reported by your integrations"
        actions={
          <ToggleButtonGroup size="small" exclusive value={range} onChange={(_, r) => r && setRange(r)} aria-label="Time range">
            {RANGES.map((r) => (
              <ToggleButton key={r.value} value={r.value}>
                {r.label}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
        }
      />
      {range === 'custom' && (
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mb: 2.5, maxWidth: 560 }}>
          <TextField size="small" type="datetime-local" label="From" value={from} onChange={(ev) => setFrom(ev.target.value)} InputLabelProps={{ shrink: true }} />
          <TextField
            size="small"
            type="datetime-local"
            label="To"
            value={to}
            onChange={(ev) => setTo(ev.target.value)}
            InputLabelProps={{ shrink: true }}
            error={!customValid}
            helperText={!customValid ? '"To" must be after "From".' : ' '}
          />
        </Stack>
      )}

      {q.isLoading ? (
        <Stack spacing={2.5}>
          <SummaryCardsSkeleton count={6} />
          <ChartSkeleton />
        </Stack>
      ) : q.error ? (
        <ErrorState error={q.error} onRetry={q.refetch} title="Could not load energy data" />
      ) : !e ? null : !e.available ? (
        <EmptyState
          icon={<Zap size={24} />}
          title="No energy data yet"
          description="Energy information appears when an integration reports it — for example a smart meter, an energy-monitoring plug or a solar inverter connected through Home Assistant. SmartNest never estimates consumption."
          action={
            can('integrations.manage') && (
              <Button component={RouterLink} to="/integrations/add" variant="contained">
                Add an integration
              </Button>
            )
          }
        />
      ) : (
        <EnergyContent e={e} range={range} showTable={showTable} setShowTable={setShowTable} fetching={q.isFetching} />
      )}
    </>
  );
}

function EnergyContent({ e, range, showTable, setShowTable, fetching }: { e: EnergyDto; range: Range; showTable: boolean; setShowTable: (v: boolean) => void; fetching: boolean }) {
  const allDemo = e.sources.length > 0 && e.sources.every((s) => s.isDemo);
  const hasSolar = e.sources.some((s) => s.kind === 'solar') || e.series.some((p) => p.solarKWh > 0);
  const daily = e.range.bucket === 'day';
  const data = useMemo(() => e.series.map((p) => ({ ...p, label: format(new Date(p.t), daily ? 'd MMM' : 'HH:mm') })), [e.series, daily]);
  const totalInRange = e.series.reduce((a, p) => a + p.consumptionKWh, 0);
  const maxDevice = Math.max(0.001, ...e.perDevice.map((d) => d.kWh));
  const money = (kWh: number | null) =>
    e.tariff && kWh !== null ? new Intl.NumberFormat(undefined, { style: 'currency', currency: e.tariff.currency }).format(kWh * e.tariff.perKWh) : null;
  const chartLabel = `${daily ? 'Daily' : 'Hourly'} energy consumption${hasSolar ? ' and solar generation' : ''} in kilowatt-hours, ${format(new Date(e.range.from), 'd MMM HH:mm')} to ${format(new Date(e.range.to), 'd MMM HH:mm')}. Total consumption ${totalInRange.toFixed(2)} kWh.`;

  const Chart = daily ? BarChart : AreaChart;
  return (
    <Stack spacing={2.5}>
      {allDemo && (
        <Alert severity="info" icon={<DemoBadge compact />}>
          All energy figures on this page come from the demonstration integration. They are simulated, not measured.
        </Alert>
      )}

      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: 'repeat(2, 1fr)', md: 'repeat(3, 1fr)', xl: 'repeat(6, 1fr)' } }}>
        <StatCard icon={<Gauge size={18} />} label="Current power" value={v(formatPower(e.currentPowerW), e.currentPowerW)} hint={e.thresholdW ? `Alert above ${formatPower(e.thresholdW)}` : undefined} />
        <StatCard icon={<Zap size={18} />} label="Today" value={v(formatEnergy(e.totals.todayKWh), e.totals.todayKWh)} hint={money(e.totals.todayKWh) ? `≈ ${money(e.totals.todayKWh)}` : undefined} />
        <StatCard icon={<Zap size={18} />} label="Last 7 days" value={v(formatEnergy(e.totals.weekKWh), e.totals.weekKWh)} hint={money(e.totals.weekKWh) ? `≈ ${money(e.totals.weekKWh)}` : undefined} />
        <StatCard icon={<Zap size={18} />} label="Last 30 days" value={v(formatEnergy(e.totals.monthKWh), e.totals.monthKWh)} hint={money(e.totals.monthKWh) ? `≈ ${money(e.totals.monthKWh)}` : undefined} />
        <StatCard icon={<Sun size={18} />} label="Solar now" value={v(formatPower(e.solarPowerW), e.solarPowerW)} hint={e.totals.solarTodayKWh !== null ? `${formatEnergy(e.totals.solarTodayKWh)} today` : undefined} />
        <StatCard icon={<BatteryCharging size={18} />} label="Home battery" value={e.batteryLevel === null ? <NotAvailable /> : `${e.batteryLevel}%`} />
      </Box>

      <SectionCard
        title={daily ? 'Daily energy' : 'Hourly energy'}
        action={<FormControlLabel control={<Switch size="small" checked={showTable} onChange={(ev) => setShowTable(ev.target.checked)} />} label="View as table" />}
      >
        {fetching && <LinearProgress sx={{ mb: 1 }} aria-label="Updating" />}
        <Box component="figure" sx={{ m: 0 }}>
          {showTable ? (
            <Box sx={{ maxHeight: 340, overflow: 'auto' }}>
              <Table size="small" stickyHeader aria-label={chartLabel}>
                <TableHead>
                  <TableRow>
                    <TableCell>{daily ? 'Day' : 'Hour'}</TableCell>
                    <TableCell align="right">Consumption (kWh)</TableCell>
                    {hasSolar && <TableCell align="right">Solar (kWh)</TableCell>}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {e.series.map((p) => (
                    <TableRow key={p.t}>
                      <TableCell>{format(new Date(p.t), daily ? 'EEE d MMM' : 'd MMM HH:mm')}</TableCell>
                      <TableCell align="right">{p.consumptionKWh.toFixed(3)}</TableCell>
                      {hasSolar && <TableCell align="right">{p.solarKWh.toFixed(3)}</TableCell>}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Box>
          ) : (
            <Box sx={{ height: { xs: 240, md: 320 } }} role="img" aria-label={chartLabel}>
              <ResponsiveContainer width="100%" height="100%">
                <Chart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid stroke={tokens.color.border} vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 12, fill: tokens.color.textSecondary }} tickLine={false} axisLine={false} minTickGap={16} />
                  <YAxis tick={{ fontSize: 12, fill: tokens.color.textSecondary }} tickLine={false} axisLine={false} width={48} unit=" kWh" tickFormatter={(x: number) => (x >= 10 ? x.toFixed(0) : x.toFixed(1))} />
                  <ChartTooltip
                    formatter={(val: number, name: string) => [`${val.toFixed(3)} kWh`, name]}
                    labelFormatter={(_l, payload) => {
                      const t = payload?.[0]?.payload?.t as string | undefined;
                      return t ? format(new Date(t), daily ? 'EEEE d MMMM' : 'd MMM, HH:mm') : '';
                    }}
                    contentStyle={{ borderRadius: 12, border: `1px solid ${tokens.color.border}` }}
                  />
                  <Legend />
                  {daily ? (
                    <>
                      <Bar dataKey="consumptionKWh" name="Consumption" fill={tokens.color.primary} radius={[6, 6, 0, 0]} />
                      {hasSolar && <Bar dataKey="solarKWh" name="Solar" fill={tokens.color.orange} radius={[6, 6, 0, 0]} />}
                    </>
                  ) : (
                    <>
                      <Area type="monotone" dataKey="consumptionKWh" name="Consumption" stroke={tokens.color.primary} fill={tokens.color.primary} fillOpacity={0.18} strokeWidth={2} />
                      {hasSolar && <Area type="monotone" dataKey="solarKWh" name="Solar" stroke={tokens.color.orange} fill={tokens.color.orange} fillOpacity={0.18} strokeWidth={2} />}
                    </>
                  )}
                </Chart>
              </ResponsiveContainer>
            </Box>
          )}
          <Typography component="figcaption" variant="caption" sx={{ display: 'block', mt: 1 }}>
            {format(new Date(e.range.from), 'd MMM yyyy, HH:mm')} – {format(new Date(e.range.to), 'd MMM yyyy, HH:mm')} · {daily ? 'daily' : 'hourly'} totals in kWh
            {range === 'live' ? ' · last 6 hours, refreshed every 30 s' : ''}
          </Typography>
        </Box>
      </SectionCard>

      <Box sx={{ display: 'grid', gap: 2.5, gridTemplateColumns: { xs: '1fr', lg: '3fr 2fr' }, alignItems: 'start' }}>
        <SectionCard title="Per-device consumption">
          {!e.perDevice.length ? (
            <Typography variant="body2" color="text.secondary">
              No individual devices report energy for this period. Energy-monitoring plugs or circuit monitors provide per-device figures.
            </Typography>
          ) : (
            <Stack spacing={1.5}>
              {e.perDevice.map((d) => (
                <Box key={d.deviceId}>
                  <Stack direction="row" justifyContent="space-between" spacing={1}>
                    <Link component={RouterLink} to={`/devices/${d.deviceId}`} underline="hover" color="text.primary" fontWeight={600} noWrap>
                      {d.name}
                    </Link>
                    <Typography variant="body2" sx={{ flexShrink: 0 }}>
                      {formatEnergy(d.kWh)} · now {d.currentW === null ? 'n/a' : formatPower(d.currentW)}
                    </Typography>
                  </Stack>
                  <LinearProgress variant="determinate" value={(d.kWh / maxDevice) * 100} aria-label={`${d.name}: ${formatEnergy(d.kWh)}`} sx={{ height: 8, mt: 0.5, '& .MuiLinearProgress-bar': { bgcolor: 'primary.main' } }} />
                </Box>
              ))}
            </Stack>
          )}
        </SectionCard>

        <Stack spacing={2.5}>
          {e.evCharging.length > 0 && (
            <SectionCard title="EV charging">
              <Stack spacing={1}>
                {e.evCharging.map((c) => (
                  <Stack key={c.deviceId} direction="row" spacing={1.5} alignItems="center">
                    <Car size={18} aria-hidden />
                    <Typography sx={{ flex: 1 }} fontWeight={600}>
                      {c.name}
                    </Typography>
                    <Typography variant="body2">
                      {c.charging ? 'Charging' : 'Not charging'}
                      {c.powerW !== null ? ` · ${formatPower(c.powerW)}` : ''}
                    </Typography>
                  </Stack>
                ))}
              </Stack>
            </SectionCard>
          )}
          <SectionCard title="Cost">
            {e.tariff ? (
              <Typography variant="body2" color="text.secondary">
                Estimated using your tariff of {new Intl.NumberFormat(undefined, { style: 'currency', currency: e.tariff.currency, maximumFractionDigits: 4 }).format(e.tariff.perKWh)} per kWh,
                multiplied by measured consumption. Excludes standing charges, taxes and time-of-use rates.{' '}
                <Link component={RouterLink} to="/settings/home">
                  Change tariff
                </Link>
              </Typography>
            ) : (
              <Typography variant="body2" color="text.secondary">
                Costs are not estimated until you set an electricity tariff and currency in{' '}
                <Link component={RouterLink} to="/settings/home">
                  home settings
                </Link>
                .
              </Typography>
            )}
          </SectionCard>
          <SectionCard title="Alerts">
            <Typography variant="body2" color="text.secondary">
              {e.thresholdW ? `You'll be notified when whole-home power exceeds ${formatPower(e.thresholdW)}. ` : 'No power threshold is configured. '}
              <Link component={RouterLink} to="/settings/notifications">
                {e.thresholdW ? 'Change threshold' : 'Set up an energy alert'}
              </Link>
            </Typography>
          </SectionCard>
          <SectionCard title="Data sources">
            {!e.sources.length ? (
              <Typography variant="body2" color="text.secondary">
                Totals are from historical readings only; no device currently reports energy.
              </Typography>
            ) : (
              <Stack spacing={1}>
                {e.sources.map((s) => (
                  <Stack key={`${s.deviceId}-${s.kind}`} direction="row" spacing={1} alignItems="center">
                    <Box sx={{ color: 'primary.main', display: 'flex' }} aria-hidden>
                      {s.kind === 'solar' ? <Sun size={16} /> : s.kind === 'battery' ? <BatteryCharging size={16} /> : s.kind === 'ev' ? <Car size={16} /> : <Plug size={16} />}
                    </Box>
                    <Link component={RouterLink} to={`/devices/${s.deviceId}`} underline="hover" color="text.primary" sx={{ flex: 1 }} noWrap>
                      {s.deviceName}
                    </Link>
                    <Typography variant="caption" sx={{ textTransform: 'capitalize' }}>
                      {s.kind === 'consumption' ? 'Consumption' : s.kind === 'ev' ? 'EV charging' : s.kind}
                    </Typography>
                    {s.isDemo && <DemoBadge compact />}
                  </Stack>
                ))}
              </Stack>
            )}
          </SectionCard>
        </Stack>
      </Box>
    </Stack>
  );
}

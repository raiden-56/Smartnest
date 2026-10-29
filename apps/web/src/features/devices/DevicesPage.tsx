import { useEffect, useMemo, useState } from 'react';
import {
  Badge, Box, Button, Card, Chip, Collapse, FormControl, FormControlLabel, IconButton, InputAdornment, InputLabel, MenuItem, Pagination, Paper, Select, Stack, Switch,
  TextField, ToggleButton, ToggleButtonGroup, Tooltip, Typography, type SelectChangeEvent,
} from '@mui/material';
import { AnimatePresence, motion } from 'framer-motion';
import { BookOpen, CheckSquare, Eye, EyeOff, FilterX, LayoutGrid, List as ListIcon, Plus, RefreshCw, Search, SlidersHorizontal, Star, X } from 'lucide-react';
import { Link as RouterLink, useSearchParams } from 'react-router-dom';
import { CATEGORY_INFO, DEVICE_CATEGORIES } from '@smartnest/shared';
import { toApiError, useBulkUpdateDevicesMutation, useDeviceCountsQuery, useDeviceFacetsQuery, useDevicesQuery, useIntegrationsQuery, useMeQuery, useRoomsQuery, useUpdatePreferencesMutation } from '../../api/api';
import { useHome } from '../../app/hooks';
import { pushToast, useAppDispatch, useLiveDevices } from '../../app/store';
import { DeviceGridSkeleton, EmptyState, ErrorState, ListSkeleton, PageHeader } from '../../components/common/States';
import { DeviceCard, DeviceRow } from '../../components/devices/DeviceCard';
import { tokens } from '../../theme/theme';

const FILTER_KEYS = ['q', 'roomId', 'category', 'manufacturer', 'integrationId', 'connectivity', 'operating', 'favourite', 'battery', 'includeHidden'] as const;
const PAGE_SIZE = 24;

function useDebounced<T>(value: T, ms = 250): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return v;
}

export default function DevicesPage() {
  const { homeId, can } = useHome();
  const dispatch = useAppDispatch();
  const [params, setParams] = useSearchParams();
  const me = useMeQuery();
  const [savePrefs] = useUpdatePreferencesMutation();
  const view = (params.get('view') as 'grid' | 'list' | null) ?? me.data?.preferences.deviceView ?? 'grid';
  const [search, setSearch] = useState(params.get('q') ?? '');
  const debounced = useDebounced(search);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const get = (k: string) => params.get(k) ?? '';
  const set = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    if (k !== 'page') next.delete('page');
    setParams(next, { replace: true });
  };
  useEffect(() => {
    if (debounced !== get('q')) set('q', debounced);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  const page = Number(get('page') || 1);
  const sort = (get('sort') || 'name') as 'name' | 'room' | 'updated' | 'connectivity' | 'category';
  const order = (get('order') || 'asc') as 'asc' | 'desc';
  const args = useMemo(
    () => ({
      homeId,
      page,
      pageSize: PAGE_SIZE,
      sort,
      order,
      ...Object.fromEntries(FILTER_KEYS.map((k) => [k, params.get(k) ?? undefined])),
    }),
    [homeId, page, sort, order, params],
  );
  const q = useDevicesQuery(args);
  const devices = useLiveDevices(q.data?.items);
  const counts = useDeviceCountsQuery(homeId);
  const rooms = useRoomsQuery(homeId);
  const facets = useDeviceFacetsQuery(homeId);
  const integrations = useIntegrationsQuery(homeId, { skip: !can('integrations.view') });
  const [bulk, bulkState] = useBulkUpdateDevicesMutation();

  const activeFilters = FILTER_KEYS.filter((k) => k !== 'q' && params.get(k));
  const clearFilters = () => {
    setSearch('');
    const next = new URLSearchParams();
    if (params.get('view')) next.set('view', params.get('view')!);
    setParams(next, { replace: true });
  };

  const setView = (v: 'grid' | 'list') => {
    set('view', v);
    if (me.data) void savePrefs({ ...me.data.preferences, deviceView: v });
  };

  const toggleSelected = (id: string, v: boolean) =>
    setSelected((s) => {
      const n = new Set(s);
      if (v) n.add(id);
      else n.delete(id);
      return n;
    });

  const runBulk = async (update: { roomId?: string | null; isFavourite?: boolean; isHidden?: boolean }, label: string) => {
    try {
      const r = await bulk({ homeId, ids: [...selected], update }).unwrap();
      dispatch(pushToast({ message: `${label}: ${r.updated} device${r.updated === 1 ? '' : 's'}`, severity: 'success' }));
      setSelected(new Set());
    } catch (e) {
      dispatch(pushToast({ message: toApiError(e).message, severity: 'error' }));
    }
  };

  const sel = (label: string, key: (typeof FILTER_KEYS)[number], options: { value: string; label: string }[]) => (
    <FormControl size="small" sx={{ minWidth: 150, flex: '1 1 150px' }}>
      <InputLabel id={`f-${key}`}>{label}</InputLabel>
      <Select labelId={`f-${key}`} label={label} value={get(key)} onChange={(e: SelectChangeEvent) => set(key, e.target.value)}>
        <MenuItem value="">
          <em>Any</em>
        </MenuItem>
        {options.map((o) => (
          <MenuItem key={o.value} value={o.value}>
            {o.label}
          </MenuItem>
        ))}
      </Select>
    </FormControl>
  );

  const totalPages = q.data ? Math.max(1, Math.ceil(q.data.total / PAGE_SIZE)) : 1;

  return (
    <>
      <PageHeader
        title="Devices"
        subtitle={
          counts.data ? (
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap component="span" sx={{ mt: 0.5 }}>
              <Chip size="small" label={`${counts.data.total} total`} />
              <Chip size="small" label={`${counts.data.online} online`} sx={{ bgcolor: '#E3F0E7', color: 'success.main' }} />
              <Chip size="small" label={`${counts.data.offline} offline`} sx={{ bgcolor: '#F8E4E2', color: 'error.main' }} />
              {counts.data.unavailable + counts.data.unknown > 0 && <Chip size="small" label={`${counts.data.unavailable + counts.data.unknown} unavailable / unknown`} />}
            </Stack>
          ) : undefined
        }
        actions={
          <>
            <Button component={RouterLink} to="/devices/catalogue" startIcon={<BookOpen size={16} />}>
              Catalogue
            </Button>
            <Tooltip title="Reload devices and counts from the server">
              <span>
                <Button variant="outlined" startIcon={<RefreshCw size={16} className={q.isFetching ? 'spin' : undefined} />} onClick={() => { void q.refetch(); void counts.refetch(); }} disabled={q.isFetching}>
                  Refresh
                </Button>
              </span>
            </Tooltip>
            {can('integrations.manage') && (
              <Button variant="contained" startIcon={<Plus size={18} />} component={RouterLink} to="/integrations/add">
                Add device
              </Button>
            )}
          </>
        }
      />

      {/* Toolbar */}
      <Card sx={{ p: { xs: 1.5, md: 2 }, mb: 2.5 }}>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} alignItems={{ md: 'center' }}>
          <TextField
            size="small"
            placeholder="Search name, manufacturer, model or room"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            inputProps={{ 'aria-label': 'Search devices' }}
            InputProps={{
              startAdornment: (<InputAdornment position="start"><Search size={16} /></InputAdornment>),
              endAdornment: search ? (<InputAdornment position="end"><IconButton size="small" aria-label="Clear search" onClick={() => setSearch('')}><X size={14} /></IconButton></InputAdornment>) : undefined,
            }}
            sx={{ flex: 1 }}
          />
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
            <Badge badgeContent={activeFilters.length} color="primary">
              <Button variant={filtersOpen ? 'contained' : 'outlined'} startIcon={<SlidersHorizontal size={16} />} onClick={() => setFiltersOpen((v) => !v)} aria-expanded={filtersOpen} aria-controls="device-filters">
                Filters
              </Button>
            </Badge>
            <FormControl size="small" sx={{ minWidth: 150 }}>
              <InputLabel id="sort-label">Sort by</InputLabel>
              <Select labelId="sort-label" label="Sort by" value={`${sort}:${order}`} onChange={(e) => { const [s, o] = e.target.value.split(':'); const next = new URLSearchParams(params); next.set('sort', s!); next.set('order', o!); next.delete('page'); setParams(next, { replace: true }); }}>
                <MenuItem value="name:asc">Name (A–Z)</MenuItem>
                <MenuItem value="name:desc">Name (Z–A)</MenuItem>
                <MenuItem value="room:asc">Room</MenuItem>
                <MenuItem value="category:asc">Category</MenuItem>
                <MenuItem value="connectivity:asc">Connectivity</MenuItem>
                <MenuItem value="updated:desc">Recently updated</MenuItem>
              </Select>
            </FormControl>
            <ToggleButtonGroup exclusive size="small" value={view} onChange={(_, v) => v && setView(v)} aria-label="View">
              <ToggleButton value="grid" aria-label="Grid view">
                <LayoutGrid size={16} />
              </ToggleButton>
              <ToggleButton value="list" aria-label="List view">
                <ListIcon size={16} />
              </ToggleButton>
            </ToggleButtonGroup>
            {can('devices.manage') && (
              <Tooltip title="Select multiple devices">
                <ToggleButton value="select" size="small" selected={selectMode} onChange={() => { setSelectMode((v) => !v); setSelected(new Set()); }} aria-label="Bulk selection">
                  <CheckSquare size={16} />
                </ToggleButton>
              </Tooltip>
            )}
          </Stack>
        </Stack>
        <Collapse in={filtersOpen} id="device-filters">
          <Stack direction="row" flexWrap="wrap" useFlexGap gap={1.5} sx={{ pt: 2 }}>
            {sel('Room', 'roomId', [{ value: 'none', label: 'No room' }, ...(rooms.data?.rooms.map((r) => ({ value: r.id, label: r.name })) ?? [])])}
            {sel('Category', 'category', DEVICE_CATEGORIES.map((c) => ({ value: c, label: CATEGORY_INFO[c].label })))}
            {sel('Manufacturer', 'manufacturer', (facets.data?.manufacturers ?? []).map((m) => ({ value: m, label: m })))}
            {integrations.data && sel('Integration', 'integrationId', integrations.data.integrations.map((i) => ({ value: i.id, label: i.name })))}
            {sel('Connectivity', 'connectivity', ['online', 'offline', 'unavailable', 'unknown'].map((c) => ({ value: c, label: c[0]!.toUpperCase() + c.slice(1) })))}
            {sel('Operating state', 'operating', [{ value: 'on', label: 'On' }, { value: 'off', label: 'Off' }, { value: 'unknown', label: 'Unknown / not applicable' }])}
            {sel('Battery', 'battery', [{ value: 'low', label: 'Low (≤ 20%)' }, { value: 'ok', label: 'OK' }, { value: 'none', label: 'No battery' }])}
            <FormControlLabel control={<Switch checked={get('favourite') === 'true'} onChange={(e) => set('favourite', e.target.checked ? 'true' : '')} />} label={<Stack direction="row" spacing={0.5} alignItems="center"><Star size={15} /> <span>Favourites</span></Stack>} />
            <FormControlLabel control={<Switch checked={get('includeHidden') === 'true'} onChange={(e) => set('includeHidden', e.target.checked ? 'true' : '')} />} label={<Stack direction="row" spacing={0.5} alignItems="center">{get('includeHidden') ? <Eye size={15} /> : <EyeOff size={15} />} <span>Include hidden</span></Stack>} />
            {activeFilters.length > 0 && (
              <Button startIcon={<FilterX size={16} />} onClick={clearFilters}>
                Clear filters
              </Button>
            )}
          </Stack>
        </Collapse>
      </Card>

      {/* Bulk bar */}
      <AnimatePresence>
        {selectMode && (
          <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: tokens.motion.fast }}>
            <Paper sx={{ p: 1.5, mb: 2, border: `1px solid ${tokens.color.primary}`, position: 'sticky', top: 8, zIndex: 5 }}>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ sm: 'center' }}>
                <Typography fontWeight={600} sx={{ mr: 1 }} role="status">
                  {selected.size} selected
                </Typography>
                <Button size="small" onClick={() => setSelected(new Set(devices.map((d) => d.id)))}>
                  Select page
                </Button>
                <Box sx={{ flex: 1 }} />
                <FormControl size="small" sx={{ minWidth: 160 }} disabled={!selected.size || bulkState.isLoading}>
                  <InputLabel id="bulk-room">Move to room</InputLabel>
                  <Select labelId="bulk-room" label="Move to room" value="" onChange={(e) => void runBulk({ roomId: e.target.value === 'none' ? null : e.target.value }, 'Moved')}>
                    <MenuItem value="none">No room</MenuItem>
                    {rooms.data?.rooms.map((r) => (
                      <MenuItem key={r.id} value={r.id}>
                        {r.name}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
                <Button size="small" variant="outlined" disabled={!selected.size} onClick={() => void runBulk({ isFavourite: true }, 'Added to favourites')}>
                  Favourite
                </Button>
                <Button size="small" variant="outlined" disabled={!selected.size} onClick={() => void runBulk({ isHidden: true }, 'Hidden')}>
                  Hide
                </Button>
                <Button size="small" variant="outlined" disabled={!selected.size} onClick={() => void runBulk({ isHidden: false }, 'Shown')}>
                  Unhide
                </Button>
                <IconButton aria-label="Exit selection" onClick={() => { setSelectMode(false); setSelected(new Set()); }}>
                  <X size={16} />
                </IconButton>
              </Stack>
            </Paper>
          </motion.div>
        )}
      </AnimatePresence>

      {q.isLoading && (view === 'grid' ? <DeviceGridSkeleton /> : <Card sx={{ p: 2 }}><ListSkeleton rows={8} /></Card>)}
      {q.error && <ErrorState error={q.error} onRetry={q.refetch} title="Could not load devices" />}
      {q.data && !devices.length && (
        activeFilters.length || get('q') ? (
          <EmptyState icon={<FilterX size={24} />} title="No devices match these filters" description="Try a different search or clear the filters." action={<Button onClick={clearFilters}>Clear filters</Button>} />
        ) : (
          <EmptyState
            icon={<Plus size={24} />}
            title="No devices yet"
            description="Connect Home Assistant or another supported integration to discover devices — or add the demonstration integration to explore without hardware."
            action={can('integrations.manage') && <Button variant="contained" component={RouterLink} to="/integrations/add">Add an integration</Button>}
          />
        )
      )}

      {devices.length > 0 &&
        (view === 'grid' ? (
          <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', opacity: q.isFetching ? 0.75 : 1, transition: 'opacity 150ms' }}>
            {devices.map((d) => (
              <DeviceCard key={d.id} device={d} selectable={selectMode} selected={selected.has(d.id)} onSelect={toggleSelected} />
            ))}
          </Box>
        ) : (
          <Card sx={{ opacity: q.isFetching ? 0.75 : 1 }}>
            {devices.map((d) => (
              <DeviceRow key={d.id} device={d} selectable={selectMode} selected={selected.has(d.id)} onSelect={toggleSelected} />
            ))}
          </Card>
        ))}

      {q.data && q.data.total > PAGE_SIZE && (
        <Stack alignItems="center" sx={{ mt: 3 }} spacing={1}>
          <Pagination count={totalPages} page={page} onChange={(_, p) => set('page', String(p))} color="primary" shape="rounded" />
          <Typography variant="caption">
            Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, q.data.total)} of {q.data.total}
          </Typography>
        </Stack>
      )}
    </>
  );
}

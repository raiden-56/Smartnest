import { useMemo, useState } from 'react';
import { Box, Button, Card, FormControlLabel, Stack, Switch, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';
import { motion } from 'framer-motion';
import { Cctv, Circle, CircleDot, LayoutGrid, List as ListIcon, Plus, Star } from 'lucide-react';
import { Link as RouterLink } from 'react-router-dom';
import type { CameraDto } from '@smartnest/shared';
import { useCamerasQuery } from '../../api/api';
import { timeAgo, useHome } from '../../app/hooks';
import { CameraSkeleton, EmptyState, ErrorState, PageHeader, PermissionDenied } from '../../components/common/States';
import { ConnectivityBadge, DemoBadge } from '../../components/common/StatusBadge';
import { tokens } from '../../theme/theme';
import { CameraView, useViewerCount } from './CameraView';

export function RecordingStatus({ camera }: { camera: CameraDto }) {
  const rec = camera.device.state.recording;
  if (rec === undefined) {
    return (
      <Typography variant="caption" color="text.secondary">
        Recording status not exposed
      </Typography>
    );
  }
  return (
    <Stack direction="row" spacing={0.5} alignItems="center" sx={{ color: rec ? 'error.main' : 'text.secondary' }}>
      {rec ? <CircleDot size={13} aria-hidden /> : <Circle size={13} aria-hidden />}
      <Typography variant="caption" sx={{ color: 'inherit', fontWeight: 600 }}>
        {rec ? 'Recording' : 'Not recording'}
      </Typography>
    </Stack>
  );
}

function CameraTile({ camera, homeId }: { camera: CameraDto; homeId: string }) {
  const d = camera.device;
  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: tokens.motion.base }}>
      <Card sx={{ overflow: 'hidden', height: '100%', display: 'flex', flexDirection: 'column' }}>
        <Box component={RouterLink} to={`/cameras/${d.id}`} aria-label={`Open ${d.name}`} sx={{ display: 'block', lineHeight: 0 }}>
          <CameraView camera={camera} homeId={homeId} rounded={false} />
        </Box>
        <Stack spacing={1} sx={{ p: 2 }}>
          <Stack direction="row" alignItems="center" spacing={1} justifyContent="space-between">
            <Box sx={{ minWidth: 0 }}>
              <Typography component={RouterLink} to={`/cameras/${d.id}`} variant="h5" noWrap sx={{ color: 'text.primary', textDecoration: 'none', display: 'block', '&:hover': { textDecoration: 'underline' } }}>
                {d.name}
              </Typography>
              <Typography variant="caption" noWrap component="p">
                {d.roomName ?? 'No room'} · {camera.live ? 'Live stream' : 'Snapshots only'}
              </Typography>
            </Box>
            {d.isFavourite && <Star size={16} fill={tokens.color.orange} color={tokens.color.orange} aria-label="Favourite" />}
          </Stack>
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
            <ConnectivityBadge state={d.connectivity} integrationDisconnected={d.integrationDisconnected} />
            {camera.isDemo && <DemoBadge compact />}
            <RecordingStatus camera={camera} />
          </Stack>
        </Stack>
      </Card>
    </motion.div>
  );
}

function CameraListRow({ camera }: { camera: CameraDto }) {
  const d = camera.device;
  const viewers = useViewerCount(camera);
  return (
    <Stack direction="row" alignItems="center" spacing={2} sx={{ py: 1.5, px: 2, borderBottom: `1px solid ${tokens.color.border}`, flexWrap: 'wrap', rowGap: 1 }}>
      <Box sx={{ width: 40, height: 40, borderRadius: 2, bgcolor: 'sage.main', color: 'primary.dark', display: 'grid', placeItems: 'center' }} aria-hidden>
        <Cctv size={20} />
      </Box>
      <Box sx={{ flex: 1, minWidth: 160 }}>
        <Typography component={RouterLink} to={`/cameras/${d.id}`} fontWeight={600} sx={{ color: 'text.primary', textDecoration: 'none', '&:hover': { textDecoration: 'underline' } }}>
          {d.name}
        </Typography>
        <Typography variant="caption" component="p">
          {d.roomName ?? 'No room'} · last frame {timeAgo(camera.lastFrameAt)}
        </Typography>
      </Box>
      <ConnectivityBadge state={d.connectivity} integrationDisconnected={d.integrationDisconnected} />
      {camera.isDemo && <DemoBadge compact />}
      <RecordingStatus camera={camera} />
      {viewers > 0 && (
        <Typography variant="caption" sx={{ color: 'warning.dark', fontWeight: 700 }}>
          Being viewed ({viewers})
        </Typography>
      )}
    </Stack>
  );
}

export default function CamerasPage() {
  const { homeId, can } = useHome();
  const allowed = can('cameras.view');
  const q = useCamerasQuery(homeId, { skip: !allowed, pollingInterval: 30_000 });
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [groupByRoom, setGroupByRoom] = useState(false);
  const [favOnly, setFavOnly] = useState(false);

  const cameras = useMemo(() => (q.data?.cameras ?? []).filter((c) => !favOnly || c.device.isFavourite), [q.data, favOnly]);
  const groups = useMemo(() => {
    if (!groupByRoom) return [{ name: null as string | null, items: cameras }];
    const m = new Map<string, CameraDto[]>();
    for (const c of cameras) {
      const k = c.device.roomName ?? 'No room';
      m.set(k, [...(m.get(k) ?? []), c]);
    }
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([name, items]) => ({ name, items }));
  }, [cameras, groupByRoom]);

  if (!allowed) {
    return (
      <>
        <PageHeader title="Cameras" />
        <PermissionDenied message="Your role does not include camera access. Camera footage is treated as sensitive; ask a home owner or administrator." />
      </>
    );
  }

  const online = q.data?.cameras.filter((c) => c.device.connectivity === 'online').length ?? 0;
  return (
    <>
      <PageHeader
        title="Cameras"
        subtitle={q.data ? `${q.data.cameras.length} camera${q.data.cameras.length === 1 ? '' : 's'} · ${online} online` : 'Live views and snapshots from supported integrations'}
        actions={
          can('integrations.manage') && (
            <Button component={RouterLink} to="/integrations/add" variant="outlined" startIcon={<Plus size={16} />}>
              Add camera
            </Button>
          )
        }
      />
      <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap" useFlexGap sx={{ mb: 2.5 }}>
        <ToggleButtonGroup size="small" exclusive value={view} onChange={(_, v) => v && setView(v)} aria-label="Camera layout">
          <ToggleButton value="grid" aria-label="Grid view">
            <LayoutGrid size={16} />
            <Box component="span" sx={{ ml: 0.75 }}>
              Grid
            </Box>
          </ToggleButton>
          <ToggleButton value="list" aria-label="List view">
            <ListIcon size={16} />
            <Box component="span" sx={{ ml: 0.75 }}>
              List
            </Box>
          </ToggleButton>
        </ToggleButtonGroup>
        <FormControlLabel control={<Switch checked={groupByRoom} onChange={(e) => setGroupByRoom(e.target.checked)} />} label="Group by room" />
        <FormControlLabel control={<Switch checked={favOnly} onChange={(e) => setFavOnly(e.target.checked)} />} label="Favourites only" />
      </Stack>

      {q.isLoading ? (
        <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 320px), 1fr))' }}>
          {Array.from({ length: 3 }, (_, i) => (
            <CameraSkeleton key={i} />
          ))}
        </Box>
      ) : q.error ? (
        <ErrorState error={q.error} onRetry={q.refetch} title="Could not load cameras" />
      ) : !q.data?.cameras.length ? (
        <EmptyState
          icon={<Cctv size={24} />}
          title="No cameras yet"
          description="Cameras appear here once a supported integration (for example Home Assistant with ONVIF or a generic camera) exposes them."
          action={
            can('integrations.manage') && (
              <Button component={RouterLink} to="/integrations/add" variant="contained">
                Add an integration
              </Button>
            )
          }
        />
      ) : !cameras.length ? (
        <EmptyState icon={<Star size={24} />} title="No favourite cameras" description="Mark a camera as a favourite from its device menu, or turn off the filter." action={<Button onClick={() => setFavOnly(false)}>Show all cameras</Button>} />
      ) : (
        <Stack spacing={3}>
          {groups.map((g) => (
            <Box key={g.name ?? 'all'} component="section" aria-label={g.name ?? 'All cameras'}>
              {g.name && (
                <Typography variant="h4" component="h2" sx={{ mb: 1.5 }}>
                  {g.name}
                </Typography>
              )}
              {view === 'grid' ? (
                <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 320px), 1fr))' }}>
                  {g.items.map((c) => (
                    <CameraTile key={c.device.id} camera={c} homeId={homeId} />
                  ))}
                </Box>
              ) : (
                <Card>
                  {g.items.map((c) => (
                    <CameraListRow key={c.device.id} camera={c} />
                  ))}
                </Card>
              )}
            </Box>
          ))}
        </Stack>
      )}
    </>
  );
}

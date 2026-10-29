import { useEffect, useRef, useState } from 'react';
import { Box, Button, Card, Chip, IconButton, ListItemIcon, Menu, MenuItem, Stack, Tooltip, Typography } from '@mui/material';
import { motion } from 'framer-motion';
import { AlertTriangle, Copy, History, MoreVertical, Pencil, Play, Plus, ShieldCheck, Sparkles, Star, Trash2 } from 'lucide-react';
import { Link as RouterLink, useNavigate, useSearchParams } from 'react-router-dom';
import type { SceneDto } from '@smartnest/shared';
import { toApiError, useDeleteSceneMutation, useDuplicateSceneMutation, useFavouriteSceneMutation, useRoomsQuery, useScenesQuery } from '../../api/api';
import { timeAgo, useHome } from '../../app/hooks';
import { pushToast, useAppDispatch, useAppSelector } from '../../app/store';
import { AppIcon } from '../../components/common/AppIcon';
import { useConfirm } from '../../components/common/Dialogs';
import { EmptyState, ErrorState, PageHeader, RoomCardsSkeleton } from '../../components/common/States';
import { tokens } from '../../theme/theme';
import { SceneExecutionDialog, SceneHistoryDialog, SceneStatusChip, useActivateScene } from './SceneExecution';

function SceneCard({
  scene, roomName, highlighted, onRun, busy, onHistory,
}: { scene: SceneDto; roomName: string | null; highlighted: boolean; onRun: () => void; busy: boolean; onHistory: () => void }) {
  const { homeId, can } = useHome();
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const confirm = useConfirm();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [favourite] = useFavouriteSceneMutation();
  const [duplicate] = useDuplicateSceneMutation();
  const [remove] = useDeleteSceneMutation();
  const liveLast = useAppSelector((s) => (scene.lastExecution ? s.live.sceneExecutions[scene.lastExecution.id] : undefined));
  const last = liveLast ?? scene.lastExecution;
  const unavailable = scene.actions.filter((a) => !a.deviceAvailable);
  const manage = can('scenes.manage');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (highlighted) ref.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [highlighted]);

  const act = async (p: Promise<unknown>, ok: string) => {
    try {
      await p;
      dispatch(pushToast({ message: ok, severity: 'success' }));
    } catch (e) {
      dispatch(pushToast({ message: toApiError(e).message, severity: 'error' }));
    }
  };

  return (
    <motion.div ref={ref} layout initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }} style={{ height: '100%' }}>
      <Card
        sx={{
          p: 2, height: '100%', display: 'flex', flexDirection: 'column', gap: 1.5,
          borderColor: highlighted ? 'primary.main' : undefined, boxShadow: highlighted ? `0 0 0 3px ${tokens.color.sage}` : undefined,
        }}
      >
        <Stack direction="row" spacing={1.5} alignItems="flex-start">
          <Box sx={{ width: 46, height: 46, borderRadius: '14px', bgcolor: 'sage.main', color: 'primary.dark', display: 'grid', placeItems: 'center', flexShrink: 0 }} aria-hidden>
            <AppIcon name={scene.icon} size={22} />
          </Box>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Stack direction="row" spacing={0.75} alignItems="center">
              <Typography variant="h5" component="h3" noWrap title={scene.name}>
                {scene.name}
              </Typography>
              {scene.isFavourite && <Star size={15} fill={tokens.color.orange} color={tokens.color.orange} aria-label="Favourite" />}
            </Stack>
            <Typography variant="caption" component="p">
              {scene.actions.length} action{scene.actions.length === 1 ? '' : 's'} · {scene.executionMode === 'sequential' ? 'in order' : 'in parallel'}
              {roomName ? ` · ${roomName}` : ''}
            </Typography>
          </Box>
          <IconButton size="small" aria-label={`More actions for ${scene.name}`} aria-haspopup="menu" onClick={(e) => setAnchor(e.currentTarget)}>
            <MoreVertical size={18} />
          </IconButton>
          <Menu anchorEl={anchor} open={!!anchor} onClose={() => setAnchor(null)}>
            <MenuItem onClick={() => { setAnchor(null); onHistory(); }}>
              <ListItemIcon><History size={16} /></ListItemIcon>Run history
            </MenuItem>
            {manage && (
              <MenuItem onClick={() => navigate(`/scenes/${scene.id}/edit`)}>
                <ListItemIcon><Pencil size={16} /></ListItemIcon>Edit
              </MenuItem>
            )}
            {manage && (
              <MenuItem onClick={() => { setAnchor(null); void act(favourite({ homeId, sceneId: scene.id, isFavourite: !scene.isFavourite }).unwrap(), scene.isFavourite ? 'Removed from favourites' : 'Added to favourites'); }}>
                <ListItemIcon><Star size={16} /></ListItemIcon>
                {scene.isFavourite ? 'Remove from favourites' : 'Add to favourites'}
              </MenuItem>
            )}
            {manage && (
              <MenuItem onClick={() => { setAnchor(null); void act(duplicate({ homeId, sceneId: scene.id }).unwrap(), 'Scene duplicated'); }}>
                <ListItemIcon><Copy size={16} /></ListItemIcon>Duplicate
              </MenuItem>
            )}
            {manage && (
              <MenuItem
                sx={{ color: 'error.main' }}
                onClick={async () => {
                  setAnchor(null);
                  const ok = await confirm({ title: `Delete “${scene.name}”?`, message: 'The scene and its run history will be deleted. Devices are not affected.', tone: 'danger', confirmLabel: 'Delete' });
                  if (ok) void act(remove({ homeId, sceneId: scene.id }).unwrap(), 'Scene deleted');
                }}
              >
                <ListItemIcon sx={{ color: 'inherit' }}><Trash2 size={16} /></ListItemIcon>Delete
              </MenuItem>
            )}
          </Menu>
        </Stack>

        {scene.description && (
          <Typography variant="body2" color="text.secondary" sx={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
            {scene.description}
          </Typography>
        )}

        <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
          {scene.requiresConfirmation && <Chip size="small" icon={<ShieldCheck size={13} />} label="Requires confirmation" sx={{ bgcolor: '#F8EEDC', color: 'warning.dark', '& .MuiChip-icon': { color: 'inherit' } }} />}
          {unavailable.length > 0 && (
            <Tooltip title={`Currently unreachable: ${unavailable.map((a) => a.deviceName).join(', ')}`}>
              <Chip size="small" icon={<AlertTriangle size={13} />} label={`${unavailable.length} device${unavailable.length > 1 ? 's' : ''} unavailable`} sx={{ bgcolor: '#F8E4E2', color: 'error.main', '& .MuiChip-icon': { color: 'inherit' } }} />
            </Tooltip>
          )}
        </Stack>

        <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1} sx={{ mt: 'auto' }}>
          <Box sx={{ minWidth: 0 }}>
            <SceneStatusChip status={last?.status} />
            {last && (
              <Typography variant="caption" component="p" sx={{ mt: 0.5 }}>
                {timeAgo(last.startedAt)}
              </Typography>
            )}
          </Box>
          {can('scenes.activate') && (
            <Button variant="contained" startIcon={<Play size={16} />} onClick={onRun} disabled={busy || !scene.actions.length} aria-label={`Activate scene ${scene.name}`}>
              {busy ? 'Starting…' : 'Activate'}
            </Button>
          )}
        </Stack>
      </Card>
    </motion.div>
  );
}

export default function ScenesPage() {
  const { homeId, can } = useHome();
  const q = useScenesQuery(homeId);
  const rooms = useRoomsQuery(homeId);
  const { run, busyId, running, close } = useActivateScene();
  const [history, setHistory] = useState<SceneDto | null>(null);
  const [params, setParams] = useSearchParams();
  const highlight = params.get('highlight');
  const runId = params.get('run');
  const handledRun = useRef<string | null>(null);

  useEffect(() => {
    if (!runId || !q.data || handledRun.current === runId) return;
    handledRun.current = runId;
    const s = q.data.scenes.find((x) => x.id === runId);
    const next = new URLSearchParams(params);
    next.delete('run');
    setParams(next, { replace: true });
    if (s) void run(s);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId, q.data]);

  const roomName = (id: string | null) => (id ? (rooms.data?.rooms.find((r) => r.id === id)?.name ?? null) : null);
  const scenes = q.data?.scenes ?? [];

  return (
    <Box>
      <PageHeader
        title="Scenes"
        subtitle="Set several devices at once. Results are reported per device — a scene is only “completed” when every device confirms."
        actions={can('scenes.manage') && <Button variant="contained" startIcon={<Plus size={16} />} component={RouterLink} to="/scenes/new">New scene</Button>}
      />
      {q.isLoading ? (
        <RoomCardsSkeleton count={6} />
      ) : q.error ? (
        <ErrorState error={q.error} onRetry={q.refetch} title="Could not load scenes" />
      ) : !scenes.length ? (
        <EmptyState
          icon={<Sparkles size={24} />}
          title="No scenes yet"
          description="Create scenes like “Good Night” or “Movie Time” to set several devices with one tap."
          action={can('scenes.manage') && <Button variant="contained" startIcon={<Plus size={16} />} component={RouterLink} to="/scenes/new">Create a scene</Button>}
        />
      ) : (
        <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 280px), 1fr))' }}>
          {scenes.map((s) => (
            <SceneCard key={s.id} scene={s} roomName={roomName(s.roomId)} highlighted={highlight === s.id} busy={busyId === s.id} onRun={() => void run(s)} onHistory={() => setHistory(s)} />
          ))}
        </Box>
      )}
      <SceneExecutionDialog executionId={running?.executionId ?? null} sceneName={running?.sceneName ?? ''} onClose={close} />
      <SceneHistoryDialog scene={history} onClose={() => setHistory(null)} />
    </Box>
  );
}

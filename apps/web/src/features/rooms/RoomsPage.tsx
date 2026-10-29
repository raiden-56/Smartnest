import { useEffect, useState } from 'react';
import { Box, Button, Card, IconButton, ListItemIcon, Menu, MenuItem, Stack, Tooltip, Typography } from '@mui/material';
import { motion } from 'framer-motion';
import { ArrowDown, ArrowUp, Droplets, Leaf, MoreVertical, Pencil, Plus, Star, Thermometer, Trash2, ArrowUpDown, Check } from 'lucide-react';
import { Link as RouterLink, useSearchParams } from 'react-router-dom';
import type { RoomDto } from '@smartnest/shared';
import { toApiError, useDeleteRoomMutation, useReorderRoomsMutation, useRoomsQuery, useUpdateRoomMutation } from '../../api/api';
import { useFormatTemperature, useHome } from '../../app/hooks';
import { pushToast, useAppDispatch } from '../../app/store';
import { AppIcon } from '../../components/common/AppIcon';
import { useConfirm } from '../../components/common/Dialogs';
import { EmptyState, ErrorState, PageHeader, RoomCardsSkeleton } from '../../components/common/States';
import { tokens } from '../../theme/theme';
import { RoomDialog } from './RoomDialog';

export function EnvironmentChips({ env }: { env: RoomDto['environment'] }) {
  const fmt = useFormatTemperature();
  const items = [
    env.temperature !== undefined && { icon: <Thermometer size={14} />, text: fmt(env.temperature), label: 'Temperature' },
    env.humidity !== undefined && { icon: <Droplets size={14} />, text: `${env.humidity}%`, label: 'Humidity' },
    env.co2 !== undefined && { icon: <Leaf size={14} />, text: `${env.co2} ppm`, label: 'CO₂' },
  ].filter(Boolean) as { icon: React.ReactNode; text: string; label: string }[];
  if (!items.length) return null;
  return (
    <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap>
      {items.map((i) => (
        <Stack key={i.label} direction="row" spacing={0.5} alignItems="center" sx={{ color: 'text.secondary' }} aria-label={`${i.label} ${i.text}`}>
          {i.icon}
          <Typography variant="caption" fontWeight={600} sx={{ color: 'text.primary' }}>
            {i.text}
          </Typography>
        </Stack>
      ))}
    </Stack>
  );
}

function RoomCard({ room, index, total, reordering, onMove, onEdit }: { room: RoomDto; index: number; total: number; reordering: boolean; onMove: (dir: -1 | 1) => void; onEdit: () => void }) {
  const { homeId, can } = useHome();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [update] = useUpdateRoomMutation();
  const [remove] = useDeleteRoomMutation();
  const confirm = useConfirm();
  const dispatch = useAppDispatch();
  const manage = can('rooms.manage');
  return (
    <motion.div layout transition={{ duration: tokens.motion.base }}>
      <Card sx={{ position: 'relative', overflow: 'hidden', height: '100%', transition: 'box-shadow 160ms', '&:hover': { boxShadow: tokens.shadow.raised } }}>
        {room.coverImageUrl && <Box sx={{ height: 84, backgroundImage: `url(${room.coverImageUrl})`, backgroundSize: 'cover', backgroundPosition: 'center' }} role="img" aria-label={`${room.name} cover image`} />}
        <Box sx={{ p: 2 }}>
          <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
            <Box sx={{ width: 44, height: 44, borderRadius: '14px', bgcolor: room.activeCount > 0 ? 'accent.main' : 'sage.main', color: room.activeCount > 0 ? '#fff' : 'primary.dark', display: 'grid', placeItems: 'center' }} aria-hidden>
              <AppIcon name={room.icon} size={22} />
            </Box>
            {reordering ? (
              <Stack direction="row">
                <IconButton size="small" aria-label={`Move ${room.name} earlier`} disabled={index === 0} onClick={() => onMove(-1)}>
                  <ArrowUp size={16} />
                </IconButton>
                <IconButton size="small" aria-label={`Move ${room.name} later`} disabled={index === total - 1} onClick={() => onMove(1)}>
                  <ArrowDown size={16} />
                </IconButton>
              </Stack>
            ) : (
              <Stack direction="row" alignItems="center">
                {manage && (
                  <Tooltip title={room.isFavourite ? 'Remove from favourites' : 'Add to favourites'}>
                    <IconButton size="small" aria-pressed={room.isFavourite} aria-label={`${room.name} favourite`} onClick={() => void update({ homeId, roomId: room.id, isFavourite: !room.isFavourite })}>
                      <Star size={17} fill={room.isFavourite ? tokens.color.orange : 'none'} color={room.isFavourite ? tokens.color.orange : tokens.color.textSecondary} />
                    </IconButton>
                  </Tooltip>
                )}
                {manage && (
                  <IconButton size="small" aria-label={`More actions for ${room.name}`} onClick={(e) => setAnchor(e.currentTarget)}>
                    <MoreVertical size={17} />
                  </IconButton>
                )}
              </Stack>
            )}
          </Stack>
          <Typography component={RouterLink} to={`/rooms/${room.id}`} variant="h4" sx={{ display: 'block', mt: 1.5, color: 'text.primary', textDecoration: 'none', '&:hover': { textDecoration: 'underline' } }}>
            {room.name}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
            {room.deviceCount === 0 ? 'No devices' : `${room.deviceCount} device${room.deviceCount === 1 ? '' : 's'} · ${room.onlineCount} online${room.activeCount ? ` · ${room.activeCount} on` : ''}`}
          </Typography>
          <Box sx={{ mt: 1.25, position: 'relative', zIndex: 1 }}>
            <EnvironmentChips env={room.environment} />
          </Box>
        </Box>
        <Menu anchorEl={anchor} open={!!anchor} onClose={() => setAnchor(null)}>
          <MenuItem onClick={() => { setAnchor(null); onEdit(); }}>
            <ListItemIcon>
              <Pencil size={16} />
            </ListItemIcon>
            Edit
          </MenuItem>
          <MenuItem
            sx={{ color: 'error.main' }}
            onClick={async () => {
              setAnchor(null);
              const ok = await confirm({
                title: `Delete ${room.name}?`,
                message: `The room is removed. Its ${room.deviceCount} device${room.deviceCount === 1 ? '' : 's'} stay in SmartNest and become unassigned.`,
                tone: 'danger',
                confirmLabel: 'Delete room',
              });
              if (!ok) return;
              try {
                await remove({ homeId, roomId: room.id }).unwrap();
                dispatch(pushToast({ message: `${room.name} deleted`, severity: 'success' }));
              } catch (e) {
                dispatch(pushToast({ message: toApiError(e).message, severity: 'error' }));
              }
            }}
          >
            <ListItemIcon sx={{ color: 'inherit' }}>
              <Trash2 size={16} />
            </ListItemIcon>
            Delete
          </MenuItem>
        </Menu>
      </Card>
    </motion.div>
  );
}

export default function RoomsPage() {
  const { homeId, can } = useHome();
  const q = useRoomsQuery(homeId);
  const [reorder] = useReorderRoomsMutation();
  const [params, setParams] = useSearchParams();
  const [dialog, setDialog] = useState<{ open: boolean; room: RoomDto | null }>({ open: false, room: null });
  const [reordering, setReordering] = useState(false);
  const [order, setOrder] = useState<RoomDto[]>([]);
  const dispatch = useAppDispatch();

  useEffect(() => {
    if (params.get('new') === '1' && can('rooms.manage')) {
      setDialog({ open: true, room: null });
      params.delete('new');
      setParams(params, { replace: true });
    }
  }, [params, setParams, can]);
  useEffect(() => {
    if (q.data) setOrder(q.data.rooms);
  }, [q.data]);

  const move = (i: number, dir: -1 | 1) => {
    const next = [...order];
    const [r] = next.splice(i, 1);
    next.splice(i + dir, 0, r!);
    setOrder(next);
  };
  const finishReorder = async () => {
    setReordering(false);
    try {
      await reorder({ homeId, ids: order.map((r) => r.id) }).unwrap();
      dispatch(pushToast({ message: 'Room order saved', severity: 'success' }));
    } catch (e) {
      dispatch(pushToast({ message: toApiError(e).message, severity: 'error' }));
    }
  };

  const rooms = reordering ? order : (q.data?.rooms ?? []);
  return (
    <>
      <PageHeader
        title="Rooms"
        subtitle={q.data ? `${q.data.rooms.length} room${q.data.rooms.length === 1 ? '' : 's'}` : undefined}
        actions={
          can('rooms.manage') && (
            <>
              {rooms.length > 1 &&
                (reordering ? (
                  <Button variant="outlined" startIcon={<Check size={16} />} onClick={finishReorder}>
                    Done
                  </Button>
                ) : (
                  <Button variant="outlined" startIcon={<ArrowUpDown size={16} />} onClick={() => setReordering(true)}>
                    Reorder
                  </Button>
                ))}
              <Button variant="contained" startIcon={<Plus size={18} />} onClick={() => setDialog({ open: true, room: null })}>
                Add room
              </Button>
            </>
          )
        }
      />
      {q.isLoading && <RoomCardsSkeleton />}
      {q.error && <ErrorState error={q.error} onRetry={q.refetch} title="Could not load rooms" />}
      {q.data && !rooms.length && (
        <EmptyState
          icon={<AppIcon name="sofa" size={26} />}
          title="No rooms yet"
          description="Rooms help you organise devices and run room-wide actions like turning all the lights off."
          action={can('rooms.manage') && <Button variant="contained" onClick={() => setDialog({ open: true, room: null })}>Add your first room</Button>}
        />
      )}
      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))' }}>
        {rooms.map((r, i) => (
          <RoomCard key={r.id} room={r} index={i} total={rooms.length} reordering={reordering} onMove={(d) => move(i, d)} onEdit={() => setDialog({ open: true, room: r })} />
        ))}
      </Box>
      <RoomDialog open={dialog.open} room={dialog.room} existingNames={q.data?.rooms.map((r) => r.name)} onClose={() => setDialog({ open: false, room: null })} />
    </>
  );
}

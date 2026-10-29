import { useState } from 'react';
import { Box, Breadcrumbs, Button, Link, List, ListItem, ListItemText, Stack, Typography } from '@mui/material';
import { Lightbulb, LightbulbOff, Pencil, Power, Sparkles } from 'lucide-react';
import { Link as RouterLink, useNavigate, useParams } from 'react-router-dom';
import { toApiError, useActivityQuery, useDevicesQuery, useRoomActionMutation, useRoomsQuery, useScenesQuery } from '../../api/api';
import { timeAgo, useHome } from '../../app/hooks';
import { pushToast, useAppDispatch, useLiveDevices } from '../../app/store';
import { AppIcon } from '../../components/common/AppIcon';
import { DetailSkeleton, DeviceGridSkeleton, EmptyState, ErrorState, PageHeader, SectionCard } from '../../components/common/States';
import { SeverityDot } from '../../components/common/StatusBadge';
import { DeviceCard } from '../../components/devices/DeviceCard';
import { EnvironmentChips } from './RoomsPage';
import { RoomDialog } from './RoomDialog';

export default function RoomDetailPage() {
  const { roomId = '' } = useParams();
  const { homeId, can } = useHome();
  const rooms = useRoomsQuery(homeId);
  const room = rooms.data?.rooms.find((r) => r.id === roomId);
  const devicesQ = useDevicesQuery({ homeId, roomId, pageSize: 100 });
  const devices = useLiveDevices(devicesQ.data?.items);
  const scenes = useScenesQuery(homeId);
  const activity = useActivityQuery({ homeId, roomId, limit: 10 }, { skip: !can('activity.view') });
  const [roomAction, ra] = useRoomActionMutation();
  const [editing, setEditing] = useState(false);
  const dispatch = useAppDispatch();
  const navigate = useNavigate();

  if (rooms.isLoading) return <DetailSkeleton />;
  if (rooms.error) return <ErrorState error={rooms.error} onRetry={rooms.refetch} />;
  if (!room) return <EmptyState title="Room not found" description="It may have been deleted." action={<Button onClick={() => navigate('/rooms')}>Back to rooms</Button>} />;

  const hasLights = devices.some((d) => d.category === 'lighting' && d.capabilities.some((c) => c.type === 'onOff'));
  const roomScenes = scenes.data?.scenes.filter((s) => s.roomId === room.id) ?? [];

  const run = async (action: 'lightsOn' | 'lightsOff' | 'allOff', label: string) => {
    try {
      const r = await roomAction({ homeId, roomId: room.id, action }).unwrap();
      dispatch(pushToast({ message: r.targeted ? `${label}: ${r.targeted} command${r.targeted === 1 ? '' : 's'} sent — watch each device for confirmation` : 'No supported devices in this room', severity: r.targeted ? 'info' : 'warning' }));
    } catch (e) {
      dispatch(pushToast({ message: toApiError(e).message, severity: 'error' }));
    }
  };

  return (
    <>
      <Breadcrumbs sx={{ mb: 1 }}>
        <Link component={RouterLink} to="/rooms" underline="hover" color="inherit">
          Rooms
        </Link>
        <Typography color="text.primary">{room.name}</Typography>
      </Breadcrumbs>
      <PageHeader
        title={
          <Stack direction="row" spacing={1.5} alignItems="center">
            <Box sx={{ width: 48, height: 48, borderRadius: '14px', bgcolor: 'sage.main', color: 'primary.dark', display: 'grid', placeItems: 'center' }} aria-hidden>
              <AppIcon name={room.icon} size={24} />
            </Box>
            <span>{room.name}</span>
          </Stack>
        }
        subtitle={
          <Stack spacing={0.75} component="span">
            <span>
              {room.deviceCount} device{room.deviceCount === 1 ? '' : 's'} · {room.onlineCount} online
            </span>
            <EnvironmentChips env={room.environment} />
          </Stack>
        }
        actions={
          <>
            {can('devices.control') && hasLights && (
              <>
                <Button variant="outlined" startIcon={<Lightbulb size={16} />} disabled={ra.isLoading} onClick={() => run('lightsOn', 'Lights on')}>
                  Lights on
                </Button>
                <Button variant="outlined" startIcon={<LightbulbOff size={16} />} disabled={ra.isLoading} onClick={() => run('lightsOff', 'Lights off')}>
                  Lights off
                </Button>
              </>
            )}
            {can('devices.control') && devices.length > 0 && (
              <Button variant="outlined" startIcon={<Power size={16} />} disabled={ra.isLoading} onClick={() => run('allOff', 'All off')}>
                All off
              </Button>
            )}
            {can('rooms.manage') && (
              <Button startIcon={<Pencil size={16} />} onClick={() => setEditing(true)}>
                Edit
              </Button>
            )}
          </>
        }
      />
      <Typography variant="caption" component="p" sx={{ mt: -2, mb: 2 }}>
        "All off" turns off lights, plugs, media and climate devices only. Locks, alarms, cameras and safety devices are never included.
      </Typography>

      <Box sx={{ display: 'grid', gap: 2.5, gridTemplateColumns: { xs: '1fr', lg: '1fr 340px' }, alignItems: 'start' }}>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="h3" component="h2" sx={{ mb: 1.5 }}>
            Devices
          </Typography>
          {devicesQ.isLoading && <DeviceGridSkeleton count={4} />}
          {devicesQ.error && <ErrorState error={devicesQ.error} onRetry={devicesQ.refetch} />}
          {devicesQ.data && !devices.length && (
            <EmptyState
              icon={<AppIcon name="cpu" size={24} />}
              title="No devices in this room"
              description="Move devices here from the Devices page, or import new ones from an integration."
              action={can('devices.manage') && <Button component={RouterLink} to="/devices">Go to devices</Button>}
            />
          )}
          <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))' }}>
            {devices.map((d) => (
              <DeviceCard key={d.id} device={d} showRoom={false} />
            ))}
          </Box>
        </Box>
        <Stack spacing={2.5}>
          <SectionCard title="Scenes for this room">
            {roomScenes.length ? (
              <Stack spacing={1}>
                {roomScenes.map((s) => (
                  <Button key={s.id} variant="outlined" startIcon={<Sparkles size={16} />} onClick={() => navigate(`/scenes?run=${s.id}`)} sx={{ justifyContent: 'flex-start' }} disabled={!can('scenes.activate')}>
                    {s.name}
                  </Button>
                ))}
              </Stack>
            ) : (
              <Typography variant="body2" color="text.secondary">
                No scenes are assigned to this room.{' '}
                {can('scenes.manage') && (
                  <Link component={RouterLink} to="/scenes/new">
                    Create one
                  </Link>
                )}
              </Typography>
            )}
          </SectionCard>
          {can('activity.view') && (
            <SectionCard title="Recent activity" action={<Button size="small" component={RouterLink} to={`/activity`}>All activity</Button>}>
              {activity.data?.items.length ? (
                <List dense disablePadding>
                  {activity.data.items.map((a) => (
                    <ListItem key={a.id} disableGutters sx={{ gap: 1.25, alignItems: 'flex-start' }}>
                      <Box sx={{ pt: 1 }}>
                        <SeverityDot severity={a.severity} />
                      </Box>
                      <ListItemText primary={a.title} secondary={timeAgo(a.createdAt)} primaryTypographyProps={{ variant: 'body2' }} />
                    </ListItem>
                  ))}
                </List>
              ) : (
                <Typography variant="body2" color="text.secondary">
                  {activity.isLoading ? 'Loading…' : 'Nothing has happened here recently.'}
                </Typography>
              )}
            </SectionCard>
          )}
        </Stack>
      </Box>
      <RoomDialog open={editing} room={room} onClose={() => setEditing(false)} />
    </>
  );
}

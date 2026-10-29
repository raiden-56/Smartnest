import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Box, Button, Card, Divider, IconButton, List, ListItem, ListItemText, Stack, Tooltip, Typography } from '@mui/material';
import { ArrowLeft, Eye, Maximize2, Minimize2, RefreshCw } from 'lucide-react';
import { Link as RouterLink, useParams } from 'react-router-dom';
import { useActivityQuery, useCamerasQuery } from '../../api/api';
import { formatDateTime, timeAgo, useHome } from '../../app/hooks';
import { useLiveDevice } from '../../app/store';
import { DeviceReadings, FullDeviceControls } from '../../components/devices/CapabilityControls';
import { DetailSkeleton, EmptyState, ErrorState, PageHeader, PermissionDenied, SectionCard } from '../../components/common/States';
import { ConnectivityBadge, DemoBadge } from '../../components/common/StatusBadge';
import { CameraView, useViewerCount } from './CameraView';
import { RecordingStatus } from './CamerasPage';
import { SNAPSHOT_REFRESH_MS } from './useCameraMedia';

type FsElement = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> };
type FsDocument = Document & { webkitFullscreenElement?: Element | null; webkitExitFullscreen?: () => Promise<void> };

function useFullscreen() {
  const ref = useRef<HTMLDivElement>(null);
  const [native, setNative] = useState(false);
  const [pseudo, setPseudo] = useState(false);
  useEffect(() => {
    const on = () => {
      const d = document as FsDocument;
      setNative(!!(d.fullscreenElement ?? d.webkitFullscreenElement));
    };
    document.addEventListener('fullscreenchange', on);
    document.addEventListener('webkitfullscreenchange', on);
    return () => {
      document.removeEventListener('fullscreenchange', on);
      document.removeEventListener('webkitfullscreenchange', on);
    };
  }, []);
  useEffect(() => {
    if (!pseudo) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setPseudo(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pseudo]);
  const toggle = useCallback(async () => {
    const d = document as FsDocument;
    if (native) {
      await (d.exitFullscreen?.() ?? d.webkitExitFullscreen?.())?.catch(() => undefined);
      return;
    }
    if (pseudo) {
      setPseudo(false);
      return;
    }
    const el = ref.current as FsElement | null;
    const req = el?.requestFullscreen?.bind(el) ?? el?.webkitRequestFullscreen?.bind(el);
    // Phones (e.g. iOS Safari) may not support element fullscreen; fall back to a full-viewport overlay.
    if (req) await req().catch(() => setPseudo(true));
    else setPseudo(true);
  }, [native, pseudo]);
  return { ref, isFullscreen: native || pseudo, pseudo, toggle };
}

export default function CameraDetailPage() {
  const { deviceId = '' } = useParams();
  const { homeId, can } = useHome();
  const allowed = can('cameras.view');
  const q = useCamerasQuery(homeId, { skip: !allowed, pollingInterval: 30_000 });
  const camera = useMemo(() => q.data?.cameras.find((c) => c.device.id === deviceId), [q.data, deviceId]);
  const device = useLiveDevice(camera?.device);
  const activity = useActivityQuery({ homeId, deviceId, limit: 20 }, { skip: !allowed || !camera || !can('activity.view') });
  const [refreshKey, setRefreshKey] = useState(0);
  const fs = useFullscreen();

  if (!allowed) return <PermissionDenied message="Your role does not include camera access." />;
  if (q.isLoading) return <DetailSkeleton />;
  if (q.error) return <ErrorState error={q.error} onRetry={q.refetch} title="Could not load this camera" />;
  if (!camera || !device) {
    return (
      <EmptyState
        title="Camera not found"
        description="It may have been removed, or it doesn't provide a camera stream."
        action={
          <Button component={RouterLink} to="/cameras" startIcon={<ArrowLeft size={16} />}>
            Back to cameras
          </Button>
        }
      />
    );
  }
  const liveCamera = { ...camera, device };
  const events = [
    ...camera.events.map((e) => ({ id: e.id, title: e.title, createdAt: e.createdAt })),
    ...(activity.data?.items ?? []).map((a) => ({ id: a.id, title: a.title, createdAt: a.createdAt })),
  ]
    .filter((e, i, arr) => arr.findIndex((x) => x.id === e.id) === i)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 20);

  return (
    <>
      <PageHeader
        eyebrow={
          <Button component={RouterLink} to="/cameras" size="small" startIcon={<ArrowLeft size={14} />} sx={{ ml: -1 }}>
            Cameras
          </Button>
        }
        title={device.name}
        subtitle={`${device.roomName ?? 'No room'} · ${device.integrationName}`}
        actions={
          <>
            <ConnectivityBadge state={device.connectivity} integrationDisconnected={device.integrationDisconnected} size="medium" />
            {camera.isDemo && <DemoBadge />}
          </>
        }
      />
      <Box sx={{ display: 'grid', gap: 2.5, gridTemplateColumns: { xs: '1fr', lg: 'minmax(0, 2fr) minmax(300px, 1fr)' }, alignItems: 'start' }}>
        <Stack spacing={2.5} sx={{ minWidth: 0 }}>
          <Card sx={{ p: { xs: 1.5, md: 2 } }}>
            <Box
              ref={fs.ref}
              sx={{
                position: fs.pseudo ? 'fixed' : 'relative',
                inset: fs.pseudo ? 0 : undefined,
                zIndex: fs.pseudo ? 1400 : undefined,
                bgcolor: fs.isFullscreen ? '#000' : 'transparent',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'center',
                height: fs.isFullscreen ? '100%' : undefined,
              }}
            >
              <CameraView camera={liveCamera} homeId={homeId} preferLive refreshKey={refreshKey} rounded={!fs.isFullscreen} />
              <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 1.25, px: fs.isFullscreen ? 2 : 0, pb: fs.isFullscreen ? 2 : 0, color: fs.isFullscreen ? '#fff' : undefined }}>
                <Typography variant="caption" sx={{ color: 'inherit', flex: 1 }}>
                  {camera.live ? 'Live stream via secure proxy' : `Snapshot · refreshed every ${SNAPSHOT_REFRESH_MS / 1000} s`}
                  {camera.isDemo ? ' · demonstration image, not a real camera' : ''}
                </Typography>
                <Tooltip title="Refresh now">
                  <IconButton aria-label="Refresh camera image" onClick={() => setRefreshKey((k) => k + 1)} sx={{ color: 'inherit' }}>
                    <RefreshCw size={18} />
                  </IconButton>
                </Tooltip>
                <Tooltip title={fs.isFullscreen ? 'Exit full screen' : 'Full screen'}>
                  <IconButton aria-label={fs.isFullscreen ? 'Exit full screen' : 'Show camera full screen'} onClick={() => void fs.toggle()} sx={{ color: 'inherit' }}>
                    {fs.isFullscreen ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
                  </IconButton>
                </Tooltip>
              </Stack>
            </Box>
          </Card>
          <PrivacyNotice camera={liveCamera} />
          <SectionCard title="Event history">
            {!events.length ? (
              <Typography color="text.secondary" variant="body2">
                No camera events recorded{camera.isDemo ? ' yet' : ' — event history depends on what the integration reports'}.
              </Typography>
            ) : (
              <List dense disablePadding>
                {events.map((e) => (
                  <ListItem key={e.id} disableGutters divider>
                    <ListItemText primary={e.title} secondary={`${formatDateTime(e.createdAt)} · ${timeAgo(e.createdAt)}`} />
                  </ListItem>
                ))}
              </List>
            )}
          </SectionCard>
        </Stack>
        <Stack spacing={2.5} sx={{ minWidth: 0 }}>
          <SectionCard title="Status">
            <Stack spacing={1.25}>
              <Row label="Connectivity" value={<ConnectivityBadge state={device.connectivity} integrationDisconnected={device.integrationDisconnected} />} />
              <Row label="Stream" value={camera.live ? 'Live (MJPEG)' : camera.snapshot ? 'Snapshots only' : 'Not available'} />
              <Row label="Recording" value={<RecordingStatus camera={liveCamera} />} />
              <Row label="Last frame / update" value={camera.lastFrameAt ? timeAgo(camera.lastFrameAt) : 'Not reported'} />
            </Stack>
            <Divider sx={{ my: 2 }} />
            <DeviceReadings device={device} />
          </SectionCard>
          {can('cameras.control') ? (
            <SectionCard title="Camera controls">
              <FullDeviceControls device={device} canControlCameras />
            </SectionCard>
          ) : (
            <Alert severity="info">Your role can view this camera but not control it.</Alert>
          )}
        </Stack>
      </Box>
    </>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={2}>
      <Typography variant="body2" color="text.secondary">
        {label}
      </Typography>
      <Box sx={{ textAlign: 'right' }}>{typeof value === 'string' ? <Typography variant="body2" fontWeight={600}>{value}</Typography> : value}</Box>
    </Stack>
  );
}

function PrivacyNotice({ camera }: { camera: Parameters<typeof useViewerCount>[0] }) {
  const viewers = useViewerCount(camera);
  const others = Math.max(0, viewers - 1);
  return (
    <Alert severity="warning" icon={<Eye size={20} />} sx={{ alignItems: 'center' }}>
      <strong>You are viewing this camera.</strong> {others > 0 ? `${others} other ${others === 1 ? 'person is' : 'people are'} also viewing it. ` : ''}
      Views are recorded in the home's audit log.
    </Alert>
  );
}

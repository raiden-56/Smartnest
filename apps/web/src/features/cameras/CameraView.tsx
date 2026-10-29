import { useEffect, useRef, useState } from 'react';
import { Box, Chip, Stack, Typography } from '@mui/material';
import { CameraOff, Eye, FlaskConical, Radio } from 'lucide-react';
import type { CameraDto } from '@smartnest/shared';
import { useAppSelector } from '../../app/store';
import { tokens } from '../../theme/theme';
import { useCameraMedia, useInView, usePageVisible } from './useCameraMedia';

export function useViewerCount(camera: CameraDto): number {
  const live = useAppSelector((s) => s.live.cameraViewers[camera.device.id]);
  return live ?? camera.activeViewers;
}

/** Why a camera cannot show an image, or null if it can try. */
export function cameraUnavailableReason(camera: CameraDto): string | null {
  const d = camera.device;
  if (d.integrationDisconnected) return 'The integration for this camera is disconnected.';
  if (d.connectivity === 'offline') return 'Camera is offline.';
  if (d.connectivity === 'unavailable') return 'Camera is unavailable.';
  if (!camera.snapshot && !camera.live) return 'This camera does not provide images through its integration.';
  return null;
}

export function UnavailableMedia({ message }: { message: string }) {
  return (
    <Stack alignItems="center" justifyContent="center" spacing={1} sx={{ position: 'absolute', inset: 0, bgcolor: '#2F3531', color: '#E6E4DC', textAlign: 'center', p: 2 }} role="img" aria-label={`Camera image unavailable: ${message}`}>
      <CameraOff size={28} aria-hidden />
      <Typography variant="body2" sx={{ color: 'inherit', fontWeight: 600 }}>
        {message}
      </Typography>
      <Typography variant="caption" sx={{ color: 'rgba(230,228,220,0.75)' }}>
        No image is shown rather than a placeholder.
      </Typography>
    </Stack>
  );
}

interface Props {
  camera: CameraDto;
  homeId: string;
  /** Use the live MJPEG stream when the camera supports it (detail view). */
  preferLive?: boolean;
  /** Increment to force a manual refresh */
  refreshKey?: number;
  rounded?: boolean;
}

/**
 * Renders a camera image from short-lived signed URLs. Refreshes snapshots
 * only while visible on screen and while the tab is in the foreground.
 */
export function CameraView({ camera, homeId, preferLive, refreshKey = 0, rounded = true }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref);
  const pageVisible = usePageVisible();
  const unavailable = cameraUnavailableReason(camera);
  const useStream = !!preferLive && camera.live;
  const active = !unavailable && inView && pageVisible;
  const { urls, snapshotSrc, error, refresh } = useCameraMedia(homeId, camera.device.id, active);
  const [imgError, setImgError] = useState(false);
  const [loaded, setLoaded] = useState(false);
  // Keep the first stream URL: the token only authorises opening the stream.
  const [streamSrc, setStreamSrc] = useState<string | null>(null);
  const viewers = useViewerCount(camera);

  useEffect(() => {
    if (useStream && urls && (!streamSrc || imgError)) {
      setStreamSrc(urls.streamUrl);
      setImgError(false);
    }
  }, [useStream, urls, streamSrc, imgError]);

  useEffect(() => {
    if (refreshKey > 0) {
      setImgError(false);
      if (useStream) setStreamSrc(null);
      refresh();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  const src = useStream ? (active ? streamSrc : null) : snapshotSrc;
  const message = unavailable ?? error ?? (imgError ? 'The image could not be loaded from the camera.' : null);

  return (
    <Box ref={ref} sx={{ position: 'relative', width: '100%', aspectRatio: '16 / 9', bgcolor: '#2F3531', overflow: 'hidden', borderRadius: rounded ? `${tokens.radius.md}px` : 0 }}>
      {message ? (
        <UnavailableMedia message={message} />
      ) : (
        src && (
          <Box
            component="img"
            src={src}
            alt={`${camera.isDemo ? 'Demonstration image' : useStream ? 'Live view' : 'Latest snapshot'} from ${camera.device.name}`}
            onError={() => setImgError(true)}
            onLoad={() => {
              setLoaded(true);
              setImgError(false);
            }}
            sx={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain', opacity: loaded ? 1 : 0, transition: 'opacity 200ms' }}
          />
        )
      )}
      {!message && !loaded && (
        <Stack alignItems="center" justifyContent="center" sx={{ position: 'absolute', inset: 0, color: 'rgba(230,228,220,0.75)' }}>
          <Typography variant="caption" sx={{ color: 'inherit' }}>
            {active ? 'Loading image…' : 'Paused while off-screen'}
          </Typography>
        </Stack>
      )}
      <Stack direction="row" spacing={0.75} sx={{ position: 'absolute', top: 8, left: 8, right: 8, flexWrap: 'wrap', rowGap: 0.75 }}>
        {!message && (
          <Chip
            size="small"
            icon={useStream ? <Radio size={13} /> : undefined}
            label={useStream ? 'Live' : 'Snapshot'}
            sx={{ bgcolor: useStream ? tokens.color.error : 'rgba(37,42,39,0.75)', color: '#fff', height: 22, fontWeight: 700, '& .MuiChip-icon': { color: '#fff' } }}
          />
        )}
        {camera.isDemo && (
          <Chip size="small" icon={<FlaskConical size={13} />} label="Demonstration image" sx={{ bgcolor: '#FDEBD8', color: '#8A4B12', height: 22, '& .MuiChip-icon': { color: 'inherit' } }} />
        )}
        {viewers > 0 && (
          <Chip
            size="small"
            icon={<Eye size={13} />}
            label={`Being viewed${viewers > 1 ? ` · ${viewers}` : ''}`}
            sx={{ ml: 'auto !important', bgcolor: 'rgba(242,140,40,0.92)', color: '#252A27', height: 22, fontWeight: 700, '& .MuiChip-icon': { color: 'inherit' } }}
            aria-label={`Privacy indicator: ${viewers} active viewer${viewers === 1 ? '' : 's'}`}
          />
        )}
      </Stack>
    </Box>
  );
}

import { useCallback, useEffect, useRef, useState } from 'react';
import { Box, Button, ButtonBase, Chip, CircularProgress, MenuItem, Select, Stack, Typography } from '@mui/material';
import { AlertTriangle, Camera, CheckCircle2, Eye, Maximize2, Sparkles, VideoOff, XCircle } from 'lucide-react';
import { Link as RouterLink } from 'react-router-dom';
import type { CameraDto, SceneDto } from '@smartnest/shared';
import { toApiError, useActivateSceneMutation, useCameraTokenMutation, useCamerasQuery, useScenesQuery } from '../../../api/api';
import { timeAgo, useHome } from '../../../app/hooks';
import { announce, pushToast, sceneExecutionUpdated, useAppDispatch, useAppSelector, useLiveDevice } from '../../../app/store';
import { AppIcon } from '../../../components/common/AppIcon';
import { useConfirm } from '../../../components/common/Dialogs';
import { ConnectivityBadge } from '../../../components/common/StatusBadge';
import { CameraSkeleton, ErrorState, ListSkeleton } from '../../../components/common/States';
import { tokens } from '../../../theme/theme';
import { WidgetCard, WidgetEmpty, type WidgetProps } from './WidgetFrame';

// ─── Quick actions (scenes) ───────────────────────────────────────────────

function SceneButton({ scene, canRun }: { scene: SceneDto; canRun: boolean }) {
  const { homeId } = useHome();
  const dispatch = useAppDispatch();
  const confirm = useConfirm();
  const [activate, { isLoading }] = useActivateSceneMutation();
  const [execId, setExecId] = useState<string | null>(null);
  const exec = useAppSelector((s) => (execId ? s.live.sceneExecutions[execId] : undefined));
  const [showResult, setShowResult] = useState(false);

  useEffect(() => {
    if (!exec || exec.status === 'running') return;
    setShowResult(true);
    const ok = exec.results.filter((r) => r.status === 'confirmed').length;
    const msg =
      exec.status === 'succeeded'
        ? `“${scene.name}” completed — all ${exec.results.length} actions confirmed.`
        : exec.status === 'partial'
          ? `“${scene.name}” partly completed: ${ok} of ${exec.results.length} actions confirmed.`
          : `“${scene.name}” failed: no actions were confirmed.`;
    dispatch(announce(msg));
    if (exec.status !== 'succeeded') dispatch(pushToast({ message: msg, severity: exec.status === 'partial' ? 'warning' : 'error', action: { label: 'Details', href: `/scenes?highlight=${scene.id}` } }));
    const t = window.setTimeout(() => setShowResult(false), 6000);
    return () => window.clearTimeout(t);
  }, [exec?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  const run = async () => {
    const attempt = (confirmed?: boolean) => activate({ homeId, sceneId: scene.id, confirmed }).unwrap();
    try {
      let r;
      try {
        r = await attempt();
      } catch (e) {
        if (toApiError(e).code !== 'confirmation_required') throw e;
        const ok = await confirm({
          title: `Run “${scene.name}”?`,
          message: 'This scene includes security-sensitive actions such as locking doors or arming the alarm. The result of each action will be shown.',
          tone: 'security',
          confirmLabel: 'Run scene',
        });
        if (!ok) return;
        r = await attempt(true);
      }
      dispatch(sceneExecutionUpdated(r.execution));
      setExecId(r.execution.id);
      setShowResult(false);
    } catch (e) {
      dispatch(pushToast({ message: `${scene.name}: ${toApiError(e).message}`, severity: 'error' }));
    }
  };

  const running = isLoading || exec?.status === 'running';
  const done = exec?.results.filter((r) => r.status === 'confirmed' || r.status === 'failed' || r.status === 'timed_out').length ?? 0;
  const confirmed = exec?.results.filter((r) => r.status === 'confirmed').length ?? 0;
  const result = showResult && exec && exec.status !== 'running' ? exec.status : null;
  const resultMeta = result
    ? { succeeded: { icon: <CheckCircle2 size={14} />, text: 'Done', color: tokens.color.success }, partial: { icon: <AlertTriangle size={14} />, text: `${confirmed}/${exec!.results.length} done`, color: tokens.color.warning }, failed: { icon: <XCircle size={14} />, text: 'Failed', color: tokens.color.error } }[result]
    : null;

  return (
    <ButtonBase
      onClick={() => void run()}
      disabled={!canRun || running}
      aria-label={`Run scene ${scene.name}${scene.requiresConfirmation ? ' (requires confirmation)' : ''}`}
      sx={{
        borderRadius: `${tokens.radius.md}px`, border: `1px solid ${tokens.color.border}`, bgcolor: running ? 'sage.light' : '#FCFBF8', p: 1.25, display: 'flex', alignItems: 'center',
        justifyContent: 'flex-start', gap: 1, textAlign: 'left', minHeight: 50, transition: 'background-color 150ms, border-color 150ms',
        '&:hover': { borderColor: 'primary.light', bgcolor: 'sage.light' }, '&.Mui-disabled': { opacity: canRun ? 1 : 0.6 },
      }}
    >
      <Box sx={{ width: 30, height: 30, borderRadius: '9px', bgcolor: 'sage.main', color: 'primary.dark', display: 'grid', placeItems: 'center', flexShrink: 0 }} aria-hidden>
        {running ? <CircularProgress size={16} thickness={5} /> : <AppIcon name={scene.icon} size={17} />}
      </Box>
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Typography variant="body2" fontWeight={650} noWrap>
          {scene.name}
        </Typography>
        <Typography variant="caption" component="div" noWrap sx={{ color: resultMeta?.color }} aria-live="polite">
          {running && exec ? (
            `Running · ${done}/${exec.results.length}`
          ) : resultMeta ? (
            <Stack direction="row" spacing={0.5} alignItems="center" component="span">
              {resultMeta.icon}
              <span>{resultMeta.text}</span>
            </Stack>
          ) : (
            `${scene.actions.length} action${scene.actions.length === 1 ? '' : 's'}${scene.requiresConfirmation ? ' · confirm' : ''}`
          )}
        </Typography>
      </Box>
    </ButtonBase>
  );
}

export function QuickActionsWidget(_: WidgetProps) {
  const { homeId, can } = useHome();
  const q = useScenesQuery(homeId);
  const scenes = q.data?.scenes ?? [];
  const shown = (scenes.some((s) => s.isFavourite) ? scenes.filter((s) => s.isFavourite) : scenes).slice(0, 6);
  return (
    <WidgetCard
      title="Quick actions"
      action={
        <Button component={RouterLink} to="/scenes" size="small">
          All scenes
        </Button>
      }
    >
      {q.isLoading ? (
        <ListSkeleton rows={2} height={48} />
      ) : q.error ? (
        <ErrorState error={q.error} onRetry={q.refetch} />
      ) : !shown.length ? (
        <WidgetEmpty
          icon={<Sparkles size={20} />}
          title="No scenes yet"
          action={
            can('scenes.manage') ? (
              <Button component={RouterLink} to="/scenes/new" size="small" variant="outlined">
                Create a scene
              </Button>
            ) : undefined
          }
        />
      ) : (
        <Box sx={{ display: 'grid', gap: 1, gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 140px), 1fr))' }}>
          {shown.map((s) => (
            <SceneButton key={s.id} scene={s} canRun={can('scenes.activate')} />
          ))}
        </Box>
      )}
    </WidgetCard>
  );
}

// ─── Camera ───────────────────────────────────────────────────────────────

const SNAPSHOT_REFRESH_MS = 5000;
const TOKEN_RENEW_MS = 45_000;

/** Authenticated snapshot preview. The URL carries a 60 s signed token, renewed before expiry. */
export function CameraPreview({ camera }: { camera: CameraDto }) {
  const { homeId } = useHome();
  const device = useLiveDevice(camera.device);
  const viewers = useAppSelector((s) => s.live.cameraViewers[device.id] ?? camera.activeViewers);
  const [getToken] = useCameraTokenMutation();
  const [baseUrl, setBaseUrl] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [status, setStatus] = useState<'loading' | 'ok' | 'error'>('loading');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [lastFrame, setLastFrame] = useState<Date | null>(null);
  const tokenAt = useRef(0);
  const unavailable = device.connectivity !== 'online' || device.integrationDisconnected || !camera.snapshot;

  const renew = useCallback(async () => {
    try {
      const r = await getToken({ homeId, deviceId: device.id }).unwrap();
      tokenAt.current = Date.now();
      setBaseUrl(r.snapshotUrl);
      setErrorMsg(null);
    } catch (e) {
      setStatus('error');
      setErrorMsg(toApiError(e).message);
    }
  }, [getToken, homeId, device.id]);

  useEffect(() => {
    if (unavailable) return;
    setStatus('loading');
    void renew();
    const t = window.setInterval(() => {
      if (document.hidden) return; // don't stream to a background tab
      if (Date.now() - tokenAt.current > TOKEN_RENEW_MS) void renew();
      else setTick((x) => x + 1);
    }, SNAPSHOT_REFRESH_MS);
    return () => window.clearInterval(t);
  }, [unavailable, renew]);

  if (unavailable) {
    return (
      <Box sx={{ aspectRatio: '16 / 9', borderRadius: `${tokens.radius.md}px`, bgcolor: tokens.color.disabled, display: 'grid', placeItems: 'center', textAlign: 'center', p: 2 }}>
        <Stack spacing={1} alignItems="center" sx={{ color: 'text.secondary' }}>
          <VideoOff size={28} aria-hidden />
          <Typography variant="body2" fontWeight={600}>
            {!camera.snapshot ? 'This camera does not provide images through its integration' : 'Camera unavailable'}
          </Typography>
          <ConnectivityBadge state={device.connectivity} integrationDisconnected={device.integrationDisconnected} />
          <Typography variant="caption">Last seen {timeAgo(device.lastSeenAt)}</Typography>
        </Stack>
      </Box>
    );
  }

  const src = baseUrl ? `${baseUrl}&_=${tick}` : null;
  return (
    <Box sx={{ position: 'relative', aspectRatio: '16 / 9', borderRadius: `${tokens.radius.md}px`, overflow: 'hidden', bgcolor: '#1F2421' }}>
      {status === 'loading' && !lastFrame && (
        <Box sx={{ position: 'absolute', inset: 0 }}>
          <CameraSkeleton />
        </Box>
      )}
      {status === 'error' && !lastFrame ? (
        <Stack spacing={1} alignItems="center" justifyContent="center" sx={{ position: 'absolute', inset: 0, color: '#fff', p: 2, textAlign: 'center' }}>
          <VideoOff size={26} aria-hidden />
          <Typography variant="body2">{errorMsg ?? 'The camera image could not be loaded.'}</Typography>
          <Button size="small" variant="outlined" color="inherit" onClick={() => void renew()}>
            Retry
          </Button>
        </Stack>
      ) : (
        src && (
          <Box
            component="img"
            src={src}
            alt={camera.isDemo ? `Demonstration image for ${device.name} — not a live camera feed` : `Latest snapshot from ${device.name}`}
            onLoad={() => {
              setStatus('ok');
              setLastFrame(new Date());
            }}
            onError={() => {
              setStatus('error');
              void renew();
            }}
            sx={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          />
        )
      )}
      <Stack direction="row" spacing={0.75} sx={{ position: 'absolute', top: 8, left: 8, right: 8 }} flexWrap="wrap" useFlexGap>
        {camera.isDemo ? (
          <Chip size="small" label="Demonstration image" sx={{ bgcolor: '#FDEBD8', color: '#8A4B12', fontWeight: 700 }} />
        ) : (
          <Chip size="small" icon={<Camera size={13} />} label="Snapshot" sx={{ bgcolor: 'rgba(37,42,39,0.7)', color: '#fff', '& .MuiChip-icon': { color: 'inherit' } }} />
        )}
        <Chip
          size="small"
          icon={<Eye size={13} />}
          label={viewers > 1 ? `Being viewed (${viewers})` : 'You are viewing'}
          sx={{ bgcolor: 'rgba(201,79,69,0.85)', color: '#fff', '& .MuiChip-icon': { color: 'inherit' } }}
          aria-label="Privacy indicator: this camera is being viewed"
        />
      </Stack>
      {lastFrame && (
        <Typography variant="caption" sx={{ position: 'absolute', bottom: 6, right: 10, color: '#fff', textShadow: '0 1px 2px rgba(0,0,0,0.6)' }}>
          Frame {lastFrame.toLocaleTimeString()}
        </Typography>
      )}
    </Box>
  );
}

export function CameraWidget({ widget }: WidgetProps) {
  const { homeId, can } = useHome();
  const allowed = can('cameras.view');
  const q = useCamerasQuery(homeId, { skip: !allowed });
  const cameras = q.data?.cameras ?? [];
  const configured = typeof widget.config.deviceId === 'string' ? widget.config.deviceId : null;
  const [selected, setSelected] = useState<string | null>(null);
  const camera = cameras.find((c) => c.device.id === (selected ?? configured)) ?? cameras.find((c) => c.device.connectivity === 'online') ?? cameras[0];
  return (
    <WidgetCard
      title="Camera"
      action={
        camera && (
          <Stack direction="row" spacing={0.5} alignItems="center" sx={{ minWidth: 0 }}>
            {cameras.length > 1 && (
              <Select
                size="small"
                value={camera.device.id}
                onChange={(e) => setSelected(String(e.target.value))}
                inputProps={{ 'aria-label': 'Choose camera' }}
                sx={{ minWidth: 0, maxWidth: 150, flexShrink: 1, '& .MuiSelect-select': { py: 0.5, fontSize: '0.82rem' } }}
              >
                {cameras.map((c) => (
                  <MenuItem key={c.device.id} value={c.device.id}>
                    {c.device.name}
                  </MenuItem>
                ))}
              </Select>
            )}
            <Button component={RouterLink} to={`/cameras/${camera.device.id}`} size="small" startIcon={<Maximize2 size={14} />} aria-label={`Open ${camera.device.name}`}>
              Open
            </Button>
          </Stack>
        )
      }
    >
      {!allowed ? (
        <WidgetEmpty icon={<Camera size={20} />} title="Camera access is not included in your role" description="Ask a home owner or administrator if you need it." />
      ) : q.isLoading ? (
        <CameraSkeleton />
      ) : q.error ? (
        <ErrorState error={q.error} onRetry={q.refetch} />
      ) : !camera ? (
        <WidgetEmpty icon={<Camera size={20} />} title="No cameras" description="Cameras appear here when a supported integration provides them." />
      ) : (
        <Stack spacing={1}>
          <CameraPreview key={camera.device.id} camera={camera} />
          <Typography variant="caption">
            {camera.device.name} · {camera.device.roomName ?? 'No room'}
            {camera.isDemo ? ' · simulated camera' : ''}
          </Typography>
        </Stack>
      )}
    </WidgetCard>
  );
}

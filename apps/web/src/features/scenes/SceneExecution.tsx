import { useState } from 'react';
import { Alert, Box, Button, Chip, Collapse, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, LinearProgress, Stack, Typography } from '@mui/material';
import { CheckCircle2, ChevronDown, ChevronRight, Clock, Loader2, MinusCircle, XCircle } from 'lucide-react';
import type { SceneDto, SceneExecutionDto } from '@smartnest/shared';
import { toApiError, useActivateSceneMutation, useSceneExecutionsQuery } from '../../api/api';
import { formatDateTime, timeAgo, useHome } from '../../app/hooks';
import { pushToast, sceneExecutionUpdated, useAppDispatch, useAppSelector } from '../../app/store';
import { useConfirm } from '../../components/common/Dialogs';
import { ListSkeleton } from '../../components/common/States';
import { tokens } from '../../theme/theme';

type ResultStatus = SceneExecutionDto['results'][number]['status'];

const RESULT_META: Record<ResultStatus, { icon: React.ReactNode; label: string; color: string }> = {
  pending: { icon: <Loader2 size={16} className="spin" aria-hidden />, label: 'Sending', color: tokens.color.textSecondary },
  sent: { icon: <Loader2 size={16} className="spin" aria-hidden />, label: 'Waiting for device', color: tokens.color.textSecondary },
  confirmed: { icon: <CheckCircle2 size={16} aria-hidden />, label: 'Confirmed', color: tokens.color.success },
  failed: { icon: <XCircle size={16} aria-hidden />, label: 'Failed', color: tokens.color.error },
  timed_out: { icon: <Clock size={16} aria-hidden />, label: 'Not confirmed', color: tokens.color.warning },
  skipped: { icon: <MinusCircle size={16} aria-hidden />, label: 'Skipped', color: tokens.color.textSecondary },
};

export const SCENE_STATUS: Record<SceneExecutionDto['status'], { label: string; color: 'info' | 'success' | 'warning' | 'error' }> = {
  running: { label: 'Running', color: 'info' },
  succeeded: { label: 'Completed', color: 'success' },
  partial: { label: 'Partly completed', color: 'warning' },
  failed: { label: 'Failed', color: 'error' },
};

export function SceneStatusChip({ status }: { status: SceneExecutionDto['status'] | undefined }) {
  if (!status) return <Chip size="small" variant="outlined" label="Never run" />;
  const s = SCENE_STATUS[status];
  return <Chip size="small" color={s.color} label={s.label} />;
}

/** Honest overall summary: success only when every action was confirmed. */
export function ExecutionSummary({ execution }: { execution: SceneExecutionDto }) {
  const total = execution.results.length;
  const ok = execution.results.filter((r) => r.status === 'confirmed').length;
  const done = execution.results.filter((r) => r.status !== 'pending' && r.status !== 'sent').length;
  if (execution.status === 'running') {
    return (
      <Box>
        <Typography variant="body2" sx={{ mb: 0.5 }}>
          Running… {done} of {total} actions finished
        </Typography>
        <LinearProgress variant="determinate" value={total ? (done / total) * 100 : 0} aria-label="Scene progress" />
      </Box>
    );
  }
  if (execution.status === 'succeeded') return <Alert severity="success">All {total} actions confirmed.</Alert>;
  if (execution.status === 'partial') return <Alert severity="warning">Partly completed: {ok} of {total} actions confirmed. The rest did not reach the requested state.</Alert>;
  return <Alert severity="error">The scene failed: none of the {total} actions were confirmed.</Alert>;
}

export function ExecutionResults({ execution }: { execution: SceneExecutionDto }) {
  return (
    <Stack component="ul" spacing={1} sx={{ m: 0, p: 0, listStyle: 'none' }}>
      {execution.results.map((r) => {
        const m = RESULT_META[r.status];
        return (
          <Stack key={r.actionId} component="li" direction="row" spacing={1.25} alignItems="flex-start">
            <Box sx={{ color: m.color, pt: '2px' }}>{m.icon}</Box>
            <Box sx={{ minWidth: 0, flex: 1 }}>
              <Typography variant="body2" fontWeight={600}>
                {r.deviceName} · {r.description}
              </Typography>
              <Typography variant="caption" sx={{ color: m.color, fontWeight: 600 }}>
                {m.label}
              </Typography>
              {r.message && (
                <Typography variant="caption" component="p" color="text.secondary" sx={{ wordBreak: 'break-word' }}>
                  {r.message}
                </Typography>
              )}
            </Box>
          </Stack>
        );
      })}
    </Stack>
  );
}

/** Live view of one execution; WebSocket updates flow in through the store. */
export function SceneExecutionDialog({ executionId, sceneName, onClose }: { executionId: string | null; sceneName: string; onClose: () => void }) {
  const execution = useAppSelector((s) => (executionId ? s.live.sceneExecutions[executionId] : undefined));
  return (
    <Dialog open={!!executionId} onClose={onClose} maxWidth="sm" fullWidth aria-labelledby="scene-exec-title">
      <DialogTitle id="scene-exec-title" sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
        {sceneName}
        <SceneStatusChip status={execution?.status} />
      </DialogTitle>
      <DialogContent>
        {execution ? (
          <Stack spacing={2} aria-live="polite">
            <ExecutionSummary execution={execution} />
            <ExecutionResults execution={execution} />
          </Stack>
        ) : (
          <ListSkeleton rows={3} />
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button variant="contained" onClick={onClose}>
          {execution?.status === 'running' ? 'Run in background' : 'Close'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export function SceneHistoryDialog({ scene, onClose }: { scene: SceneDto | null; onClose: () => void }) {
  const { homeId } = useHome();
  const q = useSceneExecutionsQuery({ homeId, sceneId: scene?.id ?? '' }, { skip: !scene });
  const [open, setOpen] = useState<string | null>(null);
  return (
    <Dialog open={!!scene} onClose={onClose} maxWidth="sm" fullWidth aria-labelledby="scene-history-title">
      <DialogTitle id="scene-history-title">History · {scene?.name}</DialogTitle>
      <DialogContent>
        {q.isLoading ? (
          <ListSkeleton rows={4} />
        ) : !q.data?.executions.length ? (
          <Typography color="text.secondary">This scene has not been run yet.</Typography>
        ) : (
          <Stack divider={<Box sx={{ borderTop: `1px solid ${tokens.color.border}` }} />}>
            {q.data.executions.map((e) => {
              const ok = e.results.filter((r) => r.status === 'confirmed').length;
              return (
                <Box key={e.id} sx={{ py: 1 }}>
                  <Stack direction="row" spacing={1} alignItems="center">
                    <IconButton size="small" aria-expanded={open === e.id} aria-label="Show results" onClick={() => setOpen(open === e.id ? null : e.id)}>
                      {open === e.id ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                    </IconButton>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography variant="body2" fontWeight={600}>
                        {ok} of {e.results.length} confirmed · {e.source === 'automation' ? 'by automation' : 'by a user'}
                      </Typography>
                      <Typography variant="caption">
                        {timeAgo(e.startedAt)} · {formatDateTime(e.startedAt)}
                      </Typography>
                    </Box>
                    <SceneStatusChip status={e.status} />
                  </Stack>
                  <Collapse in={open === e.id} unmountOnExit>
                    <Box sx={{ pl: { xs: 1, sm: 5 }, pt: 1 }}>
                      <ExecutionResults execution={e} />
                    </Box>
                  </Collapse>
                </Box>
              );
            })}
          </Stack>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}

/** Activate a scene, confirming first when it contains security-sensitive actions. */
export function useActivateScene() {
  const { homeId } = useHome();
  const [activate] = useActivateSceneMutation();
  const confirm = useConfirm();
  const dispatch = useAppDispatch();
  const [running, setRunning] = useState<{ executionId: string; sceneName: string } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const askConfirm = (scene: Pick<SceneDto, 'name'>) =>
    confirm({
      title: `Run “${scene.name}”?`,
      message: 'This scene includes security-sensitive actions such as locking, unlocking or arming an alarm. Each action will be recorded in the audit log.',
      tone: 'security',
      confirmLabel: 'Run scene',
    });

  const run = async (scene: Pick<SceneDto, 'id' | 'name' | 'requiresConfirmation'>) => {
    let confirmed: boolean | undefined;
    if (scene.requiresConfirmation) {
      if (!(await askConfirm(scene))) return;
      confirmed = true;
    }
    setBusyId(scene.id);
    try {
      let r: { execution: SceneExecutionDto };
      try {
        r = await activate({ homeId, sceneId: scene.id, confirmed }).unwrap();
      } catch (e) {
        if (toApiError(e).code !== 'confirmation_required' || confirmed) throw e;
        if (!(await askConfirm(scene))) return;
        r = await activate({ homeId, sceneId: scene.id, confirmed: true }).unwrap();
      }
      dispatch(sceneExecutionUpdated(r.execution));
      setRunning({ executionId: r.execution.id, sceneName: scene.name });
    } catch (e) {
      dispatch(pushToast({ message: `${scene.name}: ${toApiError(e).message}`, severity: 'error' }));
    } finally {
      setBusyId(null);
    }
  };

  return { run, busyId, running, close: () => setRunning(null) };
}

import { Alert, Box, Button, Chip, Stack, Switch, FormControlLabel, Typography } from '@mui/material';
import { ArrowLeft, Copy, FlaskConical, Pencil, Play, ShieldAlert, Trash2 } from 'lucide-react';
import { Link as RouterLink, useNavigate, useParams } from 'react-router-dom';
import { describeTrigger } from '@smartnest/shared';
import { useAutomationExecutionsQuery, useAutomationQuery, useAutomationsQuery, useRoomsQuery, useScenesQuery } from '../../api/api';
import { formatDateTime, timeAgo, useHome } from '../../app/hooks';
import { DetailSkeleton, ErrorState, ListSkeleton, PageHeader, PermissionDenied, SectionCard } from '../../components/common/States';
import { OwnershipChip } from './AutomationsPage';
import { ExecutionHistory } from './ExecutionHistory';
import { RunResultDialog } from './RunResultDialog';
import { ExecStatusChip, describeAutomationAction, describeCondition, useAllDevices } from './shared';
import { useAutomationActions } from './useAutomationActions';

export default function AutomationDetailPage() {
  const { automationId = '' } = useParams();
  const { homeId, can } = useHome();
  const navigate = useNavigate();
  const q = useAutomationQuery({ homeId, automationId }, { skip: !can('automations.view') });
  const ex = useAutomationExecutionsQuery({ homeId, automationId }, { skip: !can('automations.view'), pollingInterval: 30_000 });
  const { byId } = useAllDevices(homeId);
  const scenes = useScenesQuery(homeId);
  const rooms = useRoomsQuery(homeId);
  const automations = useAutomationsQuery(homeId);
  const actions = useAutomationActions();

  if (!can('automations.view')) return <PermissionDenied />;
  if (q.isLoading) return <DetailSkeleton />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={q.refetch} title="Could not load this automation" />;

  const a = q.data.automation;
  const canManage = can('automations.manage');
  const own = a.executor === 'smartnest';
  const deviceName = (id: string) => byId.get(id)?.name ?? 'a removed device';
  const sceneName = (id: string) => scenes.data?.scenes.find((s) => s.id === id)?.name ?? 'a removed scene';
  const roomName = (id: string) => rooms.data?.rooms.find((r) => r.id === id)?.name ?? 'a removed room';
  const automationName = (id: string) => automations.data?.automations.find((x) => x.id === id)?.name ?? 'a removed automation';

  return (
    <Box>
      <Button component={RouterLink} to="/automations" startIcon={<ArrowLeft size={16} />} sx={{ mb: 1, ml: -1 }}>
        Automations
      </Button>
      <PageHeader
        title={a.name}
        subtitle={a.description || undefined}
        eyebrow={
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            <OwnershipChip executor={a.executor} />
            {a.isDraft && <Chip size="small" variant="outlined" label="Draft — never runs" />}
            {a.allowSensitiveActions && <Chip size="small" icon={<ShieldAlert size={13} />} label="Sensitive actions allowed" color="warning" variant="outlined" />}
          </Stack>
        }
        actions={
          canManage && (
            <>
              {own && (
                <Button variant="outlined" startIcon={<FlaskConical size={16} />} onClick={() => void actions.simulate(a)} disabled={!!actions.busy}>
                  Test
                </Button>
              )}
              <Button variant="outlined" startIcon={<Play size={16} />} onClick={() => void actions.run(a)} disabled={a.isDraft || !!actions.busy}>
                {own ? 'Run now' : 'Trigger in HA'}
              </Button>
              {own && (
                <Button variant="contained" startIcon={<Pencil size={16} />} component={RouterLink} to={`/automations/${a.id}/edit`}>
                  Edit
                </Button>
              )}
            </>
          )
        }
      />

      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', lg: '1.2fr 1fr' }, alignItems: 'start' }}>
        <Stack spacing={2} sx={{ minWidth: 0 }}>
          <SectionCard title="Status">
            <Stack spacing={1.5}>
              <FormControlLabel
                control={<Switch checked={a.enabled} disabled={!canManage || a.isDraft || !!actions.busy} onChange={(e) => void actions.toggle(a, e.target.checked)} />}
                label={a.enabled ? 'Enabled' : 'Disabled'}
              />
              <Stack direction="row" spacing={1} alignItems="center">
                <ExecStatusChip status={a.lastRunStatus} />
                <Typography variant="body2" color="text.secondary">
                  {a.lastRunAt ? `Last run ${timeAgo(a.lastRunAt)} (${formatDateTime(a.lastRunAt)})` : 'Has not run yet'}
                </Typography>
              </Stack>
              {own ? (
                <Typography variant="body2" color="text.secondary">
                  Evaluated by the SmartNest server. Cooldown: {a.cooldownSeconds}s between runs. Runs more than 20 times in 10 minutes are treated as a loop and the automation is disabled.
                </Typography>
              ) : (
                <Alert severity="info">This automation is executed by Home Assistant. Edit its triggers and actions in Home Assistant; run details are in Home Assistant's trace view.</Alert>
              )}
            </Stack>
          </SectionCard>

          {own && (
            <SectionCard title="How it works">
              <Stack spacing={2}>
                <Box>
                  <Typography variant="overline" color="text.secondary">When</Typography>
                  {a.triggers.map((t, i) => (
                    <Typography key={i} variant="body2">• {describeTrigger(t, deviceName)}</Typography>
                  ))}
                </Box>
                <Box>
                  <Typography variant="overline" color="text.secondary">Only if</Typography>
                  {a.conditions.length ? (
                    a.conditions.map((c, i) => (
                      <Typography key={i} variant="body2">
                        {i > 0 && <strong>{a.conditionOperator === 'and' ? 'and ' : 'or '}</strong>}
                        {describeCondition(c, deviceName, roomName)}
                      </Typography>
                    ))
                  ) : (
                    <Typography variant="body2" color="text.secondary">No conditions — runs whenever triggered.</Typography>
                  )}
                </Box>
                <Box>
                  <Typography variant="overline" color="text.secondary">Then</Typography>
                  <Box component="ol" sx={{ m: 0, pl: 2.5 }}>
                    {a.actions.map((x, i) => (
                      <li key={i}>
                        <Typography variant="body2">{describeAutomationAction(x, deviceName, sceneName, automationName)}</Typography>
                      </li>
                    ))}
                  </Box>
                </Box>
              </Stack>
            </SectionCard>
          )}

          {own && canManage && (
            <Stack direction="row" spacing={1}>
              <Button startIcon={<Copy size={16} />} onClick={() => void actions.duplicate(a)}>Duplicate</Button>
              <Button color="error" startIcon={<Trash2 size={16} />} onClick={() => void actions.remove(a, () => navigate('/automations'))}>
                Delete
              </Button>
            </Stack>
          )}
        </Stack>

        <SectionCard title="Execution history">
          {ex.isLoading ? <ListSkeleton rows={4} /> : ex.error ? <ErrorState error={ex.error} onRetry={ex.refetch} /> : <ExecutionHistory executions={ex.data?.executions ?? []} />}
        </SectionCard>
      </Box>

      <RunResultDialog result={actions.result} onClose={actions.closeResult} />
    </Box>
  );
}

import { useRef, useState } from 'react';
import {
  Alert, Box, Button, Card, Chip, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, ListItemIcon, Menu, MenuItem, Stack, Switch, Tooltip, Typography,
} from '@mui/material';
import { motion } from 'framer-motion';
import { Bot, Copy, Download, FlaskConical, Home as HomeIcon, MoreVertical, Pencil, Play, Plus, Server, Trash2, Upload } from 'lucide-react';
import { Link as RouterLink, useNavigate } from 'react-router-dom';
import { describeTrigger, type AutomationDto } from '@smartnest/shared';
import { toApiError, useAutomationsQuery, useExportAutomationsMutation, useImportAutomationsMutation } from '../../api/api';
import { timeAgo, useHome } from '../../app/hooks';
import { pushToast, useAppDispatch } from '../../app/store';
import { EmptyState, ErrorState, ListSkeleton, PageHeader, PermissionDenied, SectionCard } from '../../components/common/States';
import { tokens } from '../../theme/theme';
import { RunResultDialog } from './RunResultDialog';
import { ExecStatusChip, useAllDevices } from './shared';
import { useAutomationActions } from './useAutomationActions';

export function OwnershipChip({ executor }: { executor: AutomationDto['executor'] }) {
  return executor === 'smartnest' ? (
    <Chip size="small" icon={<Server size={13} />} label="Runs in SmartNest" sx={{ bgcolor: 'sage.main', color: 'primary.dark', '& .MuiChip-icon': { color: 'inherit' } }} />
  ) : (
    <Chip size="small" icon={<HomeIcon size={13} />} label="Runs in Home Assistant" sx={{ bgcolor: '#E3ECF1', color: '#2E5566', '& .MuiChip-icon': { color: 'inherit' } }} />
  );
}

function AutomationRow({ a, deviceName, actions, canManage }: { a: AutomationDto; deviceName: (id: string) => string; actions: ReturnType<typeof useAutomationActions>; canManage: boolean }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const navigate = useNavigate();
  const summary = a.executor === 'smartnest' ? a.triggers.map((t) => describeTrigger(t, deviceName)).join(' · ') : 'Logic is defined in Home Assistant';
  return (
    <motion.div layout initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.18 }}>
      <Stack direction="row" spacing={1.5} alignItems="center" sx={{ py: 1.5, borderBottom: `1px solid ${tokens.color.border}`, minWidth: 0 }}>
        <Box sx={{ width: 40, height: 40, borderRadius: '12px', display: 'grid', placeItems: 'center', bgcolor: a.enabled ? 'primary.main' : tokens.color.disabled, color: a.enabled ? '#fff' : 'text.secondary', flexShrink: 0 }} aria-hidden>
          <Bot size={20} />
        </Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
            <Typography component={RouterLink} to={`/automations/${a.id}`} fontWeight={700} sx={{ color: 'text.primary', textDecoration: 'none', '&:hover': { textDecoration: 'underline' } }}>
              {a.name}
            </Typography>
            {a.isDraft && <Chip size="small" label="Draft" variant="outlined" />}
          </Stack>
          <Typography variant="caption" component="p" noWrap title={summary}>
            {summary}
          </Typography>
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 0.5 }} flexWrap="wrap" useFlexGap>
            <ExecStatusChip status={a.lastRunStatus} />
            <Typography variant="caption">{a.lastRunAt ? `Last run ${timeAgo(a.lastRunAt)}` : 'Not run yet'}</Typography>
          </Stack>
        </Box>
        <Tooltip title={a.isDraft ? 'Drafts cannot be enabled' : canManage ? (a.enabled ? 'Disable' : 'Enable') : 'You do not have permission'}>
          <span>
            <Switch
              checked={a.enabled}
              disabled={!canManage || a.isDraft || actions.busy === `toggle:${a.id}`}
              onChange={(e) => void actions.toggle(a, e.target.checked)}
              inputProps={{ 'aria-label': `${a.name} ${a.enabled ? 'enabled' : 'disabled'}` }}
            />
          </span>
        </Tooltip>
        {canManage && (
          <>
            <IconButton aria-label={`More actions for ${a.name}`} aria-haspopup="menu" onClick={(e) => setAnchor(e.currentTarget)}>
              <MoreVertical size={18} />
            </IconButton>
            <Menu anchorEl={anchor} open={!!anchor} onClose={() => setAnchor(null)}>
              {a.executor === 'smartnest' && (
                <MenuItem onClick={() => navigate(`/automations/${a.id}/edit`)}>
                  <ListItemIcon><Pencil size={16} /></ListItemIcon>Edit
                </MenuItem>
              )}
              <MenuItem disabled={a.isDraft} onClick={() => { setAnchor(null); void actions.run(a); }}>
                <ListItemIcon><Play size={16} /></ListItemIcon>
                {a.executor === 'smartnest' ? 'Run now' : 'Trigger in Home Assistant'}
              </MenuItem>
              {a.executor === 'smartnest' && (
                <MenuItem onClick={() => { setAnchor(null); void actions.simulate(a); }}>
                  <ListItemIcon><FlaskConical size={16} /></ListItemIcon>Test (simulate)
                </MenuItem>
              )}
              {a.executor === 'smartnest' && (
                <MenuItem onClick={() => { setAnchor(null); void actions.duplicate(a); }}>
                  <ListItemIcon><Copy size={16} /></ListItemIcon>Duplicate
                </MenuItem>
              )}
              {a.executor === 'smartnest' && (
                <MenuItem sx={{ color: 'error.main' }} onClick={() => { setAnchor(null); void actions.remove(a); }}>
                  <ListItemIcon sx={{ color: 'inherit' }}><Trash2 size={16} /></ListItemIcon>Delete
                </MenuItem>
              )}
            </Menu>
          </>
        )}
      </Stack>
    </motion.div>
  );
}

export default function AutomationsPage() {
  const { homeId, can } = useHome();
  const q = useAutomationsQuery(homeId, { skip: !can('automations.view') });
  const { byId } = useAllDevices(homeId);
  const actions = useAutomationActions();
  const dispatch = useAppDispatch();
  const [exportAutomations, exportState] = useExportAutomationsMutation();
  const [importAutomations, importState] = useImportAutomationsMutation();
  const [importResults, setImportResults] = useState<{ name: string; ok: boolean; errors?: string[] }[] | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const canManage = can('automations.manage');

  if (!can('automations.view')) return <PermissionDenied />;
  const deviceName = (id: string) => byId.get(id)?.name ?? 'a removed device';
  const list = q.data?.automations ?? [];
  const own = list.filter((a) => a.executor === 'smartnest');
  const ha = list.filter((a) => a.executor === 'home_assistant');

  const doExport = async () => {
    try {
      const data = await exportAutomations(homeId).unwrap();
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = 'smartnest-automations.json';
      link.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      dispatch(pushToast({ message: toApiError(e).message, severity: 'error' }));
    }
  };

  const doImport = async (file: File) => {
    let data: unknown;
    try {
      data = JSON.parse(await file.text());
    } catch {
      dispatch(pushToast({ message: 'That file is not valid JSON.', severity: 'error' }));
      return;
    }
    if ((data as { format?: string })?.format !== 'smartnest.automations.v1') {
      dispatch(pushToast({ message: 'Unsupported file. Expected a SmartNest automation export (smartnest.automations.v1).', severity: 'error' }));
      return;
    }
    try {
      const r = await importAutomations({ homeId, data }).unwrap();
      setImportResults(r.results);
    } catch (e) {
      dispatch(pushToast({ message: toApiError(e).message, severity: 'error' }));
    }
  };

  return (
    <Box>
      <PageHeader
        title="Automations"
        subtitle="Rules that react to time, devices and events. Each automation runs in exactly one place."
        actions={
          <>
            <Button variant="outlined" startIcon={<Download size={16} />} onClick={() => void doExport()} disabled={exportState.isLoading || !own.length}>
              Export
            </Button>
            {canManage && (
              <>
                <Button variant="outlined" startIcon={<Upload size={16} />} onClick={() => fileRef.current?.click()} disabled={importState.isLoading}>
                  Import
                </Button>
                <input
                  ref={fileRef}
                  type="file"
                  accept="application/json,.json"
                  hidden
                  aria-label="Import automations file"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = '';
                    if (f) void doImport(f);
                  }}
                />
                <Button variant="contained" startIcon={<Plus size={16} />} component={RouterLink} to="/automations/new">
                  New automation
                </Button>
              </>
            )}
          </>
        }
      />

      {q.isLoading ? (
        <Card sx={{ p: 2 }}><ListSkeleton rows={5} height={72} /></Card>
      ) : q.error ? (
        <ErrorState error={q.error} onRetry={q.refetch} title="Could not load automations" />
      ) : !list.length ? (
        <EmptyState
          icon={<Bot size={24} />}
          title="No automations yet"
          description="Automations turn things on at sunset, alert you when CO₂ is high, or switch lights off when everyone leaves. Home Assistant automations appear here automatically once connected."
          action={canManage && <Button variant="contained" startIcon={<Plus size={16} />} component={RouterLink} to="/automations/new">Create an automation</Button>}
        />
      ) : (
        <Stack spacing={2.5}>
          <Alert severity="info" icon={<Server size={18} />}>
            <strong>Execution ownership:</strong> “Runs in SmartNest” rules are evaluated by the SmartNest server. “Runs in Home Assistant” rules are executed by Home Assistant — SmartNest can only enable, disable or trigger them, so no rule runs twice.
          </Alert>
          <SectionCard title={<Stack direction="row" spacing={1} alignItems="center"><Typography variant="h4" component="h2">SmartNest automations</Typography><OwnershipChip executor="smartnest" /></Stack>}>
            {own.length ? (
              own.map((a) => <AutomationRow key={a.id} a={a} deviceName={deviceName} actions={actions} canManage={canManage} />)
            ) : (
              <Typography color="text.secondary">None yet.</Typography>
            )}
          </SectionCard>
          {ha.length > 0 && (
            <SectionCard title={<Stack direction="row" spacing={1} alignItems="center"><Typography variant="h4" component="h2">Home Assistant automations</Typography><OwnershipChip executor="home_assistant" /></Stack>}>
              {ha.map((a) => <AutomationRow key={a.id} a={a} deviceName={deviceName} actions={actions} canManage={canManage} />)}
            </SectionCard>
          )}
        </Stack>
      )}

      <RunResultDialog result={actions.result} onClose={actions.closeResult} />

      <Dialog open={!!importResults} onClose={() => setImportResults(null)} maxWidth="sm" fullWidth aria-labelledby="import-title">
        <DialogTitle id="import-title">Import results</DialogTitle>
        <DialogContent>
          <Alert severity="info" sx={{ mb: 2 }}>Imported automations are saved disabled. Review them before enabling. Items with problems were saved as drafts.</Alert>
          <Stack spacing={1}>
            {importResults?.map((r, i) => (
              <Box key={i}>
                <Stack direction="row" spacing={1} alignItems="center">
                  <Chip size="small" color={r.ok ? 'success' : 'warning'} label={r.ok ? 'Imported' : 'Needs attention'} />
                  <Typography fontWeight={600}>{r.name}</Typography>
                </Stack>
                {r.errors?.map((e, j) => (
                  <Typography key={j} variant="caption" component="p" sx={{ color: 'warning.dark', ml: 1 }}>
                    {e}
                  </Typography>
                ))}
              </Box>
            ))}
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button variant="contained" onClick={() => setImportResults(null)}>Done</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

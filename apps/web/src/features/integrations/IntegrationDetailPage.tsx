import { useState } from 'react';
import {
  Alert, Box, Button, Card, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, Stack, TextField, Typography,
} from '@mui/material';
import { Activity, ArrowLeft, Bot, PlugZap, Radar, RefreshCw, Trash2 } from 'lucide-react';
import { Link as RouterLink, useNavigate, useParams } from 'react-router-dom';
import { CATEGORY_INFO } from '@smartnest/shared';
import {
  toApiError, useDevicesQuery, useDiscoveredQuery, useDisconnectIntegrationMutation, useIntegrationHealthMutation, useIntegrationQuery,
  useReconnectIntegrationMutation, useRemoveIntegrationMutation, useSyncAutomationsMutation,
} from '../../api/api';
import { formatDateTime, timeAgo, useHome } from '../../app/hooks';
import { pushToast, useAppDispatch } from '../../app/store';
import { useConfirm } from '../../components/common/Dialogs';
import { DetailSkeleton, EmptyState, ErrorState, ListSkeleton, PageHeader, SectionCard } from '../../components/common/States';
import { ConnectivityBadge, DemoBadge } from '../../components/common/StatusBadge';
import { DeviceRow } from '../../components/devices/DeviceCard';
import { tokens } from '../../theme/theme';
import { IntegrationStatusChip, prettyCapability } from './components';
import { SupportChip } from './IntegrationsPage';

export default function IntegrationDetailPage() {
  const { integrationId = '' } = useParams();
  const { homeId, can } = useHome();
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const confirm = useConfirm();
  const q = useIntegrationQuery({ homeId, integrationId });
  const devices = useDevicesQuery({ homeId, integrationId, pageSize: 100, includeHidden: 'true' });
  const discovered = useDiscoveredQuery({ homeId, integrationId });
  const [health, healthState] = useIntegrationHealthMutation();
  const [reconnect, reconnectState] = useReconnectIntegrationMutation();
  const [disconnect, disconnectState] = useDisconnectIntegrationMutation();
  const [remove, removeState] = useRemoveIntegrationMutation();
  const [syncAutomations, syncState] = useSyncAutomationsMutation();
  const [healthResult, setHealthResult] = useState<{ ok: boolean; message?: string } | null>(null);
  const [tokenDialog, setTokenDialog] = useState(false);
  const [newToken, setNewToken] = useState('');
  const [tokenError, setTokenError] = useState<string | null>(null);

  if (q.isLoading) return <DetailSkeleton />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={q.refetch} title="Could not load this integration" />;
  const { integration: i, definition: def } = q.data;
  const manage = can('integrations.manage');
  const isHa = i.type === 'home_assistant';
  const notImported = discovered.data?.discovered.filter((d) => !d.alreadyImported) ?? [];

  const toast = (message: string, severity: 'success' | 'error' | 'info' = 'success') => dispatch(pushToast({ message, severity }));

  const doReconnect = async () => {
    if (isHa && i.status !== 'connected') {
      setNewToken('');
      setTokenError(null);
      setTokenDialog(true);
      return;
    }
    try {
      await reconnect({ homeId, integrationId }).unwrap();
      toast(`${i.name} reconnected`);
    } catch (e) {
      toast(toApiError(e).message, 'error');
    }
  };

  return (
    <>
      <PageHeader
        eyebrow={
          <Button component={RouterLink} to="/integrations" size="small" startIcon={<ArrowLeft size={14} />} sx={{ ml: -1 }}>
            Integrations
          </Button>
        }
        title={i.name}
        subtitle={
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap component="span">
            <IntegrationStatusChip status={i.status} />
            <SupportChip level={i.supportLevel} />
            {i.isDemo && <DemoBadge />}
            <Typography component="span" variant="body2" color="text.secondary">
              {def.name}
              {i.baseUrl ? ` · ${i.baseUrl}` : ''}
            </Typography>
          </Stack>
        }
        actions={
          <>
            <Button
              variant="outlined"
              startIcon={healthState.isLoading ? <CircularProgress size={14} /> : <Activity size={16} />}
              disabled={healthState.isLoading}
              onClick={async () => setHealthResult(await health({ homeId, integrationId }).unwrap().catch((e) => ({ ok: false, message: toApiError(e).message })))}
            >
              Health check
            </Button>
            {manage && i.status !== 'disconnected' && (
              <Button variant="contained" component={RouterLink} to={`/integrations/add?integrationId=${i.id}`} startIcon={<Radar size={16} />}>
                Discover devices
              </Button>
            )}
          </>
        }
      />

      <Stack spacing={2.5}>
        {i.statusMessage && i.status !== 'connected' && (
          <Alert severity={i.status === 'connecting' ? 'info' : i.status === 'disconnected' ? 'warning' : 'error'}>{i.statusMessage}</Alert>
        )}
        {healthResult && (
          <Alert severity={healthResult.ok ? 'success' : 'warning'} onClose={() => setHealthResult(null)} role="status">
            {healthResult.ok ? 'Health check passed: the integration is reachable and its event stream is connected.' : `Health check failed: ${healthResult.message ?? 'unknown problem'}`}
          </Alert>
        )}

        <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr 1fr', md: 'repeat(4, 1fr)' } }}>
          {[
            { label: 'Imported devices', value: i.deviceCount },
            { label: 'Discovered, not imported', value: i.discoveredNotImported },
            { label: 'Last successful sync', value: timeAgo(i.lastSyncAt), title: formatDateTime(i.lastSyncAt) },
            { label: 'Last connected', value: timeAgo(i.lastConnectedAt), title: formatDateTime(i.lastConnectedAt) },
          ].map((s) => (
            <Card key={s.label} sx={{ p: 2 }} title={s.title}>
              <Typography variant="caption">{s.label}</Typography>
              <Typography variant="h3" component="p" sx={{ mt: 0.5 }}>
                {s.value}
              </Typography>
            </Card>
          ))}
        </Box>

        {manage && (
          <SectionCard title="Manage connection">
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} flexWrap="wrap" useFlexGap>
              <Button variant="outlined" startIcon={reconnectState.isLoading ? <CircularProgress size={14} /> : <RefreshCw size={16} />} disabled={reconnectState.isLoading} onClick={() => void doReconnect()}>
                Reconnect
              </Button>
              {isHa && i.status === 'connected' && (
                <Button
                  variant="outlined"
                  startIcon={syncState.isLoading ? <CircularProgress size={14} /> : <Bot size={16} />}
                  disabled={syncState.isLoading}
                  onClick={async () => {
                    try {
                      const r = await syncAutomations({ homeId, integrationId }).unwrap();
                      toast(`${r.count} Home Assistant automation${r.count === 1 ? '' : 's'} synced`);
                    } catch (e) {
                      toast(toApiError(e).message, 'error');
                    }
                  }}
                >
                  Sync automations
                </Button>
              )}
              {i.status !== 'disconnected' && (
                <Button
                  variant="outlined"
                  color="warning"
                  startIcon={<PlugZap size={16} />}
                  disabled={disconnectState.isLoading}
                  onClick={async () => {
                    const ok = await confirm({
                      title: `Disconnect ${i.name}?`,
                      tone: 'danger',
                      confirmLabel: 'Disconnect',
                      message: (
                        <Box component="ul" sx={{ pl: 2, m: 0 }}>
                          <li>SmartNest stops syncing and controlling these devices.</li>
                          <li>Stored credentials for this integration are deleted{isHa ? ' — you will need a new access token to reconnect' : ''}.</li>
                          <li>Device records, rooms and history are kept and shown as “Integration disconnected”.</li>
                          {isHa && <li>Home Assistant automations are disabled in SmartNest (they keep running in Home Assistant).</li>}
                        </Box>
                      ),
                    });
                    if (!ok) return;
                    try {
                      await disconnect({ homeId, integrationId }).unwrap();
                      toast(`${i.name} disconnected`, 'info');
                    } catch (e) {
                      toast(toApiError(e).message, 'error');
                    }
                  }}
                >
                  Disconnect
                </Button>
              )}
              <Button
                variant="outlined"
                color="error"
                startIcon={<Trash2 size={16} />}
                disabled={removeState.isLoading}
                onClick={async () => {
                  const ok = await confirm({
                    title: `Remove ${i.name} from SmartNest?`,
                    tone: 'danger',
                    confirmLabel: 'Remove integration',
                    typeToConfirm: i.name,
                    message: `This removes the integration, its ${i.deviceCount} imported device${i.deviceCount === 1 ? '' : 's'}, any scene actions that use them${isHa ? ' and its Home Assistant automation records' : ''} from SmartNest only. Nothing is deleted in ${def.name} or on the devices themselves.`,
                  });
                  if (!ok) return;
                  try {
                    await remove({ homeId, integrationId }).unwrap();
                    toast(`${i.name} removed`, 'info');
                    navigate('/integrations');
                  } catch (e) {
                    toast(toApiError(e).message, 'error');
                  }
                }}
              >
                Remove integration
              </Button>
            </Stack>
          </SectionCard>
        )}

        <Box sx={{ display: 'grid', gap: 2.5, gridTemplateColumns: { xs: '1fr', lg: '2fr 1fr' }, alignItems: 'start' }}>
          <SectionCard title={`Imported devices (${devices.data?.total ?? i.deviceCount})`}>
            {devices.isLoading ? (
              <ListSkeleton rows={4} />
            ) : devices.error ? (
              <ErrorState error={devices.error} onRetry={devices.refetch} />
            ) : !devices.data?.items.length ? (
              <EmptyState
                title="No devices imported yet"
                description="Run discovery to see what this integration reports and choose which devices to import."
                action={
                  manage &&
                  i.status !== 'disconnected' && (
                    <Button variant="contained" component={RouterLink} to={`/integrations/add?integrationId=${i.id}`}>
                      Discover devices
                    </Button>
                  )
                }
              />
            ) : (
              <Box sx={{ mx: -1 }}>
                {devices.data.items.map((d) => (
                  <DeviceRow key={d.id} device={d} />
                ))}
                {devices.data.total > devices.data.items.length && (
                  <Button component={RouterLink} to={`/devices?integrationId=${i.id}`} sx={{ mt: 1 }}>
                    View all {devices.data.total} devices
                  </Button>
                )}
              </Box>
            )}
          </SectionCard>

          <Stack spacing={2.5}>
            <SectionCard title="Discovered, not imported">
              {discovered.isLoading ? (
                <ListSkeleton rows={3} height={40} />
              ) : !notImported.length ? (
                <Typography variant="body2" color="text.secondary">
                  {discovered.data?.discovered.length ? 'Every discovered device has been imported.' : 'Discovery has not been run yet.'}
                </Typography>
              ) : (
                <Stack spacing={1}>
                  {notImported.slice(0, 12).map((d) => (
                    <Stack key={d.externalId} direction="row" spacing={1} alignItems="center" justifyContent="space-between">
                      <Box sx={{ minWidth: 0 }}>
                        <Typography variant="body2" fontWeight={600} noWrap>
                          {d.name}
                        </Typography>
                        <Typography variant="caption" noWrap component="p">
                          {CATEGORY_INFO[d.category]?.label ?? d.category}
                        </Typography>
                      </Box>
                      <ConnectivityBadge state={d.connectivity} />
                    </Stack>
                  ))}
                  {notImported.length > 12 && <Typography variant="caption">and {notImported.length - 12} more…</Typography>}
                  {manage && (
                    <Button size="small" component={RouterLink} to={`/integrations/add?integrationId=${i.id}`} sx={{ alignSelf: 'flex-start' }}>
                      Review and import
                    </Button>
                  )}
                </Stack>
              )}
            </SectionCard>

            <SectionCard title="What this integration supports">
              <Typography variant="overline" color="text.secondary">
                Capabilities
              </Typography>
              <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap sx={{ mb: 2 }}>
                {def.supportedCapabilities.map((c) => (
                  <Chip key={c} size="small" variant="outlined" label={prettyCapability(c)} />
                ))}
              </Stack>
              <Typography variant="overline" color="text.secondary">
                Limitations
              </Typography>
              <Box component="ul" sx={{ pl: 2.5, m: 0, color: 'text.secondary', '& li': { mb: 0.5, fontSize: '0.875rem' } }}>
                {def.limitations.map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </Box>
            </SectionCard>
          </Stack>
        </Box>
      </Stack>

      <Dialog open={tokenDialog} onClose={() => setTokenDialog(false)} maxWidth="xs" fullWidth aria-labelledby="reconnect-title">
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setTokenError(null);
            try {
              await reconnect({ homeId, integrationId, accessToken: newToken.trim() }).unwrap();
              setTokenDialog(false);
              toast(`${i.name} reconnected with the new token`);
            } catch (err) {
              const a = toApiError(err);
              setTokenError(a.status === 401 ? 'Home Assistant rejected this token.' : a.message);
            }
          }}
        >
          <DialogTitle id="reconnect-title">Reconnect Home Assistant</DialogTitle>
          <DialogContent>
            <Typography color="text.secondary" variant="body2" sx={{ mb: 2 }}>
              Create a new long-lived access token in your Home Assistant profile and paste it here. It is verified before being saved and is encrypted at rest.
            </Typography>
            <TextField
              autoFocus
              type="password"
              label="New long-lived access token"
              autoComplete="off"
              value={newToken}
              onChange={(e) => setNewToken(e.target.value)}
              error={!!tokenError}
              helperText={tokenError ?? ' '}
            />
          </DialogContent>
          <DialogActions sx={{ px: 3, pb: 2.5 }}>
            <Button onClick={() => setTokenDialog(false)}>Cancel</Button>
            <Button type="submit" variant="contained" disabled={newToken.trim().length < 20 || reconnectState.isLoading}>
              {reconnectState.isLoading ? 'Verifying…' : 'Reconnect'}
            </Button>
          </DialogActions>
        </form>
      </Dialog>
      <Box sx={{ height: tokens.radius.sm }} />
    </>
  );
}

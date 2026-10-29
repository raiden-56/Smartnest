import { useEffect, useState } from 'react';
import { Alert, Box, Button, Checkbox, Chip, FormControlLabel, FormGroup, IconButton, InputAdornment, List, ListItem, ListItemText, MenuItem, Stack, Table, TableBody, TableCell, TableHead, TableRow, TextField, Tooltip, Typography } from '@mui/material';
import { Copy, Crosshair, Trash2, UserPlus } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { ROLE_DESCRIPTIONS, ROLE_LABELS, canManageRole, type HomeRole } from '@smartnest/shared';
import {
  api, toApiError, useAuditQuery, useDeleteHomeDataMutation, useDeleteHomeMutation, useInvitationsQuery, useInviteMutation, useMeQuery, useMembersQuery, useRemoveMemberMutation,
  useRevokeInvitationMutation, useUpdateHomeMutation, useUpdateMemberMutation,
} from '../../api/api';
import { formatDateTime, useHome } from '../../app/hooks';
import { pushToast, resetLive, setCurrentHome, useAppDispatch } from '../../app/store';
import { useConfirm, useReauth } from '../../components/common/Dialogs';
import { ListSkeleton, PermissionDenied, SectionCard } from '../../components/common/States';

const TIMEZONES: string[] = (() => {
  try {
    return (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone') ?? ['UTC', 'Europe/London', 'Asia/Kolkata', 'America/New_York'];
  } catch {
    return ['UTC'];
  }
})();

export function HomeTab() {
  const { homeId, home, can } = useHome();
  const [update, u] = useUpdateHomeMutation();
  const dispatch = useAppDispatch();
  const [f, setF] = useState({ name: '', timezone: '', locale: '', temperatureUnit: 'C' as 'C' | 'F', latitude: '', longitude: '', currency: '', tariffPerKWh: '' });
  useEffect(() => {
    setF({
      name: home.name, timezone: home.timezone, locale: home.locale, temperatureUnit: home.temperatureUnit,
      latitude: home.latitude?.toString() ?? '', longitude: home.longitude?.toString() ?? '', currency: home.currency ?? '', tariffPerKWh: home.tariffPerKWh?.toString() ?? '',
    });
  }, [home]);
  const editable = can('home.manage');
  const num = (s: string) => (s.trim() === '' ? null : Number(s));
  const save = async () => {
    try {
      await update({
        homeId, name: f.name, timezone: f.timezone, locale: f.locale, temperatureUnit: f.temperatureUnit,
        latitude: num(f.latitude), longitude: num(f.longitude), currency: f.currency ? f.currency.toUpperCase() : null, tariffPerKWh: num(f.tariffPerKWh),
      }).unwrap();
      dispatch(pushToast({ message: 'Home settings saved', severity: 'success' }));
    } catch (e) {
      dispatch(pushToast({ message: toApiError(e).message, severity: 'error' }));
    }
  };
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF((x) => ({ ...x, [k]: e.target.value }));
  return (
    <SectionCard title="Home">
      {!editable && <Alert severity="info" sx={{ mb: 2 }}>Only owners and administrators can change home settings.</Alert>}
      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, maxWidth: 760 }}>
        <TextField label="Home name" value={f.name} onChange={set('name')} disabled={!editable} />
        <TextField select label="Timezone" value={f.timezone} onChange={set('timezone')} disabled={!editable} SelectProps={{ MenuProps: { PaperProps: { sx: { maxHeight: 360 } } } }}>
          {TIMEZONES.map((t) => (
            <MenuItem key={t} value={t}>
              {t}
            </MenuItem>
          ))}
        </TextField>
        <TextField select label="Locale" value={f.locale} onChange={set('locale')} disabled={!editable}>
          {['en-GB', 'en-US', 'en-IN', 'de-DE', 'fr-FR', 'es-ES', 'nl-NL', 'sv-SE'].map((l) => (
            <MenuItem key={l} value={l}>
              {l}
            </MenuItem>
          ))}
        </TextField>
        <TextField select label="Temperature unit" value={f.temperatureUnit} onChange={set('temperatureUnit')} disabled={!editable}>
          <MenuItem value="C">Celsius (°C)</MenuItem>
          <MenuItem value="F">Fahrenheit (°F)</MenuItem>
        </TextField>
        <TextField label="Latitude" value={f.latitude} onChange={set('latitude')} disabled={!editable} inputProps={{ inputMode: 'decimal' }} helperText="Needed for sunrise/sunset automations." />
        <TextField
          label="Longitude"
          value={f.longitude}
          onChange={set('longitude')}
          disabled={!editable}
          inputProps={{ inputMode: 'decimal' }}
          InputProps={{
            endAdornment: editable && 'geolocation' in navigator && (
              <InputAdornment position="end">
                <Tooltip title="Use this device's location">
                  <IconButton
                    aria-label="Use this device's location"
                    onClick={() =>
                      navigator.geolocation.getCurrentPosition(
                        (p) => setF((x) => ({ ...x, latitude: p.coords.latitude.toFixed(4), longitude: p.coords.longitude.toFixed(4) })),
                        () => dispatch(pushToast({ message: 'Location permission was denied', severity: 'warning' })),
                      )
                    }
                  >
                    <Crosshair size={16} />
                  </IconButton>
                </Tooltip>
              </InputAdornment>
            ),
          }}
        />
        <TextField label="Currency (ISO code)" value={f.currency} onChange={set('currency')} disabled={!editable} inputProps={{ maxLength: 3 }} placeholder="GBP" />
        <TextField label="Electricity tariff per kWh" value={f.tariffPerKWh} onChange={set('tariffPerKWh')} disabled={!editable} inputProps={{ inputMode: 'decimal' }} helperText="Energy cost estimates are shown only when this is set." />
      </Box>
      {editable && (
        <Button variant="contained" sx={{ mt: 2.5 }} onClick={() => void save()} disabled={u.isLoading || !f.name.trim()}>
          Save home settings
        </Button>
      )}
    </SectionCard>
  );
}

export function MembersTab() {
  const { homeId, home, can } = useHome();
  const me = useMeQuery();
  const members = useMembersQuery(homeId, { skip: !can('members.view') });
  const invitations = useInvitationsQuery(homeId, { skip: !can('members.manage') });
  const [invite, inv] = useInviteMutation();
  const [revokeInvite] = useRevokeInvitationMutation();
  const [updateMember] = useUpdateMemberMutation();
  const [removeMember] = useRemoveMemberMutation();
  const confirm = useConfirm();
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Exclude<HomeRole, 'owner'>>('member');
  const [lastLink, setLastLink] = useState<string | null>(null);
  if (!can('members.view')) return <PermissionDenied />;

  const assignable = (['admin', 'member', 'guest'] as const).filter((r) => canManageRole(home.role, r));
  return (
    <Stack spacing={2.5}>
      <SectionCard title="Members">
        {members.isLoading ? (
          <ListSkeleton rows={3} />
        ) : (
          <List disablePadding>
            {members.data?.members.map((m) => {
              const self = m.userId === me.data?.user.id;
              const manageable = !self && can('members.manage') && canManageRole(home.role, m.role, m.role);
              return (
                <ListItem key={m.id} divider disableGutters sx={{ flexWrap: 'wrap', gap: 1 }}>
                  <ListItemText primary={`${m.name}${self ? ' (you)' : ''}`} secondary={`${m.email} · joined ${formatDateTime(m.joinedAt)}`} sx={{ minWidth: 200 }} />
                  {manageable ? (
                    <TextField
                      select
                      size="small"
                      value={m.role}
                      sx={{ width: 190 }}
                      inputProps={{ 'aria-label': `Role for ${m.name}` }}
                      onChange={async (e) => {
                        try {
                          await updateMember({ homeId, memberId: m.id, role: e.target.value as HomeRole }).unwrap();
                          dispatch(pushToast({ message: `${m.name} is now ${ROLE_LABELS[e.target.value as HomeRole]}`, severity: 'success' }));
                        } catch (err) {
                          dispatch(pushToast({ message: toApiError(err).message, severity: 'error' }));
                        }
                      }}
                    >
                      {(home.role === 'owner' ? (['owner', 'admin', 'member', 'guest'] as const) : assignable).map((r) => (
                        <MenuItem key={r} value={r}>
                          {ROLE_LABELS[r]}
                        </MenuItem>
                      ))}
                    </TextField>
                  ) : (
                    <Chip label={ROLE_LABELS[m.role]} variant="outlined" />
                  )}
                  {(manageable || self) && (
                    <Tooltip title={self ? 'Leave this home' : `Remove ${m.name}`}>
                      <IconButton
                        aria-label={self ? 'Leave this home' : `Remove ${m.name}`}
                        onClick={async () => {
                          const ok = await confirm({ title: self ? `Leave ${home.name}?` : `Remove ${m.name}?`, message: self ? 'You will lose access to this home.' : `${m.name} will immediately lose access to ${home.name}.`, tone: 'danger', confirmLabel: self ? 'Leave' : 'Remove' });
                          if (!ok) return;
                          try {
                            await removeMember({ homeId, memberId: m.id }).unwrap();
                            if (self) {
                              dispatch(resetLive());
                              dispatch(setCurrentHome(null));
                              dispatch(api.util.resetApiState());
                              navigate('/');
                            }
                          } catch (err) {
                            dispatch(pushToast({ message: toApiError(err).message, severity: 'error' }));
                          }
                        }}
                      >
                        <Trash2 size={16} />
                      </IconButton>
                    </Tooltip>
                  )}
                </ListItem>
              );
            })}
          </List>
        )}
      </SectionCard>

      {can('members.manage') && (
        <SectionCard title="Invite someone">
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} alignItems={{ md: 'flex-start' }}>
            <TextField label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} sx={{ maxWidth: 360 }} />
            <TextField select label="Role" value={role} onChange={(e) => setRole(e.target.value as typeof role)} sx={{ width: 220 }} helperText={ROLE_DESCRIPTIONS[role]}>
              {assignable.map((r) => (
                <MenuItem key={r} value={r}>
                  {ROLE_LABELS[r]}
                </MenuItem>
              ))}
            </TextField>
            <Button
              variant="contained"
              startIcon={<UserPlus size={16} />}
              disabled={!email.includes('@') || inv.isLoading}
              sx={{ mt: { md: 1 } }}
              onClick={async () => {
                try {
                  const r = await invite({ homeId, email, role }).unwrap();
                  setLastLink(r.invitation.inviteUrl ?? null);
                  setEmail('');
                } catch (e) {
                  dispatch(pushToast({ message: toApiError(e).message, severity: 'error' }));
                }
              }}
            >
              Create invitation
            </Button>
          </Stack>
          {lastLink && (
            <Alert severity="success" sx={{ mt: 2 }} action={<Button color="inherit" size="small" startIcon={<Copy size={14} />} onClick={() => void navigator.clipboard?.writeText(lastLink).then(() => dispatch(pushToast({ message: 'Link copied', severity: 'success' })))}>Copy</Button>}>
              Share this one-time link privately — it's shown only once and expires in 7 days. No email service is configured, so SmartNest doesn't send it for you.
              <Box component="code" sx={{ display: 'block', mt: 1, wordBreak: 'break-all', fontSize: '0.8rem' }}>
                {lastLink}
              </Box>
            </Alert>
          )}
          {invitations.data && invitations.data.invitations.length > 0 && (
            <>
              <Typography variant="overline" color="text.secondary" component="p" sx={{ mt: 2.5 }}>
                Pending invitations
              </Typography>
              <List dense disablePadding>
                {invitations.data.invitations.map((i) => (
                  <ListItem key={i.id} disableGutters divider secondaryAction={<Button size="small" color="error" onClick={() => void revokeInvite({ homeId, inviteId: i.id })}>Revoke</Button>}>
                    <ListItemText primary={i.email} secondary={`${ROLE_LABELS[i.role]} · expires ${formatDateTime(i.expiresAt)}`} />
                  </ListItem>
                ))}
              </List>
            </>
          )}
        </SectionCard>
      )}
    </Stack>
  );
}

export function PrivacyTab() {
  const { homeId, home, can } = useHome();
  const [update] = useUpdateHomeMutation();
  const [deleteData, dd] = useDeleteHomeDataMutation();
  const [deleteHome] = useDeleteHomeMutation();
  const confirm = useConfirm();
  const reauth = useReauth();
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const [ret, setRet] = useState(home.retentionDays);
  const [scope, setScope] = useState({ activity: true, history: true, energy: false, commands: true, notifications: true });
  useEffect(() => setRet(home.retentionDays), [home.retentionDays]);

  const withReauth = async <T,>(fn: () => Promise<T>): Promise<T | null> => {
    try {
      return await fn();
    } catch (e) {
      if (toApiError(e).code !== 'reauth_required') throw e;
      if (!(await reauth())) return null;
      return fn();
    }
  };

  return (
    <Stack spacing={2.5}>
      <SectionCard title="Data retention">
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          SmartNest keeps only what it needs. Older records are deleted automatically by an hourly cleanup job. Energy data is aggregated hourly and kept for 400 days.
        </Typography>
        <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, 1fr)' }, maxWidth: 760 }}>
          <TextField type="number" label="Activity history (days)" value={ret.activity} disabled={!can('home.manage')} onChange={(e) => setRet({ ...ret, activity: Number(e.target.value) })} inputProps={{ min: 7, max: 730 }} />
          <TextField type="number" label="Device state history (days)" value={ret.stateSnapshots} disabled={!can('home.manage')} onChange={(e) => setRet({ ...ret, stateSnapshots: Number(e.target.value) })} inputProps={{ min: 1, max: 90 }} />
          <TextField type="number" label="Camera events (days)" value={ret.cameraEvents} disabled={!can('home.manage')} onChange={(e) => setRet({ ...ret, cameraEvents: Number(e.target.value) })} inputProps={{ min: 1, max: 365 }} />
        </Box>
        {can('home.manage') && (
          <Button
            variant="outlined"
            sx={{ mt: 2 }}
            onClick={async () => {
              try {
                await update({ homeId, retentionDays: ret }).unwrap();
                dispatch(pushToast({ message: 'Retention settings saved', severity: 'success' }));
              } catch (e) {
                dispatch(pushToast({ message: toApiError(e).message, severity: 'error' }));
              }
            }}
          >
            Save retention
          </Button>
        )}
      </SectionCard>

      {can('data.delete') && (
        <SectionCard title="Delete stored data">
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            Permanently delete history SmartNest has stored for this home. Rooms, devices, scenes, automations and integrations are kept. To stop collecting data from an integration, disconnect it on the Integrations page.
          </Typography>
          <FormGroup row>
            {(
              [
                ['activity', 'Activity timeline'],
                ['history', 'Device state history'],
                ['energy', 'Energy history'],
                ['commands', 'Command, scene and automation run history'],
                ['notifications', 'Notifications'],
              ] as const
            ).map(([k, label]) => (
              <FormControlLabel key={k} control={<Checkbox checked={scope[k]} onChange={(e) => setScope({ ...scope, [k]: e.target.checked })} />} label={label} />
            ))}
          </FormGroup>
          <Button
            color="error"
            variant="outlined"
            sx={{ mt: 1.5 }}
            disabled={dd.isLoading || !Object.values(scope).some(Boolean)}
            onClick={async () => {
              const ok = await confirm({ title: 'Delete stored data?', message: 'This cannot be undone.', tone: 'danger', confirmLabel: 'Delete data' });
              if (!ok) return;
              try {
                const r = await withReauth(() => deleteData({ homeId, ...scope }).unwrap());
                if (r) dispatch(pushToast({ message: `Deleted ${Object.values(r.deleted).reduce((a, b) => a + b, 0)} records`, severity: 'success' }));
              } catch (e) {
                dispatch(pushToast({ message: toApiError(e).message, severity: 'error' }));
              }
            }}
          >
            Delete selected data
          </Button>
        </SectionCard>
      )}

      {can('home.delete') && (
        <SectionCard title="Delete home" sx={{ borderColor: 'error.light' }}>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
            Deletes {home.name}, all its rooms, devices, scenes, automations, history and stored integration credentials. Members lose access. Physical devices and your Home Assistant installation are not changed.
          </Typography>
          <Button
            color="error"
            variant="contained"
            startIcon={<Trash2 size={16} />}
            onClick={async () => {
              const ok = await confirm({ title: `Delete ${home.name}?`, message: 'This permanently deletes the home and everything in it.', tone: 'danger', confirmLabel: 'Delete home', typeToConfirm: home.name });
              if (!ok) return;
              try {
                const r = await withReauth(() => deleteHome(homeId).unwrap().then(() => true));
                if (r) {
                  dispatch(resetLive());
                  dispatch(setCurrentHome(null));
                  dispatch(api.util.resetApiState());
                  navigate('/');
                }
              } catch (e) {
                dispatch(pushToast({ message: toApiError(e).message, severity: 'error' }));
              }
            }}
          >
            Delete this home
          </Button>
        </SectionCard>
      )}
    </Stack>
  );
}

export function AuditTab() {
  const { homeId, can } = useHome();
  const q = useAuditQuery(homeId, { skip: !can('audit.view') });
  if (!can('audit.view')) return <PermissionDenied />;
  return (
    <SectionCard title="Audit log">
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Security-relevant actions in this home: sign-ins, role changes, integration changes, sensitive device commands and data deletion. Secrets are never recorded.
      </Typography>
      {q.isLoading ? (
        <ListSkeleton rows={5} />
      ) : (
        <Box sx={{ overflowX: 'auto' }}>
          <Table size="small" aria-label="Audit log">
            <TableHead>
              <TableRow>
                <TableCell>Time</TableCell>
                <TableCell>Action</TableCell>
                <TableCell>By</TableCell>
                <TableCell>Target</TableCell>
                <TableCell>Details</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {q.data?.logs.map((l) => (
                <TableRow key={l.id}>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>{formatDateTime(l.createdAt)}</TableCell>
                  <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>{l.action}</TableCell>
                  <TableCell>{l.actorName ?? 'System'}</TableCell>
                  <TableCell>{l.targetType ? `${l.targetType}` : '—'}</TableCell>
                  <TableCell sx={{ fontSize: '0.78rem', color: 'text.secondary', maxWidth: 320, wordBreak: 'break-word' }}>{Object.keys(l.metadata).length ? JSON.stringify(l.metadata) : '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Box>
      )}
    </SectionCard>
  );
}

import { useEffect, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { Alert, Box, Button, Chip, List, ListItem, ListItemText, MenuItem, Stack, Switch, TextField, Typography } from '@mui/material';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { DEFAULT_NOTIFICATION_PREFERENCES, changePasswordSchema, type NotificationPreferences, type UserPreferences } from '@smartnest/shared';
import { toApiError, useChangePasswordMutation, useMeQuery, useRevokeSessionMutation, useSessionsQuery, useUpdatePreferencesMutation, useUpdateProfileMutation } from '../../api/api';
import { formatDateTime, timeAgo, useHome } from '../../app/hooks';
import { pushToast, useAppDispatch } from '../../app/store';
import { useConfirm } from '../../components/common/Dialogs';
import { ListSkeleton, SectionCard } from '../../components/common/States';

export function ProfileTab() {
  const me = useMeQuery();
  const dispatch = useAppDispatch();
  const [updateProfile, up] = useUpdateProfileMutation();
  const [changePassword, cp] = useChangePasswordMutation();
  const sessions = useSessionsQuery();
  const [revoke] = useRevokeSessionMutation();
  const confirm = useConfirm();
  const [name, setName] = useState('');
  useEffect(() => setName(me.data?.user.name ?? ''), [me.data]);

  const pwSchema = changePasswordSchema.extend({ confirm: z.string() }).refine((v) => v.newPassword === v.confirm, { path: ['confirm'], message: 'Passwords do not match' });
  const pw = useForm<z.infer<typeof pwSchema>>({ resolver: zodResolver(pwSchema) });

  return (
    <Stack spacing={2.5}>
      <SectionCard title="Profile">
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ sm: 'flex-start' }}>
          <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} sx={{ maxWidth: 360 }} />
          <TextField label="Email" value={me.data?.user.email ?? ''} disabled sx={{ maxWidth: 360 }} helperText="Email changes are not supported in this version." />
          <Button
            variant="contained"
            disabled={!name.trim() || name === me.data?.user.name || up.isLoading}
            onClick={async () => {
              try {
                await updateProfile({ name: name.trim() }).unwrap();
                dispatch(pushToast({ message: 'Profile saved', severity: 'success' }));
              } catch (e) {
                dispatch(pushToast({ message: toApiError(e).message, severity: 'error' }));
              }
            }}
            sx={{ mt: { sm: 1 } }}
          >
            Save
          </Button>
        </Stack>
      </SectionCard>

      <SectionCard title="Change password">
        <form
          noValidate
          onSubmit={pw.handleSubmit(async (v) => {
            try {
              await changePassword({ currentPassword: v.currentPassword, newPassword: v.newPassword }).unwrap();
              pw.reset();
              dispatch(pushToast({ message: 'Password changed. Other sessions were signed out.', severity: 'success' }));
            } catch {
              /* shown below */
            }
          })}
        >
          <Stack spacing={2} sx={{ maxWidth: 420 }}>
            {cp.error && <Alert severity="error">{toApiError(cp.error).message}</Alert>}
            <TextField type="password" label="Current password" autoComplete="current-password" {...pw.register('currentPassword')} error={!!pw.formState.errors.currentPassword} helperText={pw.formState.errors.currentPassword?.message} />
            <TextField type="password" label="New password" autoComplete="new-password" {...pw.register('newPassword')} error={!!pw.formState.errors.newPassword} helperText={pw.formState.errors.newPassword?.message ?? 'At least 10 characters, including a letter and a number.'} />
            <TextField type="password" label="Confirm new password" autoComplete="new-password" {...pw.register('confirm')} error={!!pw.formState.errors.confirm} helperText={pw.formState.errors.confirm?.message} />
            <Box>
              <Button type="submit" variant="contained" disabled={cp.isLoading}>
                Change password
              </Button>
            </Box>
          </Stack>
        </form>
      </SectionCard>

      <SectionCard title="Active sessions">
        {sessions.isLoading ? (
          <ListSkeleton rows={2} />
        ) : (
          <List disablePadding>
            {sessions.data?.sessions.map((s) => (
              <ListItem
                key={s.id}
                divider
                disableGutters
                secondaryAction={
                  <Button
                    size="small"
                    color={s.current ? 'inherit' : 'error'}
                    onClick={async () => {
                      const ok = await confirm({ title: s.current ? 'Sign out of this session?' : 'Revoke this session?', message: s.current ? 'You will be signed out here.' : 'That device will be signed out immediately.', confirmLabel: s.current ? 'Sign out' : 'Revoke' });
                      if (!ok) return;
                      await revoke(s.id).unwrap().catch(() => undefined);
                      if (s.current) window.location.href = '/login';
                    }}
                  >
                    {s.current ? 'Sign out' : 'Revoke'}
                  </Button>
                }
              >
                <ListItemText
                  primary={
                    <Stack direction="row" spacing={1} alignItems="center">
                      <Typography variant="body2" fontWeight={600} noWrap sx={{ maxWidth: { xs: 180, sm: 420 } }}>
                        {s.userAgent ?? 'Unknown browser'}
                      </Typography>
                      {s.current && <Chip size="small" label="This device" color="primary" variant="outlined" />}
                    </Stack>
                  }
                  secondary={`${s.ipAddress ?? 'Unknown IP'} · signed in ${formatDateTime(s.createdAt)} · active ${timeAgo(s.lastSeenAt)}`}
                  sx={{ pr: 10 }}
                />
              </ListItem>
            ))}
          </List>
        )}
      </SectionCard>
    </Stack>
  );
}

export function PreferencesTab() {
  const me = useMeQuery();
  const [save, s] = useUpdatePreferencesMutation();
  const dispatch = useAppDispatch();
  const prefs = me.data?.preferences;
  if (!prefs) return <ListSkeleton rows={3} />;
  const update = async (patch: Partial<UserPreferences>) => {
    try {
      await save({ ...prefs, ...patch }).unwrap();
      dispatch(pushToast({ message: 'Preferences saved', severity: 'success' }));
    } catch (e) {
      dispatch(pushToast({ message: toApiError(e).message, severity: 'error' }));
    }
  };
  return (
    <SectionCard title="Display preferences">
      <Stack spacing={2.5} sx={{ maxWidth: 420 }}>
        <TextField select label="Temperature unit" value={prefs.temperatureUnit} onChange={(e) => void update({ temperatureUnit: e.target.value as UserPreferences['temperatureUnit'] })} disabled={s.isLoading} helperText="Device values are converted for display only.">
          <MenuItem value="home">Use the home's setting</MenuItem>
          <MenuItem value="C">Celsius (°C)</MenuItem>
          <MenuItem value="F">Fahrenheit (°F)</MenuItem>
        </TextField>
        <TextField select label="Animations" value={prefs.reducedMotion} onChange={(e) => void update({ reducedMotion: e.target.value as UserPreferences['reducedMotion'] })} disabled={s.isLoading} helperText="“System” follows your device's reduce-motion setting.">
          <MenuItem value="system">Follow system setting</MenuItem>
          <MenuItem value="on">Reduce motion</MenuItem>
          <MenuItem value="off">Full animations</MenuItem>
        </TextField>
        <TextField select label="Default device view" value={prefs.deviceView} onChange={(e) => void update({ deviceView: e.target.value as 'grid' | 'list' })} disabled={s.isLoading}>
          <MenuItem value="grid">Grid</MenuItem>
          <MenuItem value="list">List</MenuItem>
        </TextField>
      </Stack>
    </SectionCard>
  );
}

const NOTIF_ROWS: { key: keyof Omit<NotificationPreferences, 'energyThresholdW'>; label: string; desc: string }[] = [
  { key: 'criticalSecurity', label: 'Critical security alerts', desc: 'Smoke, CO, leaks, gas and triggered alarms.' },
  { key: 'deviceOffline', label: 'Device offline', desc: 'When a device becomes unreachable or unavailable.' },
  { key: 'lowBattery', label: 'Low battery', desc: 'When a device reports 20% battery or less.' },
  { key: 'automationFailures', label: 'Automation failures', desc: 'When an automation fails, partly fails or is disabled to prevent a loop.' },
  { key: 'integrationFailures', label: 'Integration problems', desc: 'Connection or authentication problems with an integration.' },
  { key: 'energyThresholds', label: 'Energy threshold', desc: 'When whole-home power exceeds your threshold (needs a meter).' },
];

export function NotificationsTab() {
  const me = useMeQuery();
  const { home } = useHome();
  const [save] = useUpdatePreferencesMutation();
  const dispatch = useAppDispatch();
  const prefs = me.data?.preferences;
  const n = { ...DEFAULT_NOTIFICATION_PREFERENCES, ...(prefs?.notifications ?? {}) };
  const [threshold, setThreshold] = useState<string>('');
  useEffect(() => setThreshold(n.energyThresholdW ? String(n.energyThresholdW) : ''), [n.energyThresholdW]);
  if (!prefs) return <ListSkeleton rows={4} />;
  const update = async (patch: Partial<NotificationPreferences>) => {
    try {
      await save({ ...prefs, notifications: { ...n, ...patch } }).unwrap();
    } catch (e) {
      dispatch(pushToast({ message: toApiError(e).message, severity: 'error' }));
    }
  };
  return (
    <SectionCard title="Notification preferences">
      <Alert severity="info" sx={{ mb: 2 }}>
        Notifications are delivered in-app. Email and push channels are not configured in this installation{home.isDemo ? ', and demo homes never send external notifications' : ''}.
      </Alert>
      <Stack spacing={1.5}>
        {NOTIF_ROWS.map((r) => (
          <Stack key={r.key} direction="row" justifyContent="space-between" alignItems="center" spacing={2}>
            <Box>
              <Typography variant="body2" fontWeight={600}>
                {r.label}
              </Typography>
              <Typography variant="caption">{r.desc}</Typography>
            </Box>
            <Switch checked={n[r.key]} onChange={(e) => void update({ [r.key]: e.target.checked })} inputProps={{ 'aria-label': r.label }} />
          </Stack>
        ))}
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems={{ sm: 'center' }} sx={{ pt: 1 }}>
          <TextField
            label="Energy threshold (W)"
            type="number"
            size="small"
            value={threshold}
            onChange={(e) => setThreshold(e.target.value)}
            inputProps={{ min: 100, max: 100000, step: 100 }}
            sx={{ maxWidth: 220 }}
            disabled={!n.energyThresholds}
          />
          <Button
            variant="outlined"
            disabled={!n.energyThresholds}
            onClick={() => {
              const v = threshold ? Number(threshold) : null;
              if (v !== null && (v < 100 || v > 100000)) {
                dispatch(pushToast({ message: 'Threshold must be between 100 and 100,000 W', severity: 'warning' }));
                return;
              }
              void update({ energyThresholdW: v }).then(() => dispatch(pushToast({ message: 'Threshold saved', severity: 'success' })));
            }}
          >
            Save threshold
          </Button>
        </Stack>
      </Stack>
    </SectionCard>
  );
}


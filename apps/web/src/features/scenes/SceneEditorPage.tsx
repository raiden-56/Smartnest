import { useState } from 'react';
import { Alert, Box, Button, FormControl, FormControlLabel, InputLabel, MenuItem, Radio, RadioGroup, Select, Stack, Switch, TextField, Tooltip, Typography } from '@mui/material';
import { Plus, ShieldAlert } from 'lucide-react';
import { Controller, useForm } from 'react-hook-form';
import { Link as RouterLink, useNavigate, useParams } from 'react-router-dom';
import { isSensitiveCommand, sceneInputSchema, type DeviceCommand, type SceneDto, type SceneInput } from '@smartnest/shared';
import { toApiError, useCreateSceneMutation, useRoomsQuery, useSceneQuery, useUpdateSceneMutation } from '../../api/api';
import { useHome } from '../../app/hooks';
import { pushToast, useAppDispatch } from '../../app/store';
import { AppIcon, SCENE_ICONS } from '../../components/common/AppIcon';
import { DetailSkeleton, ErrorState, PageHeader, PermissionDenied, SectionCard } from '../../components/common/States';
import { tokens } from '../../theme/theme';
import { ItemRow, moveItem } from '../automations/editors';
import { CommandBuilder, useAllDevices } from '../automations/shared';

type Action = { deviceId: string; command: DeviceCommand | undefined };
type FormValues = Omit<SceneInput, 'actions'> & { actions: Action[] };

const EMPTY: FormValues = { name: '', icon: 'sparkles', description: '', roomId: null, executionMode: 'parallel', isFavourite: false, allowSensitiveActions: false, actions: [] };

function fromScene(s: SceneDto): FormValues {
  return {
    name: s.name, icon: s.icon, description: s.description, roomId: s.roomId, executionMode: s.executionMode, isFavourite: s.isFavourite,
    allowSensitiveActions: s.allowSensitiveActions, actions: s.actions.map((a) => ({ deviceId: a.deviceId, command: a.command })),
  };
}

export default function SceneEditorPage() {
  const { sceneId } = useParams();
  const { homeId, can } = useHome();
  const q = useSceneQuery({ homeId, sceneId: sceneId ?? '' }, { skip: !sceneId });
  if (!can('scenes.manage')) return <PermissionDenied message="Only home owners and administrators can create or edit scenes." />;
  if (sceneId && q.isLoading) return <DetailSkeleton />;
  if (sceneId && (q.error || !q.data)) return <ErrorState error={q.error} onRetry={q.refetch} title="Could not load the scene" />;
  return <Editor key={sceneId ?? 'new'} homeId={homeId} scene={q.data?.scene} />;
}

function Editor({ homeId, scene }: { homeId: string; scene?: SceneDto }) {
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const { devices, byId } = useAllDevices(homeId);
  const rooms = useRoomsQuery(homeId);
  const [create, cs] = useCreateSceneMutation();
  const [update, us] = useUpdateSceneMutation();
  const [error, setError] = useState<string | null>(null);
  const form = useForm<FormValues>({ defaultValues: scene ? fromScene(scene) : EMPTY });
  const values = form.watch();
  const setActions = (a: Action[]) => form.setValue('actions', a, { shouldDirty: true });

  const sensitiveCount = values.actions.filter((a) => a.command && byId.get(a.deviceId) && isSensitiveCommand(a.command, byId.get(a.deviceId)!.capabilities)).length;

  const save = form.handleSubmit(async (v) => {
    setError(null);
    if (v.actions.some((a) => !a.deviceId || !a.command)) {
      setError('Choose a device and action for every step, or remove the empty steps.');
      return;
    }
    const parsed = sceneInputSchema.safeParse({ ...v, roomId: v.roomId || null, actions: v.actions.map((a, i) => ({ deviceId: a.deviceId, command: a.command, order: i })) });
    if (!parsed.success) {
      setError(parsed.error.issues.map((i) => `${i.path.join('.') || 'scene'}: ${i.message}`).join(' · '));
      return;
    }
    try {
      if (scene) await update({ homeId, sceneId: scene.id, ...parsed.data }).unwrap();
      else await create({ homeId, ...parsed.data }).unwrap();
      dispatch(pushToast({ message: 'Scene saved', severity: 'success' }));
      navigate(`/scenes${scene ? `?highlight=${scene.id}` : ''}`);
    } catch (e) {
      setError(toApiError(e).message);
    }
  });

  return (
    <Box component="form" onSubmit={save} noValidate>
      <PageHeader
        title={scene ? `Edit “${scene.name}”` : 'New scene'}
        subtitle="A scene sets several devices at once. Only actions each device supports are offered."
        actions={
          <>
            <Button component={RouterLink} to="/scenes">Cancel</Button>
            <Button type="submit" variant="contained" disabled={cs.isLoading || us.isLoading}>
              {cs.isLoading || us.isLoading ? 'Saving…' : 'Save scene'}
            </Button>
          </>
        }
      />
      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', lg: '2fr 1fr' }, alignItems: 'start' }}>
        <Stack spacing={2} sx={{ minWidth: 0 }}>
          <SectionCard>
            <Stack spacing={2}>
              <TextField label="Name" required inputProps={{ maxLength: 60 }} {...form.register('name', { required: 'Name the scene' })} error={!!form.formState.errors.name} helperText={form.formState.errors.name?.message} />
              <TextField label="Description" multiline minRows={2} inputProps={{ maxLength: 300 }} {...form.register('description')} />
              <Box>
                <Typography variant="overline" color="text.secondary" component="div">
                  Icon
                </Typography>
                <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap role="radiogroup" aria-label="Scene icon">
                  {SCENE_ICONS.map((i) => (
                    <Tooltip key={i} title={i}>
                      <Box
                        component="button"
                        type="button"
                        role="radio"
                        aria-checked={values.icon === i}
                        aria-label={i}
                        onClick={() => form.setValue('icon', i, { shouldDirty: true })}
                        sx={{
                          width: 42, height: 42, borderRadius: '12px', cursor: 'pointer', display: 'grid', placeItems: 'center',
                          border: `2px solid ${values.icon === i ? tokens.color.primary : tokens.color.border}`,
                          bgcolor: values.icon === i ? 'sage.main' : 'background.paper', color: 'primary.dark',
                        }}
                      >
                        <AppIcon name={i} size={20} />
                      </Box>
                    </Tooltip>
                  ))}
                </Stack>
              </Box>
            </Stack>
          </SectionCard>

          <SectionCard title="Actions">
            <Stack spacing={1.5}>
              {values.actions.map((a, i) => (
                <ItemRow key={i} index={i} count={values.actions.length} label="action" onMove={(d) => setActions(moveItem(values.actions, i, d))} onRemove={() => setActions(values.actions.filter((_, j) => j !== i))}>
                  {values.executionMode === 'sequential' && (
                    <Typography variant="overline" color="text.secondary">
                      Step {i + 1}
                    </Typography>
                  )}
                  <CommandBuilder devices={devices} deviceId={a.deviceId} command={a.command} onChange={(deviceId, command) => setActions(values.actions.map((x, j) => (j === i ? { deviceId, command } : x)))} />
                </ItemRow>
              ))}
              {!values.actions.length && <Typography color="text.secondary">Add at least one device action.</Typography>}
              <Button startIcon={<Plus size={16} />} sx={{ alignSelf: 'flex-start' }} disabled={values.actions.length >= 50} onClick={() => setActions([...values.actions, { deviceId: '', command: undefined }])}>
                Add action
              </Button>
            </Stack>
          </SectionCard>
        </Stack>

        <Stack spacing={2}>
          <SectionCard title="Options">
            <Stack spacing={2}>
              <FormControl size="small">
                <InputLabel id="scene-room">Room (optional)</InputLabel>
                <Controller
                  control={form.control}
                  name="roomId"
                  render={({ field }) => (
                    <Select labelId="scene-room" label="Room (optional)" value={field.value ?? ''} onChange={(e) => field.onChange(e.target.value || null)}>
                      <MenuItem value="">No room</MenuItem>
                      {rooms.data?.rooms.map((r) => (
                        <MenuItem key={r.id} value={r.id}>
                          {r.name}
                        </MenuItem>
                      ))}
                    </Select>
                  )}
                />
              </FormControl>
              <Box>
                <Typography variant="overline" color="text.secondary" component="div" id="exec-mode">
                  Execution
                </Typography>
                <Controller
                  control={form.control}
                  name="executionMode"
                  render={({ field }) => (
                    <RadioGroup aria-labelledby="exec-mode" value={field.value} onChange={(e) => field.onChange(e.target.value)}>
                      <FormControlLabel value="parallel" control={<Radio size="small" />} label="All at once (parallel)" />
                      <FormControlLabel value="sequential" control={<Radio size="small" />} label="One after another (in order)" />
                    </RadioGroup>
                  )}
                />
                <Typography variant="caption">Sequential waits for each device to confirm (or fail) before the next — useful for “lights off, then lock”.</Typography>
              </Box>
              <Controller control={form.control} name="isFavourite" render={({ field }) => <FormControlLabel control={<Switch checked={field.value} onChange={(e) => field.onChange(e.target.checked)} />} label="Show in quick actions" />} />
              <Controller
                control={form.control}
                name="allowSensitiveActions"
                render={({ field }) => <FormControlLabel control={<Switch checked={field.value} onChange={(e) => field.onChange(e.target.checked)} />} label="Allow sensitive actions" />}
              />
              {values.allowSensitiveActions ? (
                <Alert severity="warning" icon={<ShieldAlert size={18} />}>
                  This scene may lock or unlock doors, arm or disarm alarms, or open garage doors. Running it will always ask for confirmation and be recorded in the audit log.
                </Alert>
              ) : (
                <Typography variant="caption">Locks, alarms and garage doors are rejected unless this is enabled.</Typography>
              )}
              {sensitiveCount > 0 && !values.allowSensitiveActions && (
                <Alert severity="error">{sensitiveCount} action{sensitiveCount > 1 ? 's are' : ' is'} security-sensitive. Enable “Allow sensitive actions” or remove them.</Alert>
              )}
            </Stack>
          </SectionCard>
        </Stack>
      </Box>
    </Box>
  );
}

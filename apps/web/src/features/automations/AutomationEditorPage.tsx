import { useEffect, useMemo, useState } from 'react';
import { Alert, Box, Button, Card, Chip, Divider, FormControl, InputLabel, MenuItem, Select, Stack, Tab, Tabs, TextField, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';
import { Bot, CheckCircle2, Plus, ShieldAlert } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { Link as RouterLink, useNavigate, useParams } from 'react-router-dom';
import { automationInputSchema, describeTrigger, type AutomationDto, type AutomationInput, type AutomationIssue } from '@smartnest/shared';
import {
  toApiError, useAutomationQuery, useAutomationsQuery, useCreateAutomationMutation, useIntegrationsQuery, useRoomsQuery, useScenesQuery, useUpdateAutomationMutation,
  useValidateAutomationMutation,
} from '../../api/api';
import { useHome } from '../../app/hooks';
import { pushToast, useAppDispatch } from '../../app/store';
import { DetailSkeleton, EmptyState, ErrorState, PageHeader, PermissionDenied, SectionCard } from '../../components/common/States';
import { ActionEditor, ConditionEditor, ItemRow, SectionHeading, TriggerEditor, defaultAction, defaultCondition, defaultTrigger, moveItem, type EditorContext } from './editors';
import { LabeledSwitch, useAllDevices } from './shared';

const NEW_AUTOMATION: AutomationInput = {
  name: '',
  description: '',
  enabled: true,
  isDraft: false,
  triggers: [{ type: 'time', at: '08:00', days: [0, 1, 2, 3, 4, 5, 6] }],
  conditions: [],
  conditionOperator: 'and',
  actions: [],
  cooldownSeconds: 30,
  allowSensitiveActions: false,
};

export function toInput(a: AutomationDto): AutomationInput {
  return {
    name: a.name,
    description: a.description,
    enabled: a.enabled,
    isDraft: a.isDraft,
    triggers: a.triggers,
    conditions: a.conditions,
    conditionOperator: a.conditionOperator,
    actions: a.actions,
    cooldownSeconds: a.cooldownSeconds,
    allowSensitiveActions: a.allowSensitiveActions,
  };
}

/** Strip undefined so JSON and schema parsing agree. */
const clean = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

export default function AutomationEditorPage() {
  const { automationId } = useParams();
  const { homeId, home, can } = useHome();
  const existing = useAutomationQuery({ homeId, automationId: automationId ?? '' }, { skip: !automationId });
  if (!can('automations.manage')) return <PermissionDenied message="Only home owners and administrators can create or edit automations." />;
  if (automationId && existing.isLoading) return <DetailSkeleton />;
  if (automationId && existing.error) return <ErrorState error={existing.error} onRetry={existing.refetch} title="Could not load the automation" />;
  const a = existing.data?.automation;
  if (a && a.executor !== 'smartnest') {
    return (
      <>
        <PageHeader title={a.name} subtitle="Runs in Home Assistant" />
        <EmptyState
          icon={<Bot size={24} />}
          title="Edit this automation in Home Assistant"
          description="This automation is owned and executed by Home Assistant. SmartNest can enable, disable or trigger it, but never edits or runs its logic itself — so it cannot run twice."
          action={<Button component={RouterLink} to={`/automations/${a.id}`} variant="contained">Back to automation</Button>}
        />
      </>
    );
  }
  return <Editor key={a?.id ?? 'new'} homeId={homeId} existing={a} homeHasLocation={home.latitude !== null && home.longitude !== null} />;
}

function Editor({ homeId, existing, homeHasLocation }: { homeId: string; existing?: AutomationDto; homeHasLocation: boolean }) {
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const { devices, isLoading: devicesLoading } = useAllDevices(homeId);
  const scenes = useScenesQuery(homeId);
  const rooms = useRoomsQuery(homeId);
  const automations = useAutomationsQuery(homeId);
  const integrations = useIntegrationsQuery(homeId);
  const [create, createState] = useCreateAutomationMutation();
  const [update, updateState] = useUpdateAutomationMutation();
  const [validate, validateState] = useValidateAutomationMutation();

  const form = useForm<AutomationInput>({ defaultValues: existing ? toInput(existing) : NEW_AUTOMATION });
  const values = form.watch();
  const [tab, setTab] = useState<'form' | 'json'>('form');
  const [json, setJson] = useState('');
  const [jsonErrors, setJsonErrors] = useState<string[]>([]);
  const [issues, setIssues] = useState<AutomationIssue[] | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const ctx: EditorContext = useMemo(
    () => ({
      devices,
      scenes: scenes.data?.scenes ?? [],
      rooms: rooms.data?.rooms ?? [],
      automations: automations.data?.automations ?? [],
      integrations: integrations.data?.integrations ?? [],
      selfId: existing?.id,
      homeHasLocation,
    }),
    [devices, scenes.data, rooms.data, automations.data, integrations.data, existing?.id, homeHasLocation],
  );

  // Revalidate on the server (debounced) whenever the rule changes.
  useEffect(() => {
    setIssues(null);
    const t = window.setTimeout(() => {
      void validate({ homeId, id: existing?.id, automation: clean(form.getValues()) })
        .unwrap()
        .then((r) => setIssues(r.issues))
        .catch(() => undefined);
    }, 900);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(values)]);

  const set = <K extends keyof AutomationInput>(k: K, v: AutomationInput[K]) => form.setValue(k, v as never, { shouldDirty: true });

  const switchTab = (next: 'form' | 'json') => {
    if (next === tab) return;
    if (next === 'json') {
      setJson(JSON.stringify(clean(form.getValues()), null, 2));
      setJsonErrors([]);
      setTab('json');
      return;
    }
    if (!applyJson()) return;
    setTab('form');
  };

  const applyJson = (): boolean => {
    let raw: unknown;
    try {
      raw = JSON.parse(json);
    } catch (e) {
      setJsonErrors([`Invalid JSON: ${(e as Error).message}`]);
      return false;
    }
    const parsed = automationInputSchema.safeParse(raw);
    if (!parsed.success) {
      setJsonErrors(parsed.error.issues.map((i) => `${i.path.join('.') || 'root'}: ${i.message}`));
      return false;
    }
    form.reset(parsed.data, { keepDefaultValues: true });
    setJsonErrors([]);
    return true;
  };

  const save = async (asDraft: boolean) => {
    setSaveError(null);
    if (tab === 'json' && !applyJson()) return;
    const raw = clean({ ...form.getValues(), isDraft: asDraft, ...(asDraft ? { enabled: false } : {}) });
    const parsed = automationInputSchema.safeParse(raw);
    if (!parsed.success && !asDraft) {
      setSaveError(parsed.error.issues.map((i) => `${i.path.join('.') || 'root'}: ${i.message}`).join(' · '));
      return;
    }
    if (!parsed.success) {
      setSaveError(`Even drafts need a name, at least one trigger and one action. ${parsed.error.issues[0]?.message ?? ''}`);
      return;
    }
    try {
      const r = existing ? await update({ homeId, automationId: existing.id, ...parsed.data }).unwrap() : await create({ homeId, ...parsed.data }).unwrap();
      dispatch(pushToast({ message: asDraft ? 'Draft saved' : 'Automation saved', severity: 'success' }));
      navigate(`/automations/${r.automation.id}`);
    } catch (e) {
      const err = toApiError(e);
      const detailIssues = (err.details as { issues?: AutomationIssue[] } | undefined)?.issues;
      if (detailIssues) setIssues(detailIssues);
      setSaveError(err.message);
    }
  };

  const runValidate = async () => {
    if (tab === 'json' && !applyJson()) return;
    const r = await validate({ homeId, id: existing?.id, automation: clean(form.getValues()) }).unwrap().catch((e) => {
      setSaveError(toApiError(e).message);
      return null;
    });
    if (r) {
      setIssues(r.issues);
      dispatch(pushToast({ message: r.valid ? (r.issues.length ? 'Valid, with warnings' : 'Automation is valid') : 'Fix the errors before enabling', severity: r.valid ? 'success' : 'warning' }));
    }
  };

  const errors = issues?.filter((i) => i.severity === 'error') ?? [];
  const warnings = issues?.filter((i) => i.severity === 'warning') ?? [];
  const issuesAt = (prefix: string) => issues?.filter((i) => i.path === prefix || i.path.startsWith(`${prefix}.`)) ?? [];
  const saving = createState.isLoading || updateState.isLoading;
  const deviceName = (id: string) => devices.find((d) => d.id === id)?.name ?? 'Unknown device';

  return (
    <Box>
      <PageHeader
        title={existing ? `Edit “${existing.name}”` : 'New automation'}
        subtitle="Runs in SmartNest. When a trigger fires and the conditions hold, the actions run in order."
        actions={
          <>
            <Button component={RouterLink} to={existing ? `/automations/${existing.id}` : '/automations'}>Cancel</Button>
            <Button variant="outlined" onClick={() => void runValidate()} disabled={validateState.isLoading} startIcon={<CheckCircle2 size={16} />}>
              Validate
            </Button>
            <Button variant="outlined" onClick={() => void save(true)} disabled={saving}>
              Save draft
            </Button>
            <Button variant="contained" onClick={() => void save(false)} disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </>
        }
      />

      {saveError && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setSaveError(null)}>
          {saveError}
        </Alert>
      )}
      {issues && (errors.length > 0 || warnings.length > 0) && (
        <Alert severity={errors.length ? 'error' : 'warning'} sx={{ mb: 2 }}>
          <Typography fontWeight={700}>{errors.length ? `${errors.length} problem${errors.length > 1 ? 's' : ''} to fix before enabling` : 'Warnings'}</Typography>
          <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
            {[...errors, ...warnings].map((i, n) => (
              <li key={n}>
                <Typography variant="body2">
                  <strong>{i.severity === 'error' ? 'Error' : 'Warning'}</strong> ({humanPath(i.path)}): {i.message}
                </Typography>
              </li>
            ))}
          </Box>
        </Alert>
      )}
      {issues && !errors.length && !warnings.length && values.actions.length > 0 && (
        <Alert severity="success" sx={{ mb: 2 }}>
          No problems found.
        </Alert>
      )}

      <Tabs value={tab} onChange={(_, v) => switchTab(v)} sx={{ mb: 2 }} aria-label="Editor mode">
        <Tab value="form" label="Builder" />
        <Tab value="json" label="Advanced (JSON)" />
      </Tabs>

      {tab === 'json' ? (
        <Card sx={{ p: 2 }}>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            Edit the rule as JSON (format: AutomationInput). Changes are checked against the schema when you switch back or save.
          </Typography>
          <TextField
            multiline
            minRows={18}
            value={json}
            onChange={(e) => setJson(e.target.value)}
            inputProps={{ 'aria-label': 'Automation JSON', spellCheck: false, style: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', fontSize: 13 } }}
          />
          {jsonErrors.length > 0 && (
            <Alert severity="error" sx={{ mt: 1.5 }}>
              {jsonErrors.map((e, i) => (
                <div key={i}>{e}</div>
              ))}
            </Alert>
          )}
          <Button sx={{ mt: 1.5 }} variant="outlined" onClick={() => applyJson() && dispatch(pushToast({ message: 'JSON applied', severity: 'success' }))}>
            Apply JSON
          </Button>
        </Card>
      ) : (
        <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', lg: '2fr 1fr' }, alignItems: 'start' }}>
          <Stack spacing={2} sx={{ minWidth: 0 }}>
            <SectionCard>
              <Stack spacing={2}>
                <TextField label="Name" {...form.register('name')} inputProps={{ maxLength: 80 }} required />
                <TextField label="Description" {...form.register('description')} multiline minRows={2} inputProps={{ maxLength: 500 }} />
              </Stack>
            </SectionCard>

            <SectionCard>
              <SectionHeading title="When" hint="Any one of these triggers starts the automation." count={values.triggers.length} />
              <Stack spacing={1.5}>
                {values.triggers.map((t, i) => (
                  <ItemRow key={i} index={i} count={values.triggers.length} label="trigger" onRemove={() => set('triggers', values.triggers.filter((_, j) => j !== i))}>
                    <TriggerEditor trigger={t} ctx={ctx} onChange={(n) => set('triggers', values.triggers.map((x, j) => (j === i ? n : x)))} />
                    <IssueText issues={issuesAt(`triggers.${i}`)} />
                  </ItemRow>
                ))}
                {!values.triggers.length && <Typography color="error.main" variant="body2">Add at least one trigger.</Typography>}
                <Button size="small" startIcon={<Plus size={14} />} sx={{ alignSelf: 'flex-start' }} disabled={values.triggers.length >= 10 || devicesLoading} onClick={() => set('triggers', [...values.triggers, defaultTrigger('time', ctx)])}>
                  Add trigger
                </Button>
              </Stack>
            </SectionCard>

            <SectionCard>
              <SectionHeading title="Only if" hint="Optional. Conditions are checked when a trigger fires." count={values.conditions.length} />
              {values.conditions.length > 1 && (
                <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1.5 }}>
                  <Typography variant="body2">Require</Typography>
                  <ToggleButtonGroup size="small" exclusive value={values.conditionOperator} onChange={(_, v) => v && set('conditionOperator', v)} aria-label="Condition operator">
                    <ToggleButton value="and">All (AND)</ToggleButton>
                    <ToggleButton value="or">Any (OR)</ToggleButton>
                  </ToggleButtonGroup>
                </Stack>
              )}
              <Stack spacing={1.5}>
                {values.conditions.map((c, i) => (
                  <ItemRow key={i} index={i} count={values.conditions.length} label="condition" onRemove={() => set('conditions', values.conditions.filter((_, j) => j !== i))}>
                    <ConditionEditor condition={c} ctx={ctx} onChange={(n) => set('conditions', values.conditions.map((x, j) => (j === i ? n : x)))} />
                    <IssueText issues={issuesAt(`conditions.${i}`)} />
                  </ItemRow>
                ))}
                <Button size="small" startIcon={<Plus size={14} />} sx={{ alignSelf: 'flex-start' }} disabled={values.conditions.length >= 20} onClick={() => set('conditions', [...values.conditions, defaultCondition('timeWindow', ctx)])}>
                  Add condition
                </Button>
              </Stack>
            </SectionCard>

            <SectionCard>
              <SectionHeading title="Then" hint="Actions run one after another, in this order." count={values.actions.length} />
              <Stack spacing={1.5}>
                {values.actions.map((a, i) => (
                  <ItemRow
                    key={i}
                    index={i}
                    count={values.actions.length}
                    label="action"
                    onMove={(d) => set('actions', moveItem(values.actions, i, d))}
                    onRemove={() => set('actions', values.actions.filter((_, j) => j !== i))}
                  >
                    <Typography variant="overline" color="text.secondary">
                      Step {i + 1}
                    </Typography>
                    <ActionEditor action={a} ctx={ctx} onChange={(n) => set('actions', values.actions.map((x, j) => (j === i ? n : x)))} />
                    <IssueText issues={issuesAt(`actions.${i}`)} />
                  </ItemRow>
                ))}
                {!values.actions.length && <Typography color="text.secondary" variant="body2">Add at least one action.</Typography>}
                <Button size="small" startIcon={<Plus size={14} />} sx={{ alignSelf: 'flex-start' }} disabled={values.actions.length >= 30} onClick={() => set('actions', [...values.actions, defaultAction('deviceCommand', ctx)])}>
                  Add action
                </Button>
              </Stack>
            </SectionCard>
          </Stack>

          <Stack spacing={2} sx={{ position: { lg: 'sticky' }, top: { lg: 88 } }}>
            <SectionCard title="Settings">
              <Stack spacing={2}>
                <LabeledSwitch checked={values.enabled} onChange={(v) => set('enabled', v)} label="Enabled after saving" description="Ignored for drafts — drafts never run." />
                <TextField
                  size="small"
                  type="number"
                  label="Cooldown (seconds)"
                  value={values.cooldownSeconds}
                  onChange={(e) => set('cooldownSeconds', Math.max(0, Math.min(86400, Math.round(Number(e.target.value) || 0))))}
                  helperText="Minimum time between runs. Protects against loops."
                  inputProps={{ min: 0, max: 86400 }}
                />
                <FormControl size="small">
                  <InputLabel>Executed by</InputLabel>
                  <Select label="Executed by" value="smartnest" disabled>
                    <MenuItem value="smartnest">SmartNest server</MenuItem>
                  </Select>
                </FormControl>
                <Divider />
                <LabeledSwitch checked={values.allowSensitiveActions} onChange={(v) => set('allowSensitiveActions', v)} label="Allow sensitive actions" />
                {values.allowSensitiveActions ? (
                  <Alert severity="warning" icon={<ShieldAlert size={18} />}>
                    This automation may unlock doors, disarm alarms or open garage doors without anyone confirming. Every such action is recorded in the audit log.
                  </Alert>
                ) : (
                  <Typography variant="caption">Unlocking, disarming and opening garage doors are blocked unless you enable this.</Typography>
                )}
              </Stack>
            </SectionCard>
            <SectionCard title="Summary">
              <Stack spacing={0.75}>
                {values.triggers.map((t, i) => (
                  <Typography key={i} variant="body2">
                    • {safeDescribe(() => describeTrigger(t, deviceName))}
                  </Typography>
                ))}
                {existing?.isDraft && <Chip size="small" label="Currently a draft" sx={{ alignSelf: 'flex-start' }} />}
              </Stack>
            </SectionCard>
          </Stack>
        </Box>
      )}
    </Box>
  );
}

function safeDescribe(fn: () => string): string {
  try {
    return fn();
  } catch {
    return 'Incomplete trigger';
  }
}

function humanPath(p: string): string {
  const m = p.match(/^(triggers|conditions|actions)\.(\d+)/);
  if (!m) return p || 'automation';
  const noun = { triggers: 'Trigger', conditions: 'Condition', actions: 'Step' }[m[1] as 'triggers'];
  return `${noun} ${Number(m[2]) + 1}`;
}

function IssueText({ issues }: { issues: AutomationIssue[] }) {
  if (!issues.length) return null;
  return (
    <Stack spacing={0.25} sx={{ mt: 1 }}>
      {issues.map((i, n) => (
        <Typography key={n} variant="caption" sx={{ color: i.severity === 'error' ? 'error.main' : 'warning.dark' }} role={i.severity === 'error' ? 'alert' : undefined}>
          {i.severity === 'error' ? 'Error: ' : 'Warning: '}
          {i.message}
        </Typography>
      ))}
    </Stack>
  );
}

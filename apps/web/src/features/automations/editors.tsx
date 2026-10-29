import { Alert, Box, Button, Chip, FormControl, IconButton, InputLabel, MenuItem, Select, Stack, TextField, ToggleButton, ToggleButtonGroup, Tooltip, Typography } from '@mui/material';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import {
  ALARM_STATES, DAY_SHORT, type AutomationAction, type AutomationCondition, type AutomationDto, type AutomationTrigger, type DeviceDto, type IntegrationDto,
  type RoomDto, type SceneDto,
} from '@smartnest/shared';
import { tokens } from '../../theme/theme';
import { ATTRIBUTE_LABEL, CommandBuilder, DeviceSelect, attributeValues, numericKey, numericOptionsFor, watchableFor } from './shared';

export interface EditorContext {
  devices: DeviceDto[];
  scenes: SceneDto[];
  rooms: RoomDto[];
  automations: AutomationDto[];
  integrations: IntegrationDto[];
  selfId?: string;
  homeHasLocation: boolean;
}

const sel = (label: string, value: string, options: { value: string; label: string }[], onChange: (v: string) => void, minWidth = 160) => (
  <FormControl size="small" sx={{ minWidth, width: { xs: '100%', sm: 'auto' } }}>
    <InputLabel>{label}</InputLabel>
    <Select label={label} value={options.some((o) => o.value === value) ? value : ''} onChange={(e) => onChange(String(e.target.value))}>
      {options.map((o) => (
        <MenuItem key={o.value} value={o.value} sx={{ textTransform: 'capitalize' }}>
          {o.label}
        </MenuItem>
      ))}
    </Select>
  </FormControl>
);

const numField = (label: string, value: number | undefined, onChange: (v: number | undefined) => void, opts: { min?: number; max?: number; required?: boolean; width?: number } = {}) => (
  <TextField
    size="small"
    type="number"
    label={label}
    value={value ?? ''}
    onChange={(e) => {
      const raw = e.target.value;
      if (raw === '') return onChange(opts.required ? (opts.min ?? 0) : undefined);
      const n = Number(raw);
      if (Number.isFinite(n)) onChange(n);
    }}
    inputProps={{ min: opts.min, max: opts.max }}
    sx={{ width: { xs: '100%', sm: opts.width ?? 130 } }}
  />
);

function DayChips({ days, onChange }: { days: number[]; onChange: (d: number[]) => void }) {
  return (
    <ToggleButtonGroup
      size="small"
      value={days}
      onChange={(_, v: number[]) => v.length && onChange([...v].sort())}
      aria-label="Days of the week"
      sx={{ flexWrap: 'wrap', '& .MuiToggleButton-root': { px: 1, minWidth: 40 } }}
    >
      {DAY_SHORT.map((d, i) => (
        <ToggleButton key={d} value={i} aria-label={d}>
          {d}
        </ToggleButton>
      ))}
    </ToggleButtonGroup>
  );
}

/** Row shell with reorder/remove buttons. */
export function ItemRow({ index, count, onMove, onRemove, children, label }: { index: number; count: number; onMove?: (dir: -1 | 1) => void; onRemove: () => void; children: React.ReactNode; label: string }) {
  return (
    <Box sx={{ border: `1px solid ${tokens.color.border}`, borderRadius: `${tokens.radius.md}px`, p: { xs: 1.5, sm: 2 }, bgcolor: 'background.paper' }}>
      <Stack direction="row" spacing={1} alignItems="flex-start">
        <Box sx={{ flex: 1, minWidth: 0 }}>{children}</Box>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={0.25}>
          {onMove && (
            <>
              <Tooltip title="Move up">
                <span>
                  <IconButton size="small" aria-label={`Move ${label} ${index + 1} up`} disabled={index === 0} onClick={() => onMove(-1)}>
                    <ArrowUp size={16} />
                  </IconButton>
                </span>
              </Tooltip>
              <Tooltip title="Move down">
                <span>
                  <IconButton size="small" aria-label={`Move ${label} ${index + 1} down`} disabled={index === count - 1} onClick={() => onMove(1)}>
                    <ArrowDown size={16} />
                  </IconButton>
                </span>
              </Tooltip>
            </>
          )}
          <Tooltip title="Remove">
            <IconButton size="small" aria-label={`Remove ${label} ${index + 1}`} onClick={onRemove}>
              <Trash2 size={16} />
            </IconButton>
          </Tooltip>
        </Stack>
      </Stack>
    </Box>
  );
}

export function moveItem<T>(arr: T[], i: number, dir: -1 | 1): T[] {
  const j = i + dir;
  if (j < 0 || j >= arr.length) return arr;
  const out = [...arr];
  [out[i], out[j]] = [out[j]!, out[i]!];
  return out;
}

// ─── Triggers ──────────────────────────────────────────────────────────────

export const TRIGGER_TYPES: { value: AutomationTrigger['type']; label: string }[] = [
  { value: 'time', label: 'At a time' },
  { value: 'interval', label: 'Every N minutes' },
  { value: 'sun', label: 'Sunrise / sunset' },
  { value: 'deviceState', label: 'Device state changes' },
  { value: 'numericThreshold', label: 'Reading crosses a threshold' },
  { value: 'connectivity', label: 'Device connectivity changes' },
  { value: 'integrationEvent', label: 'Integration event' },
];

export function defaultTrigger(type: AutomationTrigger['type'], ctx: EditorContext): AutomationTrigger {
  const first = ctx.devices[0]?.id ?? '';
  switch (type) {
    case 'time': return { type, at: '08:00', days: [0, 1, 2, 3, 4, 5, 6] };
    case 'interval': return { type, everyMinutes: 30 };
    case 'sun': return { type, event: 'sunset', offsetMinutes: 0 };
    case 'deviceState': {
      const d = ctx.devices.find((x) => watchableFor(x).length) ;
      const attr = watchableFor(d)[0] ?? 'on';
      const v = attributeValues(d, attr)[0]?.value;
      return { type, deviceId: d?.id ?? first, attribute: attr, ...(v !== undefined ? { to: v } : {}) };
    }
    case 'numericThreshold': {
      const d = ctx.devices.find((x) => numericOptionsFor(x).length);
      const o = numericOptionsFor(d)[0];
      return { type, deviceId: d?.id ?? first, attribute: o?.attribute ?? 'batteryLevel', ...(o?.measurementKey ? { measurementKey: o.measurementKey } : {}), above: undefined, below: 20 };
    }
    case 'connectivity': return { type, deviceId: first, to: 'offline' };
    case 'integrationEvent': return { type, integrationId: ctx.integrations[0]?.id ?? '', eventType: '' };
  }
}

export function TriggerEditor({ trigger, onChange, ctx }: { trigger: AutomationTrigger; onChange: (t: AutomationTrigger) => void; ctx: EditorContext }) {
  const device = 'deviceId' in trigger ? ctx.devices.find((d) => d.id === trigger.deviceId) : undefined;
  return (
    <Stack spacing={1.5}>
      {sel('When', trigger.type, TRIGGER_TYPES, (t) => onChange(defaultTrigger(t as AutomationTrigger['type'], ctx)), 220)}
      {trigger.type === 'time' && (
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems={{ sm: 'center' }}>
          <TextField size="small" type="time" label="Time" value={trigger.at} onChange={(e) => onChange({ ...trigger, at: e.target.value })} InputLabelProps={{ shrink: true }} sx={{ width: { xs: '100%', sm: 140 } }} />
          <DayChips days={trigger.days} onChange={(days) => onChange({ ...trigger, days })} />
        </Stack>
      )}
      {trigger.type === 'interval' && numField('Every (minutes)', trigger.everyMinutes, (v) => onChange({ ...trigger, everyMinutes: Math.max(5, Math.round(v ?? 5)) }), { min: 5, max: 1440, required: true, width: 160 })}
      {trigger.type === 'sun' && (
        <Stack spacing={1}>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
            {sel('Event', trigger.event, [{ value: 'sunrise', label: 'Sunrise' }, { value: 'sunset', label: 'Sunset' }], (v) => onChange({ ...trigger, event: v as 'sunrise' | 'sunset' }))}
            {numField('Offset (min, − before)', trigger.offsetMinutes, (v) => onChange({ ...trigger, offsetMinutes: Math.round(v ?? 0) }), { min: -180, max: 180, required: true, width: 190 })}
          </Stack>
          {!ctx.homeHasLocation && <Alert severity="warning">Sunrise and sunset need the home's location. Set it in Settings → Home.</Alert>}
        </Stack>
      )}
      {trigger.type === 'deviceState' && (
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} flexWrap="wrap" useFlexGap>
          <DeviceSelect
            devices={ctx.devices}
            value={trigger.deviceId}
            filter={(d) => watchableFor(d).length > 0}
            onChange={(id) => {
              const d = ctx.devices.find((x) => x.id === id);
              const attr = watchableFor(d)[0] ?? 'on';
              const v = attributeValues(d, attr)[0]?.value;
              onChange({ type: 'deviceState', deviceId: id, attribute: attr, ...(v !== undefined ? { to: v } : {}) });
            }}
          />
          {sel('Attribute', trigger.attribute, watchableFor(device).map((a) => ({ value: a, label: ATTRIBUTE_LABEL[a] ?? a })), (a) => {
            const v = attributeValues(device, a)[0]?.value;
            onChange({ ...trigger, attribute: a as typeof trigger.attribute, to: v, from: undefined });
          })}
          {sel(
            'Becomes',
            trigger.to === undefined ? '__any' : String(trigger.to),
            [{ value: '__any', label: 'Any change' }, ...attributeValues(device, trigger.attribute).map((o) => ({ value: String(o.value), label: o.label }))],
            (v) => onChange({ ...trigger, to: v === '__any' ? undefined : v === 'true' ? true : v === 'false' ? false : v }),
          )}
        </Stack>
      )}
      {trigger.type === 'numericThreshold' && (
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} flexWrap="wrap" useFlexGap>
          <DeviceSelect
            devices={ctx.devices}
            value={trigger.deviceId}
            filter={(d) => numericOptionsFor(d).length > 0}
            onChange={(id) => {
              const o = numericOptionsFor(ctx.devices.find((x) => x.id === id))[0];
              onChange({ ...trigger, deviceId: id, attribute: o?.attribute ?? 'batteryLevel', measurementKey: o?.measurementKey });
            }}
          />
          {sel('Reading', numericKey(trigger), numericOptionsFor(device).map((o) => ({ value: numericKey(o), label: `${o.label}${o.unit ? ` (${o.unit})` : ''}` })), (k) => {
            const o = numericOptionsFor(device).find((x) => numericKey(x) === k);
            if (o) onChange({ ...trigger, attribute: o.attribute, measurementKey: o.measurementKey });
          })}
          {numField('Above', trigger.above, (v) => onChange({ ...trigger, above: v }))}
          {numField('Below', trigger.below, (v) => onChange({ ...trigger, below: v }))}
        </Stack>
      )}
      {trigger.type === 'numericThreshold' && (
        <Typography variant="caption">Fires once when the reading enters the range, not continuously while it stays there.</Typography>
      )}
      {trigger.type === 'connectivity' && (
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
          <DeviceSelect devices={ctx.devices} value={trigger.deviceId} onChange={(id) => onChange({ ...trigger, deviceId: id })} />
          {sel('Goes', trigger.to, ['online', 'offline', 'unavailable'].map((v) => ({ value: v, label: v })), (v) => onChange({ ...trigger, to: v as typeof trigger.to }))}
        </Stack>
      )}
      {trigger.type === 'integrationEvent' && (
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
          {sel('Integration', trigger.integrationId, ctx.integrations.map((i) => ({ value: i.id, label: i.name })), (v) => onChange({ ...trigger, integrationId: v }), 200)}
          <TextField size="small" label="Event type" value={trigger.eventType} onChange={(e) => onChange({ ...trigger, eventType: e.target.value })} helperText="As reported by the integration, e.g. call_service" sx={{ maxWidth: { sm: 260 } }} />
        </Stack>
      )}
    </Stack>
  );
}

// ─── Conditions ────────────────────────────────────────────────────────────

export const CONDITION_TYPES: { value: AutomationCondition['type']; label: string }[] = [
  { value: 'timeWindow', label: 'Time window' },
  { value: 'deviceState', label: 'Device state' },
  { value: 'numericState', label: 'Sensor / numeric value' },
  { value: 'roomState', label: 'Room state' },
  { value: 'presence', label: 'Presence' },
  { value: 'securityState', label: 'Alarm state' },
  { value: 'group', label: 'Group (AND / OR)' },
];

export function defaultCondition(type: AutomationCondition['type'], ctx: EditorContext): AutomationCondition {
  switch (type) {
    case 'timeWindow': return { type, after: '22:00', before: '06:00' };
    case 'deviceState': {
      const d = ctx.devices.find((x) => watchableFor(x).length);
      const attr = watchableFor(d)[0] ?? 'on';
      return { type, deviceId: d?.id ?? '', attribute: attr, equals: attributeValues(d, attr)[0]?.value ?? true };
    }
    case 'numericState': {
      const d = ctx.devices.find((x) => numericOptionsFor(x).length);
      const o = numericOptionsFor(d)[0];
      return { type, deviceId: d?.id ?? '', attribute: o?.attribute ?? 'batteryLevel', measurementKey: o?.measurementKey, above: 0 };
    }
    case 'roomState': return { type, roomId: ctx.rooms[0]?.id ?? '', anyOn: true };
    case 'presence': return { type, anyoneHome: true };
    case 'securityState': return { type, deviceId: ctx.devices.find((d) => d.capabilities.some((c) => c.type === 'alarmPanel'))?.id ?? '', alarmState: 'armed_away' };
    case 'group': return { type, operator: 'or', conditions: [{ type: 'presence', anyoneHome: true }] };
  }
}

export function ConditionEditor({ condition, onChange, ctx, depth = 0 }: { condition: AutomationCondition; onChange: (c: AutomationCondition) => void; ctx: EditorContext; depth?: number }) {
  const c = condition;
  const device = 'deviceId' in c ? ctx.devices.find((d) => d.id === c.deviceId) : undefined;
  const types = depth >= 1 ? CONDITION_TYPES.filter((t) => t.value !== 'group') : CONDITION_TYPES;
  return (
    <Stack spacing={1.5}>
      {sel('Only if', c.type, types, (t) => onChange(defaultCondition(t as AutomationCondition['type'], ctx)), 220)}
      {c.type === 'timeWindow' && (
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems={{ sm: 'center' }} flexWrap="wrap" useFlexGap>
          <TextField size="small" type="time" label="After" value={c.after} onChange={(e) => onChange({ ...c, after: e.target.value })} InputLabelProps={{ shrink: true }} sx={{ width: { xs: '100%', sm: 130 } }} />
          <TextField size="small" type="time" label="Before" value={c.before} onChange={(e) => onChange({ ...c, before: e.target.value })} InputLabelProps={{ shrink: true }} sx={{ width: { xs: '100%', sm: 130 } }} />
          <DayChips days={c.days ?? [0, 1, 2, 3, 4, 5, 6]} onChange={(days) => onChange({ ...c, days: days.length === 7 ? undefined : days })} />
        </Stack>
      )}
      {c.type === 'deviceState' && (
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} flexWrap="wrap" useFlexGap>
          <DeviceSelect
            devices={ctx.devices}
            value={c.deviceId}
            filter={(d) => watchableFor(d).length > 0}
            onChange={(id) => {
              const d = ctx.devices.find((x) => x.id === id);
              const attr = watchableFor(d)[0] ?? 'on';
              onChange({ ...c, deviceId: id, attribute: attr, equals: attributeValues(d, attr)[0]?.value ?? true });
            }}
          />
          {sel('Attribute', c.attribute, watchableFor(device).map((a) => ({ value: a, label: ATTRIBUTE_LABEL[a] ?? a })), (a) =>
            onChange({ ...c, attribute: a as typeof c.attribute, equals: attributeValues(device, a)[0]?.value ?? true }),
          )}
          {sel('Is', String(c.equals), attributeValues(device, c.attribute).map((o) => ({ value: String(o.value), label: o.label })), (v) =>
            onChange({ ...c, equals: v === 'true' ? true : v === 'false' ? false : v }),
          )}
        </Stack>
      )}
      {c.type === 'numericState' && (
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} flexWrap="wrap" useFlexGap>
          <DeviceSelect devices={ctx.devices} value={c.deviceId} filter={(d) => numericOptionsFor(d).length > 0} onChange={(id) => {
            const o = numericOptionsFor(ctx.devices.find((x) => x.id === id))[0];
            onChange({ ...c, deviceId: id, attribute: o?.attribute ?? 'batteryLevel', measurementKey: o?.measurementKey });
          }} />
          {sel('Reading', numericKey(c), numericOptionsFor(device).map((o) => ({ value: numericKey(o), label: `${o.label}${o.unit ? ` (${o.unit})` : ''}` })), (k) => {
            const o = numericOptionsFor(device).find((x) => numericKey(x) === k);
            if (o) onChange({ ...c, attribute: o.attribute, measurementKey: o.measurementKey });
          })}
          {numField('Above', c.above, (v) => onChange({ ...c, above: v }))}
          {numField('Below', c.below, (v) => onChange({ ...c, below: v }))}
        </Stack>
      )}
      {c.type === 'roomState' && (
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
          {sel('Room', c.roomId, ctx.rooms.map((r) => ({ value: r.id, label: r.name })), (v) => onChange({ ...c, roomId: v }), 200)}
          {sel('Has', String(c.anyOn), [{ value: 'true', label: 'Something on' }, { value: 'false', label: 'Everything off' }], (v) => onChange({ ...c, anyOn: v === 'true' }))}
        </Stack>
      )}
      {c.type === 'presence' && sel('Presence', String(c.anyoneHome), [{ value: 'true', label: 'Someone is home' }, { value: 'false', label: 'Nobody is home' }], (v) => onChange({ ...c, anyoneHome: v === 'true' }), 200)}
      {c.type === 'presence' && !ctx.devices.some((d) => d.capabilities.some((x) => x.type === 'presence')) && (
        <Alert severity="info">No presence devices are connected, so this condition can never be met.</Alert>
      )}
      {c.type === 'securityState' && (
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
          <DeviceSelect devices={ctx.devices} value={c.deviceId} label="Alarm panel" filter={(d) => d.capabilities.some((x) => x.type === 'alarmPanel')} onChange={(id) => onChange({ ...c, deviceId: id })} />
          {sel('State', c.alarmState, ALARM_STATES.map((s) => ({ value: s, label: s.replace('_', ' ') })), (v) => onChange({ ...c, alarmState: v }))}
        </Stack>
      )}
      {c.type === 'group' && (
        <Box sx={{ pl: { xs: 1, sm: 2 }, borderLeft: `3px solid ${tokens.color.sage}` }}>
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
            <Typography variant="body2">Match</Typography>
            <ToggleButtonGroup size="small" exclusive value={c.operator} onChange={(_, v) => v && onChange({ ...c, operator: v })} aria-label="Group operator">
              <ToggleButton value="and">All (AND)</ToggleButton>
              <ToggleButton value="or">Any (OR)</ToggleButton>
            </ToggleButtonGroup>
          </Stack>
          <Stack spacing={1}>
            {c.conditions.map((sub, i) => (
              <ItemRow key={i} index={i} count={c.conditions.length} label="grouped condition" onRemove={() => c.conditions.length > 1 && onChange({ ...c, conditions: c.conditions.filter((_, j) => j !== i) })}>
                <ConditionEditor condition={sub} ctx={ctx} depth={depth + 1} onChange={(n) => onChange({ ...c, conditions: c.conditions.map((x, j) => (j === i ? n : x)) })} />
              </ItemRow>
            ))}
            <Button size="small" startIcon={<Plus size={14} />} sx={{ alignSelf: 'flex-start' }} onClick={() => onChange({ ...c, conditions: [...c.conditions, defaultCondition('presence', ctx)] })}>
              Add to group
            </Button>
          </Stack>
        </Box>
      )}
    </Stack>
  );
}

// ─── Actions ───────────────────────────────────────────────────────────────

export const ACTION_TYPES: { value: AutomationAction['type']; label: string }[] = [
  { value: 'deviceCommand', label: 'Control a device' },
  { value: 'activateScene', label: 'Activate a scene' },
  { value: 'notify', label: 'Send an in-app notification' },
  { value: 'delay', label: 'Wait' },
  { value: 'runAutomation', label: 'Run another automation' },
];

export function defaultAction(type: AutomationAction['type'], ctx: EditorContext): AutomationAction {
  switch (type) {
    case 'deviceCommand': return { type, deviceId: '', command: { capability: 'onOff', action: 'turnOn' } };
    case 'activateScene': return { type, sceneId: ctx.scenes[0]?.id ?? '' };
    case 'notify': return { type, title: '', message: '', severity: 'info' };
    case 'delay': return { type, seconds: 30 };
    case 'runAutomation': return { type, automationId: ctx.automations.find((a) => a.executor === 'smartnest' && a.id !== ctx.selfId)?.id ?? '' };
  }
}

export function ActionEditor({ action, onChange, ctx }: { action: AutomationAction; onChange: (a: AutomationAction) => void; ctx: EditorContext }) {
  const a = action;
  return (
    <Stack spacing={1.5}>
      {sel('Then', a.type, ACTION_TYPES, (t) => onChange(defaultAction(t as AutomationAction['type'], ctx)), 220)}
      {a.type === 'deviceCommand' && <CommandBuilder devices={ctx.devices} deviceId={a.deviceId} command={a.deviceId ? a.command : undefined} onChange={(deviceId, command) => onChange({ ...a, deviceId, command })} />}
      {a.type === 'activateScene' && (ctx.scenes.length ? sel('Scene', a.sceneId, ctx.scenes.map((s) => ({ value: s.id, label: s.name })), (v) => onChange({ ...a, sceneId: v }), 220) : <Alert severity="info">There are no scenes yet.</Alert>)}
      {a.type === 'notify' && (
        <Stack spacing={1.5}>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
            <TextField size="small" label="Title" value={a.title} onChange={(e) => onChange({ ...a, title: e.target.value })} inputProps={{ maxLength: 120 }} />
            {sel('Severity', a.severity, [{ value: 'info', label: 'Info' }, { value: 'warning', label: 'Warning' }, { value: 'critical', label: 'Critical' }], (v) => onChange({ ...a, severity: v as typeof a.severity }), 140)}
          </Stack>
          <TextField size="small" label="Message" value={a.message} onChange={(e) => onChange({ ...a, message: e.target.value })} multiline minRows={2} inputProps={{ maxLength: 500 }} />
          <Typography variant="caption">Delivered in-app to household members who have permission. Email/push are not configured.</Typography>
        </Stack>
      )}
      {a.type === 'delay' && numField('Seconds', a.seconds, (v) => onChange({ ...a, seconds: Math.max(1, Math.min(3600, Math.round(v ?? 1))) }), { min: 1, max: 3600, required: true })}
      {a.type === 'runAutomation' && (
        <Stack spacing={1}>
          {sel(
            'Automation',
            a.automationId,
            ctx.automations.filter((x) => x.executor === 'smartnest' && x.id !== ctx.selfId).map((x) => ({ value: x.id, label: x.name })),
            (v) => onChange({ ...a, automationId: v }),
            220,
          )}
          <Typography variant="caption">Nesting is limited to 3 levels and cycles are rejected.</Typography>
        </Stack>
      )}
    </Stack>
  );
}

export function SectionHeading({ title, hint, count }: { title: string; hint?: string; count?: number }) {
  return (
    <Box sx={{ mb: 1.5 }}>
      <Stack direction="row" spacing={1} alignItems="center">
        <Typography variant="h4" component="h2">
          {title}
        </Typography>
        {count !== undefined && <Chip size="small" label={count} />}
      </Stack>
      {hint && (
        <Typography variant="body2" color="text.secondary">
          {hint}
        </Typography>
      )}
    </Box>
  );
}

import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import { useMemo, useState } from 'react';
import {
  Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, FormControl, IconButton, InputLabel, List, ListItem, ListItemText, MenuItem, Select, Stack,
  Skeleton, Tooltip, Typography, useMediaQuery, useTheme,
} from '@mui/material';
import { motion } from 'framer-motion';
import { ArrowDown, ArrowUp, Check, EyeOff, GripVertical, LayoutGrid, Plus, RotateCcw, Settings2, X } from 'lucide-react';
import { Responsive, WidthProvider, type Layout, type Layouts } from 'react-grid-layout';
import { WIDGET_DEFINITIONS, WIDGET_TYPES, validateDashboardLayout, type DashboardWidget, type LayoutIssue, type WidgetType } from '@smartnest/shared';
import { toApiError, useDashboardQuery, useDevicesQuery, useMeQuery, useResetDashboardMutation, useSaveDashboardMutation } from '../../api/api';
import { useHome } from '../../app/hooks';
import { pushToast, useAppDispatch } from '../../app/store';
import { useConfirm } from '../../components/common/Dialogs';
import { ErrorState, PageHeader, SummaryCardsSkeleton } from '../../components/common/States';
import { DemoBadge } from '../../components/common/StatusBadge';
import { tokens } from '../../theme/theme';
import { addOrShowWidget, byPosition, clampWidget, compactLayout, deriveMediumLayout, moveWidget } from './layout';
import { CONFIGURABLE_DEVICE, WIDGET_COMPONENTS } from './widgets/registry';
import { WidgetContext } from './widgets/WidgetFrame';

const ResponsiveGrid = WidthProvider(Responsive);
const ROW_HEIGHT = 80;
const MARGIN: [number, number] = [16, 16];

function greeting(timezone: string): string {
  let hour = new Date().getHours();
  try {
    hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', hourCycle: 'h23' }).format(new Date()));
  } catch {
    /* fall back to local time */
  }
  return hour < 5 ? 'Good night' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
}

interface EditActions {
  onMove: (id: string, dir: -1 | 1) => void;
  onHide: (id: string) => void;
  onRemove: (id: string) => void;
  onConfigure: (id: string) => void;
}

/** Edit-mode chrome over a widget. The overlay doubles as drag handle and blocks device controls while arranging. */
function EditOverlay({ widget, index, count, actions, draggable }: { widget: DashboardWidget; index: number; count: number; actions: EditActions; draggable: boolean }) {
  const title = WIDGET_DEFINITIONS[widget.type].title;
  return (
    <Box
      className={draggable ? 'widget-drag-handle' : undefined}
      sx={{
        position: 'absolute', inset: 0, zIndex: 2, borderRadius: `${tokens.radius.lg}px`, border: `2px dashed ${tokens.color.primary}`, bgcolor: 'rgba(247,246,240,0.55)',
        cursor: draggable ? 'grab' : 'default', '&:active': { cursor: draggable ? 'grabbing' : 'default' },
      }}
    >
      <Stack
        direction="row"
        alignItems="center"
        spacing={0.25}
        className="widget-no-drag"
        sx={{ position: 'absolute', top: 8, right: 8, bgcolor: 'background.paper', borderRadius: 999, boxShadow: tokens.shadow.raised, px: 0.5, cursor: 'default' }}
      >
        {draggable && (
          <Tooltip title="Drag the widget to move it; drag the corner to resize">
            <Box sx={{ display: 'grid', placeItems: 'center', px: 0.5, color: 'text.secondary' }} aria-hidden>
              <GripVertical size={16} />
            </Box>
          </Tooltip>
        )}
        <IconButton size="small" aria-label={`Move ${title} earlier`} disabled={index === 0} onClick={() => actions.onMove(widget.id, -1)}>
          <ArrowUp size={16} />
        </IconButton>
        <IconButton size="small" aria-label={`Move ${title} later`} disabled={index === count - 1} onClick={() => actions.onMove(widget.id, 1)}>
          <ArrowDown size={16} />
        </IconButton>
        <IconButton size="small" aria-label={`Configure ${title}`} onClick={() => actions.onConfigure(widget.id)}>
          <Settings2 size={16} />
        </IconButton>
        <IconButton size="small" aria-label={`Hide ${title}`} onClick={() => actions.onHide(widget.id)}>
          <EyeOff size={16} />
        </IconButton>
        <IconButton size="small" aria-label={`Remove ${title}`} onClick={() => actions.onRemove(widget.id)} sx={{ color: 'error.main' }}>
          <X size={16} />
        </IconButton>
      </Stack>
      <Typography variant="caption" sx={{ position: 'absolute', bottom: 8, left: 12, fontWeight: 700, color: 'primary.dark', bgcolor: 'background.paper', px: 1, borderRadius: 1 }}>
        {title} · {widget.w}×{widget.h}
      </Typography>
    </Box>
  );
}

function WidgetView({ widget }: { widget: DashboardWidget }) {
  const C = WIDGET_COMPONENTS[widget.type];
  return <C widget={widget} />;
}

function AddWidgetDialog({ open, widgets, onClose, onAdd }: { open: boolean; widgets: DashboardWidget[]; onClose: () => void; onAdd: (t: WidgetType) => void }) {
  const visible = new Set(widgets.filter((w) => !w.hidden).map((w) => w.type));
  const available = WIDGET_TYPES.filter((t) => !visible.has(t));
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm" aria-labelledby="add-widget-title">
      <DialogTitle id="add-widget-title">Add a widget</DialogTitle>
      <DialogContent>
        {!available.length ? (
          <Typography color="text.secondary">Every widget is already on your dashboard.</Typography>
        ) : (
          <List disablePadding>
            {available.map((t) => {
              const def = WIDGET_DEFINITIONS[t];
              const hidden = widgets.some((w) => w.type === t && w.hidden);
              return (
                <ListItem
                  key={t}
                  divider
                  secondaryAction={
                    <Button size="small" variant="outlined" startIcon={<Plus size={14} />} onClick={() => onAdd(t)} aria-label={`${hidden ? 'Show' : 'Add'} ${def.title}`}>
                      {hidden ? 'Show' : 'Add'}
                    </Button>
                  }
                >
                  <ListItemText primary={def.title} secondary={`${def.description}${hidden ? ' (currently hidden)' : ''}`} sx={{ pr: 10 }} />
                </ListItem>
              );
            })}
          </List>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose}>Done</Button>
      </DialogActions>
    </Dialog>
  );
}

function ConfigureDialog({ widget, onClose, onApply }: { widget: DashboardWidget | null; onClose: () => void; onApply: (w: DashboardWidget) => void }) {
  const { homeId } = useHome();
  const [draft, setDraft] = useState<DashboardWidget | null>(widget);
  const [lastId, setLastId] = useState<string | null>(null);
  if (widget && widget.id !== lastId) {
    setLastId(widget.id);
    setDraft(widget);
  }
  const deviceCfg = widget ? CONFIGURABLE_DEVICE[widget.type] : undefined;
  const devices = useDevicesQuery({ homeId, capability: deviceCfg?.capability, pageSize: 100 }, { skip: !deviceCfg });
  if (!widget || !draft) return null;
  const def = WIDGET_DEFINITIONS[widget.type];
  const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs" aria-labelledby="configure-widget-title">
      <DialogTitle id="configure-widget-title">Configure “{def.title}”</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {deviceCfg && (
            <FormControl fullWidth size="small">
              <InputLabel id="cfg-device">{deviceCfg.label}</InputLabel>
              <Select
                labelId="cfg-device"
                label={deviceCfg.label}
                value={typeof draft.config.deviceId === 'string' ? draft.config.deviceId : ''}
                onChange={(e) => setDraft({ ...draft, config: { ...draft.config, deviceId: e.target.value ? String(e.target.value) : null } })}
              >
                <MenuItem value="">Automatic (first available)</MenuItem>
                {devices.data?.items.map((d) => (
                  <MenuItem key={d.id} value={d.id}>
                    {d.name}
                    {d.roomName ? ` · ${d.roomName}` : ''}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          )}
          <Stack direction="row" spacing={2}>
            <FormControl fullWidth size="small">
              <InputLabel id="cfg-w">Width (columns)</InputLabel>
              <Select labelId="cfg-w" label="Width (columns)" value={draft.w} onChange={(e) => setDraft({ ...draft, w: Number(e.target.value) })}>
                {range(def.minSize.w, Math.min(12, def.maxSize.w)).map((n) => (
                  <MenuItem key={n} value={n}>
                    {n} of 12
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <FormControl fullWidth size="small">
              <InputLabel id="cfg-h">Height (rows)</InputLabel>
              <Select labelId="cfg-h" label="Height (rows)" value={draft.h} onChange={(e) => setDraft({ ...draft, h: Number(e.target.value) })}>
                {range(def.minSize.h, def.maxSize.h).map((n) => (
                  <MenuItem key={n} value={n}>
                    {n}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Stack>
          <Typography variant="caption">Sizes are limited to what this widget supports. Widgets below move down automatically so nothing overlaps.</Typography>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={() => onApply(draft)}>
          Apply
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function DashboardSkeleton() {
  return (
    <Stack spacing={2} aria-busy aria-label="Loading dashboard">
      <SummaryCardsSkeleton />
      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', md: '2fr 1fr' } }}>
        <Skeleton variant="rounded" height={368} />
        <Skeleton variant="rounded" height={368} />
      </Box>
      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', md: '5fr 3fr 4fr' } }}>
        <Skeleton variant="rounded" height={368} />
        <Skeleton variant="rounded" height={368} />
        <Skeleton variant="rounded" height={368} />
      </Box>
    </Stack>
  );
}

export default function OverviewPage() {
  const { homeId, home } = useHome();
  const me = useMeQuery();
  const theme = useTheme();
  const stacked = useMediaQuery(theme.breakpoints.down('md'));
  const dispatch = useAppDispatch();
  const confirm = useConfirm();
  const dash = useDashboardQuery(homeId);
  const [save, { isLoading: saving }] = useSaveDashboardMutation();
  const [reset] = useResetDashboardMutation();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<DashboardWidget[]>([]);
  const [issues, setIssues] = useState<LayoutIssue[]>([]);
  const [addOpen, setAddOpen] = useState(false);
  const [configId, setConfigId] = useState<string | null>(null);
  const [breakpoint, setBreakpoint] = useState('lg');

  const widgets = useMemo(() => (editing ? draft : (dash.data?.widgets ?? [])), [editing, draft, dash.data]);
  const visible = useMemo(() => widgets.filter((w) => !w.hidden).sort(byPosition), [widgets]);

  const layouts: Layouts = useMemo(
    () => ({
      lg: visible.map((w) => {
        const def = WIDGET_DEFINITIONS[w.type];
        return { i: w.id, x: w.x, y: w.y, w: w.w, h: w.h, minW: def.minSize.w, minH: def.minSize.h, maxW: Math.min(12, def.maxSize.w), maxH: def.maxSize.h };
      }),
      md: deriveMediumLayout(visible),
    }),
    [visible],
  );

  const startEditing = () => {
    setDraft(compactLayout(dash.data?.widgets ?? []));
    setIssues([]);
    setEditing(true);
  };

  const onLayoutChange = (_current: Layout[], all: Layouts) => {
    if (!editing || breakpoint !== 'lg' || !all.lg) return;
    const byId = new Map(all.lg.map((l) => [l.i, l]));
    let changed = false;
    const next = draft.map((w) => {
      const l = byId.get(w.id);
      if (!l || w.hidden || (l.x === w.x && l.y === w.y && l.w === w.w && l.h === w.h)) return w;
      changed = true;
      return clampWidget({ ...w, x: l.x, y: l.y, w: l.w, h: l.h });
    });
    if (changed) setDraft(next);
  };

  const actions: EditActions = {
    onMove: (id, dir) => setDraft((d) => moveWidget(d, id, dir)),
    onHide: (id) => setDraft((d) => compactLayout(d.map((w) => (w.id === id ? { ...w, hidden: true } : w)))),
    onRemove: (id) => setDraft((d) => compactLayout(d.filter((w) => w.id !== id))),
    onConfigure: (id) => setConfigId(id),
  };

  const saveLayout = async () => {
    const final = compactLayout(draft);
    const problems = validateDashboardLayout(final);
    setIssues(problems);
    if (problems.length) return;
    try {
      await save({ homeId, widgets: final }).unwrap();
      setEditing(false);
      dispatch(pushToast({ message: 'Dashboard layout saved', severity: 'success' }));
    } catch (e) {
      const err = toApiError(e);
      setIssues([{ widgetId: '', message: err.message }]);
    }
  };

  const resetLayout = async () => {
    const ok = await confirm({ title: 'Reset dashboard?', message: 'Your custom layout for this home will be replaced with the default layout.', confirmLabel: 'Reset layout', tone: 'danger' });
    if (!ok) return;
    try {
      await reset(homeId).unwrap();
      setEditing(false);
      dispatch(pushToast({ message: 'Dashboard reset to the default layout', severity: 'success' }));
    } catch (e) {
      dispatch(pushToast({ message: toApiError(e).message, severity: 'error' }));
    }
  };

  const firstName = me.data?.user.name.split(' ')[0];
  const header = (
    <PageHeader
      eyebrow={home.isDemo ? <DemoBadge /> : undefined}
      title={`${greeting(home.timezone)}${firstName ? `, ${firstName}` : ''}`}
      subtitle={`Here's what's happening at ${home.name}.`}
      actions={
        editing ? (
          <>
            <Button variant="outlined" startIcon={<Plus size={16} />} onClick={() => setAddOpen(true)}>
              Add widget
            </Button>
            <Button startIcon={<RotateCcw size={16} />} onClick={() => void resetLayout()}>
              Reset to default
            </Button>
            <Button onClick={() => setEditing(false)}>Cancel</Button>
            <Button variant="contained" startIcon={<Check size={16} />} onClick={() => void saveLayout()} disabled={saving}>
              {saving ? 'Saving…' : 'Save layout'}
            </Button>
          </>
        ) : (
          <Button variant="outlined" startIcon={<LayoutGrid size={16} />} onClick={startEditing} disabled={!dash.data}>
            Customise
          </Button>
        )
      }
    />
  );

  if (dash.isLoading) {
    return (
      <>
        {header}
        <DashboardSkeleton />
      </>
    );
  }
  if (dash.error || !dash.data) {
    return (
      <>
        {header}
        <ErrorState error={dash.error} onRetry={dash.refetch} title="Could not load your dashboard" />
      </>
    );
  }

  const configWidget = configId ? (draft.find((w) => w.id === configId) ?? null) : null;

  return (
    <Box>
      {header}
      {editing && (
        <Alert severity="info" sx={{ mb: 2 }}>
          {stacked
            ? 'Use the arrows to reorder widgets. Drag-and-drop resizing is available on wider screens.'
            : breakpoint === 'lg'
              ? 'Drag widgets to rearrange them and drag the bottom-right corner to resize. Keyboard users can use the arrow and settings buttons on each widget.'
              : 'Your window is narrow, so drag-and-drop is paused. Use the arrows and settings buttons, or widen the window.'}
        </Alert>
      )}
      {issues.length > 0 && (
        <Alert severity="error" sx={{ mb: 2 }}>
          The layout can't be saved: {issues.map((i) => i.message).join(' ')}
        </Alert>
      )}
      {!visible.length && (
        <Alert severity="info" action={<Button onClick={editing ? () => setAddOpen(true) : startEditing}>Add widgets</Button>}>
          Your dashboard is empty.
        </Alert>
      )}

      <WidgetContext.Provider value={{ stacked }}>
        {stacked ? (
          <Stack spacing={2}>
            {visible.map((w, i) => (
              <motion.div key={w.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: tokens.motion.base, delay: Math.min(i, 6) * 0.03 }} style={{ position: 'relative' }}>
                <WidgetView widget={w} />
                {editing && <EditOverlay widget={w} index={i} count={visible.length} actions={actions} draggable={false} />}
              </motion.div>
            ))}
          </Stack>
        ) : (
          <Box sx={{ mx: `-${MARGIN[0]}px`, mt: `-${MARGIN[1]}px` }}>
            <ResponsiveGrid
              layouts={layouts}
              breakpoints={{ lg: 1000, md: 0 }}
              cols={{ lg: 12, md: 6 }}
              rowHeight={ROW_HEIGHT}
              margin={MARGIN}
              containerPadding={MARGIN}
              compactType="vertical"
              preventCollision={false}
              isDraggable={editing && breakpoint === 'lg'}
              isResizable={editing && breakpoint === 'lg'}
              draggableHandle=".widget-drag-handle"
              draggableCancel=".widget-no-drag"
              resizeHandles={['se']}
              onBreakpointChange={(bp) => setBreakpoint(bp)}
              onLayoutChange={onLayoutChange}
              useCSSTransforms
            >
              {visible.map((w, i) => (
                <div key={w.id} style={{ position: 'relative' }}>
                  <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: tokens.motion.base, delay: Math.min(i, 8) * 0.03 }} style={{ height: '100%' }}>
                    <WidgetView widget={w} />
                  </motion.div>
                  {editing && <EditOverlay widget={w} index={i} count={visible.length} actions={actions} draggable={breakpoint === 'lg'} />}
                </div>
              ))}
            </ResponsiveGrid>
          </Box>
        )}
      </WidgetContext.Provider>

      <AddWidgetDialog
        open={addOpen}
        widgets={draft}
        onClose={() => setAddOpen(false)}
        onAdd={(t) => {
          setDraft((d) => addOrShowWidget(d, t));
        }}
      />
      <ConfigureDialog
        widget={configWidget}
        onClose={() => setConfigId(null)}
        onApply={(w) => {
          setDraft((d) => compactLayout(d.map((x) => (x.id === w.id ? clampWidget(w) : x))));
          setConfigId(null);
        }}
      />
    </Box>
  );
}

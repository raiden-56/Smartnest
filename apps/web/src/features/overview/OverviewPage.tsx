import { useLayoutEffect, useMemo, useState } from 'react';
import {
  Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, FormControl, IconButton, InputLabel, List, ListItem, ListItemText, MenuItem, Select, Skeleton, Stack, Tooltip,
  Typography,
} from '@mui/material';
import { motion } from 'framer-motion';
import { ArrowDown, ArrowUp, Check, Columns2, EyeOff, LayoutGrid, PanelLeft, PanelRight, Plus, RectangleHorizontal, RotateCcw, Settings2, X } from 'lucide-react';
import { WIDGET_DEFINITIONS, WIDGET_TYPES, validateDashboardLayout, type DashboardWidget, type LayoutIssue, type WidgetType } from '@smartnest/shared';
import { toApiError, useDashboardQuery, useDevicesQuery, useMeQuery, useResetDashboardMutation, useSaveDashboardMutation } from '../../api/api';
import { useHome } from '../../app/hooks';
import { pushToast, useAppDispatch } from '../../app/store';
import { useConfirm } from '../../components/common/Dialogs';
import { ErrorState, PageHeader } from '../../components/common/States';
import { tokens } from '../../theme/theme';
import { addOrShowWidget, canBeFull, hideWidget, mainRows, moveWidget, normalizeLayout, readBoard, removeWidget, switchColumn, toggleWidth, type Placed, type Zone } from './layout';
import { CONFIGURABLE_DEVICE, WIDGET_COMPONENTS } from './widgets/registry';
import { WidgetContext } from './widgets/WidgetFrame';

const GAP = 2; // theme spacing units between widgets (16px)

function greeting(timezone: string): string {
  let hour = new Date().getHours();
  try {
    hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', hourCycle: 'h23' }).format(new Date()));
  } catch {
    /* fall back to local time */
  }
  return hour < 5 ? 'Good night' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
}

/** Width of an element, kept up to date — the board adapts to the space it has, not to the window. */
function useElementWidth() {
  const [el, setEl] = useState<HTMLElement | null>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    if (!el) return;
    setWidth(el.clientWidth);
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([entry]) => entry && setWidth(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return [setEl, width] as const;
}

interface EditActions {
  onMove: (id: string, dir: -1 | 1) => void;
  onSwitchColumn: (id: string) => void;
  onToggleWidth: (id: string) => void;
  onHide: (id: string) => void;
  onRemove: (id: string) => void;
  onConfigure: (id: string) => void;
}

interface SlotInfo {
  zone: Zone | 'summary';
  half: boolean;
  first: boolean;
  last: boolean;
}

/** Edit-mode chrome over a widget. It also blocks the widget's own controls while arranging. */
function EditOverlay({ widget, info, actions }: { widget: DashboardWidget; info: SlotInfo; actions: EditActions }) {
  const title = WIDGET_DEFINITIONS[widget.type].title;
  const tool = (label: string, icon: React.ReactNode, onClick: () => void, opts: { disabled?: boolean; danger?: boolean } = {}) => (
    <Tooltip title={label}>
      <span>
        <IconButton size="small" aria-label={`${label}: ${title}`} disabled={opts.disabled} onClick={onClick} sx={opts.danger ? { color: 'error.main' } : undefined}>
          {icon}
        </IconButton>
      </span>
    </Tooltip>
  );
  const where = info.zone === 'summary' ? 'Summary strip' : info.zone === 'side' ? 'Side column' : `Main column · ${info.half ? 'half' : 'full'} width`;
  return (
    <Box sx={{ position: 'absolute', inset: 0, zIndex: 2, borderRadius: `${tokens.radius.lg}px`, border: `2px dashed ${tokens.color.primary}`, bgcolor: 'rgba(247,246,240,0.6)' }}>
      <Stack direction="row" alignItems="center" spacing={0.25} sx={{ position: 'absolute', top: 6, right: 6, bgcolor: 'background.paper', borderRadius: 999, boxShadow: tokens.shadow.raised, px: 0.5 }}>
        {info.zone !== 'summary' && (
          <>
            {tool('Move up', <ArrowUp size={16} />, () => actions.onMove(widget.id, -1), { disabled: info.first })}
            {tool('Move down', <ArrowDown size={16} />, () => actions.onMove(widget.id, 1), { disabled: info.last })}
            {info.zone === 'main'
              ? tool('Move to side column', <PanelRight size={16} />, () => actions.onSwitchColumn(widget.id))
              : tool('Move to main column', <PanelLeft size={16} />, () => actions.onSwitchColumn(widget.id))}
            {info.zone === 'main' &&
              canBeFull(widget.type) &&
              (info.half ? tool('Make full width', <RectangleHorizontal size={16} />, () => actions.onToggleWidth(widget.id)) : tool('Make half width', <Columns2 size={16} />, () => actions.onToggleWidth(widget.id)))}
          </>
        )}
        {CONFIGURABLE_DEVICE[widget.type] && tool('Choose device', <Settings2 size={16} />, () => actions.onConfigure(widget.id))}
        {tool('Hide', <EyeOff size={16} />, () => actions.onHide(widget.id))}
        {tool('Remove', <X size={16} />, () => actions.onRemove(widget.id), { danger: true })}
      </Stack>
      <Typography variant="caption" sx={{ position: 'absolute', bottom: 8, left: 12, fontWeight: 700, color: 'primary.dark', bgcolor: 'background.paper', px: 1, borderRadius: 1 }}>
        {title} · {where}
      </Typography>
    </Box>
  );
}

function Slot({ widget, index, info, editing, actions }: { widget: DashboardWidget; index: number; info: SlotInfo; editing: boolean; actions: EditActions }) {
  const C = WIDGET_COMPONENTS[widget.type];
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: tokens.motion.base, delay: Math.min(index, 8) * 0.025 }}
      style={{ position: 'relative', minWidth: 0, height: '100%', minHeight: editing ? 120 : undefined }}
    >
      <WidgetContext.Provider value={{ type: widget.type }}>
        <C widget={widget} />
      </WidgetContext.Provider>
      {editing && <EditOverlay widget={widget} info={info} actions={actions} />}
    </motion.div>
  );
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
  const [deviceId, setDeviceId] = useState('');
  const [lastId, setLastId] = useState<string | null>(null);
  if (widget && widget.id !== lastId) {
    setLastId(widget.id);
    setDeviceId(typeof widget.config.deviceId === 'string' ? widget.config.deviceId : '');
  }
  const cfg = widget ? CONFIGURABLE_DEVICE[widget.type] : undefined;
  const devices = useDevicesQuery({ homeId, capability: cfg?.capability, pageSize: 100 }, { skip: !cfg });
  if (!widget || !cfg) return null;
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs" aria-labelledby="configure-widget-title">
      <DialogTitle id="configure-widget-title">Configure “{WIDGET_DEFINITIONS[widget.type].title}”</DialogTitle>
      <DialogContent>
        <FormControl fullWidth size="small" sx={{ mt: 1 }}>
          <InputLabel id="cfg-device">{cfg.label}</InputLabel>
          <Select labelId="cfg-device" label={cfg.label} value={deviceId} onChange={(e) => setDeviceId(String(e.target.value))}>
            <MenuItem value="">Automatic (first available)</MenuItem>
            {devices.data?.items.map((d) => (
              <MenuItem key={d.id} value={d.id}>
                {d.name}
                {d.roomName ? ` · ${d.roomName}` : ''}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={() => onApply({ ...widget, config: { ...widget.config, deviceId: deviceId || null } })}>
          Apply
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function DashboardSkeleton() {
  return (
    <Stack spacing={GAP} aria-busy aria-label="Loading dashboard">
      <Box sx={{ display: 'grid', gap: 1.25, gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} variant="rounded" height={58} />
        ))}
      </Box>
      <Box sx={{ display: 'grid', gap: GAP, gridTemplateColumns: { xs: '1fr', lg: 'minmax(0, 1fr) 340px' } }}>
        <Stack spacing={GAP}>
          <Skeleton variant="rounded" height={210} />
          <Skeleton variant="rounded" height={300} />
        </Stack>
        <Stack spacing={GAP}>
          <Skeleton variant="rounded" height={180} />
          <Skeleton variant="rounded" height={260} />
        </Stack>
      </Box>
    </Stack>
  );
}

export default function OverviewPage() {
  const { homeId, home } = useHome();
  const me = useMeQuery();
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
  const [boardRef, width] = useElementWidth();

  const widgets = useMemo(() => (editing ? draft : (dash.data?.widgets ?? [])), [editing, draft, dash.data]);
  const board = useMemo(() => readBoard(widgets), [widgets]);

  // Layout follows the width actually available (the sidebar can be expanded or collapsed).
  const twoColumns = width >= 960;
  const sideWidth = width >= 1300 ? 360 : 330;
  const mainWidth = twoColumns ? width - sideWidth - 16 : width;
  const pairHalves = mainWidth >= 560;
  const sideGridCols = !twoColumns && width >= 600 ? 2 : 1;

  const startEditing = () => {
    setDraft(normalizeLayout(dash.data?.widgets ?? []));
    setIssues([]);
    setEditing(true);
  };

  const actions: EditActions = {
    onMove: (id, dir) => setDraft((d) => moveWidget(d, id, dir)),
    onSwitchColumn: (id) => setDraft((d) => switchColumn(d, id)),
    onToggleWidth: (id) => setDraft((d) => toggleWidth(d, id)),
    onHide: (id) => setDraft((d) => hideWidget(d, id)),
    onRemove: (id) => setDraft((d) => removeWidget(d, id)),
    onConfigure: (id) => setConfigId(id),
  };

  const saveLayout = async () => {
    const final = normalizeLayout(draft);
    const problems = validateDashboardLayout(final);
    setIssues(problems);
    if (problems.length) return;
    try {
      await save({ homeId, widgets: final }).unwrap();
      setEditing(false);
      dispatch(pushToast({ message: 'Dashboard layout saved', severity: 'success' }));
    } catch (e) {
      setIssues([{ widgetId: '', message: toApiError(e).message }]);
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
          <Button data-tour="customise" variant="outlined" startIcon={<LayoutGrid size={16} />} onClick={startEditing} disabled={!dash.data}>
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
  let order = 0;
  const slot = (p: Placed, zone: Zone, i: number, list: Placed[]) => (
    <Slot key={p.widget.id} widget={p.widget} index={order++} editing={editing} actions={actions} info={{ zone, half: p.half, first: i === 0, last: i === list.length - 1 }} />
  );
  const mainIndex = new Map(board.main.map((p, i) => [p.widget.id, i]));
  const empty = !board.summary && !board.main.length && !board.side.length;

  return (
    <Box>
      {header}
      {editing && (
        <Alert severity="info" sx={{ mb: 2 }}>
          Use the buttons on each widget to reorder it, move it between the main and side columns, change its width, or hide it. Nothing changes until you save.
        </Alert>
      )}
      {issues.length > 0 && (
        <Alert severity="error" sx={{ mb: 2 }}>
          The layout can't be saved: {issues.map((i) => i.message).join(' ')}
        </Alert>
      )}
      {empty && (
        <Alert severity="info" action={<Button onClick={editing ? () => setAddOpen(true) : startEditing}>Add widgets</Button>}>
          Your dashboard is empty.
        </Alert>
      )}

      <Stack spacing={GAP} ref={boardRef}>
        {board.summary && <Slot widget={board.summary} index={order++} editing={editing} actions={actions} info={{ zone: 'summary', half: false, first: true, last: true }} />}
        {width > 0 && (board.main.length > 0 || board.side.length > 0) && (
          <Box sx={{ display: 'grid', gap: GAP, alignItems: 'start', gridTemplateColumns: twoColumns && board.side.length && board.main.length ? `minmax(0, 1fr) ${sideWidth}px` : 'minmax(0, 1fr)' }}>
            {board.main.length > 0 && (
              <Stack spacing={GAP} sx={{ minWidth: 0 }} aria-label="Main column">
                {mainRows(board.main).map((row) => (
                  <Box key={row.map((p) => p.widget.id).join('+')} sx={{ display: 'grid', gap: GAP, gridTemplateColumns: row.length === 2 && pairHalves ? '1fr 1fr' : '1fr' }}>
                    {row.map((p) => slot(p, 'main', mainIndex.get(p.widget.id)!, board.main))}
                  </Box>
                ))}
              </Stack>
            )}
            {board.side.length > 0 && (
              <Box sx={{ display: 'grid', gap: GAP, alignItems: 'start', gridTemplateColumns: `repeat(${sideGridCols}, minmax(0, 1fr))`, minWidth: 0 }} aria-label="Side column">
                {board.side.map((p, i, list) => slot(p, 'side', i, list))}
              </Box>
            )}
          </Box>
        )}
      </Stack>

      <AddWidgetDialog open={addOpen} widgets={draft} onClose={() => setAddOpen(false)} onAdd={(t) => setDraft((d) => addOrShowWidget(d, t))} />
      <ConfigureDialog
        widget={configWidget}
        onClose={() => setConfigId(null)}
        onApply={(w) => {
          setDraft((d) => d.map((x) => (x.id === w.id ? w : x)));
          setConfigId(null);
        }}
      />
    </Box>
  );
}

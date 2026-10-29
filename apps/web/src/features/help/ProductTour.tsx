import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, LinearProgress, ListItemIcon, Menu, MenuItem, Paper, Popper, Portal, Stack, Tooltip, Typography,
  Unstable_TrapFocus as FocusTrap,
} from '@mui/material';
import { BookOpen, CircleHelp, Compass, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useHome } from '../../app/hooks';
import { setGuideOpen, setTourOpen, useAppDispatch, useAppSelector } from '../../app/store';
import { NAV } from '../../components/layout/nav';
import { tokens } from '../../theme/theme';

/**
 * Guided product tour: a spotlight on one element at a time with a short explanation.
 * Elements opt in with `data-tour="<key>"`; steps whose element is missing or hidden
 * (permissions, screen size) are skipped, so the tour always matches what the user can see.
 */

interface TourStep {
  target?: string;
  title: string;
  body: string;
}

const TOUR_SEEN_KEY = 'smartnest.tourSeen.';

const STEPS: TourStep[] = [
  {
    title: 'Welcome to SmartNest',
    body: 'A one-minute tour of where everything is. Use the buttons or your arrow keys, and press Esc to leave at any time. You can replay it from the Help (?) button.',
  },
  { target: 'home-switcher', title: 'Your homes', body: 'Switch between homes, or create and join another one. Demonstration homes are always labelled “Demo”.' },
  ...NAV.map((n) => ({ target: `nav-${n.to}`, title: n.label, body: n.description })),
  { target: 'search', title: 'Search everything', body: 'Find devices, rooms, scenes and automations instantly. Shortcut: Ctrl K (⌘K on a Mac).' },
  { target: 'live', title: 'Live updates', body: '“Live” means device changes arrive in real time. If it says “Reconnecting”, values on screen may be out of date.' },
  { target: 'notifications', title: 'Notifications', body: 'Alerts such as a device going offline, a low battery or an automation that failed. The badge shows how many are unread.' },
  { target: 'quick-action', title: 'Quick action', body: 'Add a device, room, scene or automation from anywhere, or run one of your favourite scenes.' },
  { target: 'summary', title: 'Home at a glance', body: 'Device counts, connectivity, security alerts and current power. Click a tile to jump straight to the matching devices.' },
  { target: 'widget-favourites', title: 'Favourite devices', body: 'Control starred devices right here. A command shows “Confirmed” only after the device reports the new state. Star devices from their menu on the Devices page.' },
  { target: 'widget-quickActions', title: 'Scenes in one tap', body: 'Run a scene and watch each action’s result. Scenes that unlock doors or disarm alarms ask for confirmation first.' },
  { target: 'customise', title: 'Make it yours', body: 'Reorder, hide or add widgets, move them between the main and side columns, and choose half or full width. Each home keeps its own layout.' },
  { target: 'help', title: 'Help is always here', body: 'Replay this tour or open the feature guide from this button whenever you need it.' },
];

const findTarget = (key: string): HTMLElement | null => {
  for (const el of document.querySelectorAll<HTMLElement>(`[data-tour="${key}"]`)) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) return el;
  }
  return null;
};

const markSeen = (userId: string) => {
  try {
    localStorage.setItem(TOUR_SEEN_KEY + userId, '1');
  } catch {
    /* storage unavailable: the tour may show again next time */
  }
};
const hasSeen = (userId: string) => {
  try {
    return localStorage.getItem(TOUR_SEEN_KEY + userId) === '1';
  } catch {
    return true;
  }
};

/** Start the tour automatically the first time a user lands on the dashboard. */
export function useTourAutoStart(userId: string | undefined, onDashboard: boolean) {
  const dispatch = useAppDispatch();
  useEffect(() => {
    if (!userId || !onDashboard || hasSeen(userId)) return;
    const t = window.setTimeout(() => {
      markSeen(userId);
      dispatch(setTourOpen(true));
    }, 1200);
    return () => window.clearTimeout(t);
  }, [userId, onDashboard, dispatch]);
}

export function ProductTour() {
  const open = useAppSelector((s) => s.ui.tourOpen);
  return open ? <TourRunner /> : null;
}

function TourRunner() {
  const dispatch = useAppDispatch();
  // Only steps whose element is visible right now (respects role permissions and screen size).
  const steps = useMemo(() => STEPS.filter((s) => !s.target || findTarget(s.target)), []);
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const step = steps[index]!;
  const last = index === steps.length - 1;

  const close = useCallback(() => dispatch(setTourOpen(false)), [dispatch]);
  const go = useCallback((d: 1 | -1) => setIndex((i) => Math.min(steps.length - 1, Math.max(0, i + d))), [steps.length]);

  // Track the highlighted element through scrolling and resizing.
  useLayoutEffect(() => {
    const el = step.target ? findTarget(step.target) : null;
    if (!el) {
      setRect(null);
      return;
    }
    el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    const measure = () => setRect(el.getBoundingClientRect());
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [step]);

  useEffect(() => {
    nextRef.current?.focus();
  }, [index]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
      else if (e.key === 'ArrowRight') go(1);
      else if (e.key === 'ArrowLeft') go(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close, go]);

  const anchor = useMemo(() => (rect ? { getBoundingClientRect: () => rect } : null), [rect]);
  const pad = 6;

  const card = (
    <FocusTrap open>
      <Paper
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-title"
        aria-describedby="tour-body"
        tabIndex={-1}
        sx={{ width: 340, maxWidth: 'calc(100vw - 32px)', p: 2.25, borderRadius: `${tokens.radius.lg}px`, boxShadow: tokens.shadow.raised, outline: 'none' }}
      >
        <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 0.5 }}>
          <Typography variant="overline" color="primary.main">
            {index === 0 ? 'Product tour' : `Step ${index + 1} of ${steps.length}`}
          </Typography>
          <IconButton size="small" aria-label="Close tour" onClick={close} sx={{ mr: -0.75 }}>
            <X size={16} />
          </IconButton>
        </Stack>
        <Typography id="tour-title" variant="h5" component="h2" sx={{ mb: 0.75 }}>
          {step.title}
        </Typography>
        <Typography id="tour-body" variant="body2" color="text.secondary">
          {step.body}
        </Typography>
        <LinearProgress variant="determinate" value={((index + 1) / steps.length) * 100} sx={{ mt: 2, mb: 1.5, height: 4 }} aria-hidden />
        <Stack direction="row" spacing={1} alignItems="center">
          {!last && (
            <Button size="small" onClick={close} sx={{ color: 'text.secondary', px: 1 }}>
              Skip tour
            </Button>
          )}
          <Box sx={{ flex: 1 }} />
          {index > 0 && (
            <Button size="small" onClick={() => go(-1)}>
              Back
            </Button>
          )}
          <Button ref={nextRef} size="small" variant="contained" onClick={() => (last ? close() : go(1))}>
            {last ? 'Finish' : index === 0 ? 'Start tour' : 'Next'}
          </Button>
        </Stack>
      </Paper>
    </FocusTrap>
  );

  return (
    <Portal>
      {/* Dim the page and block interaction; the spotlight is a hole made with a huge box-shadow. */}
      <Box sx={{ position: 'fixed', inset: 0, zIndex: 1400 }} aria-hidden>
        {rect ? (
          <Box
            sx={{
              position: 'fixed', left: rect.left - pad, top: rect.top - pad, width: rect.width + pad * 2, height: rect.height + pad * 2,
              borderRadius: '14px', boxShadow: '0 0 0 9999px rgba(24, 28, 26, 0.55)', outline: `2px solid ${tokens.color.orange}`,
              transition: 'left 200ms ease, top 200ms ease, width 200ms ease, height 200ms ease', pointerEvents: 'none',
            }}
          />
        ) : (
          <Box sx={{ position: 'fixed', inset: 0, bgcolor: 'rgba(24, 28, 26, 0.55)' }} />
        )}
      </Box>
      {anchor ? (
        <Popper
          open
          anchorEl={anchor}
          placement="right-start"
          sx={{ zIndex: 1401 }}
          modifiers={[
            { name: 'offset', options: { offset: [0, 16] } },
            { name: 'flip', options: { fallbackPlacements: ['bottom', 'top', 'left'] } },
            { name: 'preventOverflow', options: { padding: 12, altAxis: true } },
          ]}
        >
          {card}
        </Popper>
      ) : (
        <Box sx={{ position: 'fixed', inset: 0, zIndex: 1401, display: 'grid', placeItems: 'center', p: 2 }}>{card}</Box>
      )}
    </Portal>
  );
}

const TIPS: { title: string; body: string }[] = [
  { title: 'Command results', body: '“Sent” means the request reached the integration. “Confirmed” appears only when the device reports the new state; “Acknowledged” means the device cannot report back; “Timed out” means no confirmation arrived.' },
  { title: 'Connectivity vs state', body: 'Online / Offline / Unavailable / Unknown describes whether a device is reachable. On, off or a temperature is its operating state. Missing values show as “Not available”, never guessed.' },
  { title: 'Demo data', body: 'Everything from demonstration mode carries a “Demo” label. Nothing physical is controlled.' },
  { title: 'Sensitive actions', body: 'Unlocking, disarming and opening garage doors ask for confirmation, and may ask for your password again.' },
  { title: 'Roles', body: 'Owners and admins manage the home; members control devices; guests control everyday devices only.' },
];

export function FeatureGuideDialog() {
  const open = useAppSelector((s) => s.ui.guideOpen);
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const { can } = useHome();
  const close = () => dispatch(setGuideOpen(false));
  return (
    <Dialog open={open} onClose={close} fullWidth maxWidth="md" aria-labelledby="guide-title" scroll="paper">
      <DialogTitle id="guide-title" sx={{ pb: 1 }}>
        Feature guide
        <Typography variant="body2" color="text.secondary">
          Everything SmartNest can do, and where to find it.
        </Typography>
      </DialogTitle>
      <DialogContent dividers>
        <Box sx={{ display: 'grid', gap: 1.25, gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' } }}>
          {NAV.filter((n) => !n.permission || can(n.permission)).map((n) => (
            <Stack key={n.to} direction="row" spacing={1.5} sx={{ p: 1.5, border: `1px solid ${tokens.color.border}`, borderRadius: `${tokens.radius.md}px` }}>
              <Box sx={{ width: 34, height: 34, borderRadius: '10px', bgcolor: 'sage.main', color: 'primary.dark', display: 'grid', placeItems: 'center', flexShrink: 0 }} aria-hidden>
                <n.icon size={18} />
              </Box>
              <Box sx={{ minWidth: 0, flex: 1 }}>
                <Stack direction="row" alignItems="center" justifyContent="space-between">
                  <Typography fontWeight={700}>{n.label}</Typography>
                  <Button
                    size="small"
                    sx={{ minHeight: 26, px: 1 }}
                    onClick={() => {
                      close();
                      navigate(n.to);
                    }}
                    aria-label={`Open ${n.label}`}
                  >
                    Open
                  </Button>
                </Stack>
                <Typography variant="caption" component="p">
                  {n.description}
                </Typography>
              </Box>
            </Stack>
          ))}
        </Box>
        <Typography variant="h5" component="h3" sx={{ mt: 3, mb: 1 }}>
          Good to know
        </Typography>
        <Stack spacing={1}>
          {TIPS.map((t) => (
            <Typography key={t.title} variant="body2">
              <b>{t.title}.</b> <Box component="span" sx={{ color: 'text.secondary' }}>{t.body}</Box>
            </Typography>
          ))}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 1.5 }}>
        <Button
          startIcon={<Compass size={16} />}
          onClick={() => {
            close();
            navigate('/');
            window.setTimeout(() => dispatch(setTourOpen(true)), 400);
          }}
        >
          Take the guided tour
        </Button>
        <Button variant="contained" onClick={close}>
          Done
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export function HelpMenu() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  return (
    <>
      <Tooltip title="Help">
        <IconButton data-tour="help" aria-label="Help" aria-haspopup="menu" onClick={(e) => setAnchor(e.currentTarget)}>
          <CircleHelp size={20} />
        </IconButton>
      </Tooltip>
      <Menu anchorEl={anchor} open={!!anchor} onClose={() => setAnchor(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }} transformOrigin={{ vertical: 'top', horizontal: 'right' }}>
        <MenuItem
          onClick={() => {
            setAnchor(null);
            navigate('/');
            window.setTimeout(() => dispatch(setTourOpen(true)), 400);
          }}
        >
          <ListItemIcon>
            <Compass size={16} />
          </ListItemIcon>
          Take the guided tour
        </MenuItem>
        <MenuItem
          onClick={() => {
            setAnchor(null);
            dispatch(setGuideOpen(true));
          }}
        >
          <ListItemIcon>
            <BookOpen size={16} />
          </ListItemIcon>
          Feature guide
        </MenuItem>
      </Menu>
    </>
  );
}

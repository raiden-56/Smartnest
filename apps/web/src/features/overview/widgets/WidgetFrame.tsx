import { createContext, useContext, type ReactNode } from 'react';
import { Box, Button, Card, Stack, Tooltip, Typography } from '@mui/material';
import { Info } from 'lucide-react';
import { Link as RouterLink } from 'react-router-dom';
import type { DashboardWidget, WidgetType } from '@smartnest/shared';
import { tokens } from '../../../theme/theme';

/** Which widget is rendering — used for its help text and tour anchor. */
export const WidgetContext = createContext<{ type?: WidgetType }>({});
export const useWidgetContext = () => useContext(WidgetContext);

export interface WidgetProps {
  widget: DashboardWidget;
}

/** How to use each widget, shown from the (i) next to its title. */
export const WIDGET_HELP: Record<WidgetType, string> = {
  summary: 'Click a tile to open the matching list of devices.',
  favourites: 'Switch devices on or off right here. Star or un-star devices from their ⋮ menu on the Devices page.',
  rooms: 'Open a room to see its devices and switch all of its lights at once.',
  quickActions: 'Tap a scene to run it. Shows your favourite scenes, or all scenes if none are starred.',
  camera: 'The snapshot refreshes every few seconds. Open the camera for the full view.',
  climate: 'Use − and + to change the target temperature, and the mode buttons to switch between heating and cooling.',
  activity: 'The latest events in your home. “View all” opens the searchable activity log.',
  automations: 'Enabled automations and the result of their most recent run.',
  energy: 'Today’s hourly consumption (and solar, if reported) from energy-reporting devices.',
  network: 'Router health and connected clients, as reported by your network integration.',
  security: 'Locks, alarm panels and door or window sensors with their current state.',
  lowBattery: 'Battery-powered devices reporting 20% or less.',
  attention: 'Devices that are offline, unavailable or reported an error.',
};

/** Card used by every widget. It grows with its content; long lists show a “more” link instead of scrolling. */
export function WidgetCard({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  const { type } = useWidgetContext();
  const help = type ? WIDGET_HELP[type] : undefined;
  return (
    <Card component="section" aria-label={title} data-tour={type ? `widget-${type}` : undefined} sx={{ height: '100%', display: 'flex', flexDirection: 'column', minWidth: 0, p: { xs: 1.75, md: 2 } }}>
      <Stack direction="row" alignItems="center" spacing={0.75} sx={{ mb: 1, minHeight: 30, flexShrink: 0 }}>
        <Typography component="h2" noWrap sx={{ fontSize: '1rem', fontWeight: 700, flexShrink: 0, maxWidth: '70%' }}>
          {title}
        </Typography>
        {help && (
          <Tooltip title={help} placement="top" enterTouchDelay={0}>
            <Box component="span" tabIndex={0} aria-label={`About ${title}: ${help}`} sx={{ display: 'inline-flex', color: 'text.disabled', cursor: 'help', borderRadius: '50%', '&:hover': { color: 'text.secondary' } }}>
              <Info size={14} />
            </Box>
          </Tooltip>
        )}
        <Box sx={{ flex: 1, minWidth: 0, display: 'flex', justifyContent: 'flex-end' }}>{action}</Box>
      </Stack>
      <Box sx={{ flex: 1, minWidth: 0 }}>{children}</Box>
    </Card>
  );
}

/** “+3 more” footer for capped lists. */
export function MoreLink({ to, hidden, noun }: { to: string; hidden: number; noun: string }) {
  if (hidden <= 0) return null;
  return (
    <Button component={RouterLink} to={to} size="small" sx={{ mt: 0.5, ml: -1, minHeight: 28 }}>
      +{hidden} more {noun}
    </Button>
  );
}

/** A small, quiet empty message inside a widget. */
export function WidgetEmpty({ icon, title, description, action }: { icon?: ReactNode; title: string; description?: ReactNode; action?: ReactNode }) {
  return (
    <Stack alignItems="center" justifyContent="center" spacing={0.75} sx={{ height: '100%', minHeight: 96, textAlign: 'center', px: 2, py: 1.5, color: 'text.secondary' }}>
      {icon && (
        <Box sx={{ width: 38, height: 38, borderRadius: '50%', bgcolor: 'sage.main', color: 'primary.dark', display: 'grid', placeItems: 'center' }} aria-hidden>
          {icon}
        </Box>
      )}
      <Typography variant="body2" fontWeight={600} color="text.primary">
        {title}
      </Typography>
      {description && (
        <Typography variant="caption" component="p" sx={{ maxWidth: 320 }}>
          {description}
        </Typography>
      )}
      {action}
    </Stack>
  );
}

/** Compact list row with a leading visual, text and trailing slot. */
export function WidgetRow({ leading, primary, secondary, trailing, divider = true }: { leading?: ReactNode; primary: ReactNode; secondary?: ReactNode; trailing?: ReactNode; divider?: boolean }) {
  return (
    <Stack direction="row" alignItems="center" spacing={1.25} sx={{ py: 0.875, borderBottom: divider ? `1px solid ${tokens.color.border}` : 'none', minWidth: 0, '&:last-of-type': { borderBottom: 'none' } }}>
      {leading}
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Typography variant="body2" fontWeight={600} noWrap component="div">
          {primary}
        </Typography>
        {secondary && (
          <Typography variant="caption" noWrap component="div">
            {secondary}
          </Typography>
        )}
      </Box>
      {trailing && <Box sx={{ flexShrink: 0 }}>{trailing}</Box>}
    </Stack>
  );
}

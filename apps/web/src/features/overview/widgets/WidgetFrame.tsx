import { createContext, useContext, type ReactNode } from 'react';
import { Box, Card, Stack, Typography } from '@mui/material';
import type { DashboardWidget } from '@smartnest/shared';
import { tokens } from '../../../theme/theme';

/** Rendering context for widgets: grid cells have a fixed height, stacked (mobile) cards grow. */
export const WidgetContext = createContext<{ stacked: boolean }>({ stacked: false });
export const useWidgetContext = () => useContext(WidgetContext);

export interface WidgetProps {
  widget: DashboardWidget;
}

/** Card used by every widget: heading row + scrollable body that respects the grid cell height. */
export function WidgetCard({ title, action, children, hideTitle, padded = true }: { title: string; action?: ReactNode; children: ReactNode; hideTitle?: boolean; padded?: boolean }) {
  const { stacked } = useWidgetContext();
  return (
    <Card
      component="section"
      aria-label={title}
      sx={{ height: stacked ? 'auto' : '100%', display: 'flex', flexDirection: 'column', minWidth: 0, p: padded ? { xs: 2, md: 2.25 } : 0, overflow: 'hidden' }}
    >
      {hideTitle ? (
        <Typography variant="h4" component="h2" sx={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>
          {title}
        </Typography>
      ) : (
        <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1} sx={{ mb: 1.25, minHeight: 32, flexShrink: 0 }}>
          <Typography variant="h4" component="h2" noWrap>
            {title}
          </Typography>
          {action}
        </Stack>
      )}
      <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', maxHeight: stacked ? 440 : undefined }}>
        {children}
      </Box>
    </Card>
  );
}

/** A small, quiet empty message inside a widget. */
export function WidgetEmpty({ icon, title, description, action }: { icon?: ReactNode; title: string; description?: ReactNode; action?: ReactNode }) {
  return (
    <Stack alignItems="center" justifyContent="center" spacing={1} sx={{ height: '100%', minHeight: 110, textAlign: 'center', px: 2, py: 2, color: 'text.secondary' }}>
      {icon && (
        <Box sx={{ width: 44, height: 44, borderRadius: '50%', bgcolor: 'sage.main', color: 'primary.dark', display: 'grid', placeItems: 'center' }} aria-hidden>
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
    <Stack direction="row" alignItems="center" spacing={1.25} sx={{ py: 1, borderBottom: divider ? `1px solid ${tokens.color.border}` : 'none', minWidth: 0, '&:last-of-type': { borderBottom: 'none' } }}>
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

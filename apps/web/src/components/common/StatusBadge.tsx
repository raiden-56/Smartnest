import { Box, Chip, Tooltip, type ChipProps } from '@mui/material';
import { CircleHelp, CircleOff, FlaskConical, PlugZap, Wifi, WifiOff } from 'lucide-react';
import { CONNECTIVITY_LABELS, type ConnectivityState } from '@smartnest/shared';
import { tokens } from '../../theme/theme';

const CONN: Record<ConnectivityState, { icon: typeof Wifi; color: string; bg: string; hint: string }> = {
  online: { icon: Wifi, color: tokens.color.success, bg: '#E3F0E7', hint: 'The integration reports this device as reachable.' },
  offline: { icon: WifiOff, color: tokens.color.error, bg: '#F8E4E2', hint: 'The device is not reachable. Its last known state is shown.' },
  unavailable: { icon: CircleOff, color: tokens.color.warning, bg: '#F8EEDC', hint: 'The integration reports the device as unavailable.' },
  unknown: { icon: CircleHelp, color: tokens.color.textSecondary, bg: tokens.color.disabled, hint: 'SmartNest cannot currently determine connectivity (e.g. the integration is disconnected).' },
};

/** Connectivity badge: always icon + text, never colour alone. */
export function ConnectivityBadge({ state, size = 'small', integrationDisconnected }: { state: ConnectivityState; size?: ChipProps['size']; integrationDisconnected?: boolean }) {
  if (integrationDisconnected) {
    return (
      <Tooltip title="The integration that owns this device has been disconnected.">
        <Chip size={size} icon={<PlugZap size={14} />} label="Integration disconnected" sx={{ bgcolor: tokens.color.disabled, color: tokens.color.textSecondary, '& .MuiChip-icon': { color: 'inherit' } }} />
      </Tooltip>
    );
  }
  const c = CONN[state];
  const Icon = c.icon;
  return (
    <Tooltip title={c.hint}>
      <Chip
        size={size}
        icon={<Icon size={14} aria-hidden />}
        label={CONNECTIVITY_LABELS[state]}
        sx={{ bgcolor: c.bg, color: c.color, height: size === 'small' ? 24 : 30, '& .MuiChip-icon': { color: 'inherit', ml: '6px' }, '& .MuiChip-label': { px: 1 } }}
      />
    </Tooltip>
  );
}

export function DemoBadge({ compact }: { compact?: boolean }) {
  return (
    <Tooltip title="Simulated device or data from demonstration mode. Nothing physical is controlled.">
      <Chip
        size="small"
        icon={<FlaskConical size={13} aria-hidden />}
        label={compact ? 'Demo' : 'Demo data'}
        sx={{ bgcolor: '#FDEBD8', color: '#8A4B12', height: 22, fontSize: '0.72rem', '& .MuiChip-icon': { color: 'inherit', ml: '5px' }, '& .MuiChip-label': { px: 0.75 } }}
      />
    </Tooltip>
  );
}

/** Minimal demo marker for dense rows: an icon with an accessible label and explanation on hover. */
export function DemoMark() {
  return (
    <Tooltip title="Demo: simulated device or data, nothing physical is controlled.">
      <Box component="span" role="img" aria-label="Demo" tabIndex={0} sx={{ display: 'inline-flex', color: '#8A4B12', flexShrink: 0 }}>
        <FlaskConical size={13} aria-hidden />
      </Box>
    </Tooltip>
  );
}

export function SeverityDot({ severity }: { severity: 'info' | 'success' | 'warning' | 'critical' }) {
  const color = { info: tokens.color.textSecondary, success: tokens.color.success, warning: tokens.color.warning, critical: tokens.color.error }[severity];
  return <Box component="span" aria-hidden sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: color, display: 'inline-block', flexShrink: 0 }} />;
}

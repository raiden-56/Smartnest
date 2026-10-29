import { memo, useState } from 'react';
import { Box, Card, Checkbox, IconButton, ListItemIcon, Menu, MenuItem, Stack, Tooltip, Typography } from '@mui/material';
import { motion } from 'framer-motion';
import { EyeOff, MoreVertical, MoveRight, PanelRightOpen, Star, StarOff, Trash2 } from 'lucide-react';
import { Link as RouterLink, useNavigate } from 'react-router-dom';
import { LOW_BATTERY_THRESHOLD, describeOperatingState, type DeviceDto } from '@smartnest/shared';
import { useRemoveDeviceMutation, useRoomsQuery, useUpdateDeviceMutation, toApiError } from '../../api/api';
import { timeAgo, useHome } from '../../app/hooks';
import { pushToast, useAppDispatch, useLiveDevice } from '../../app/store';
import { tokens } from '../../theme/theme';
import { AppIcon, deviceIconName } from '../common/AppIcon';
import { useConfirm } from '../common/Dialogs';
import { ConnectivityBadge, DemoBadge, DemoMark } from '../common/StatusBadge';
import { QuickControl } from './CapabilityControls';

export function DeviceTile({ device, size = 44 }: { device: DeviceDto; size?: number }) {
  const active = device.state.on === true || device.state.mediaState === 'playing' || device.state.vacuumState === 'cleaning' || device.state.coverState === 'open';
  const dim = device.connectivity !== 'online' || device.integrationDisconnected;
  return (
    <Box
      aria-hidden
      sx={{
        width: size, height: size, borderRadius: `${tokens.radius.sm + 2}px`, display: 'grid', placeItems: 'center', flexShrink: 0,
        bgcolor: dim ? tokens.color.disabled : active ? 'accent.main' : 'sage.main',
        color: dim ? tokens.color.textSecondary : active ? '#fff' : 'primary.dark',
        transition: 'background-color 200ms, color 200ms',
      }}
    >
      <AppIcon name={deviceIconName(device.deviceType, device.category)} size={size * 0.48} />
    </Box>
  );
}

export function DeviceMenu({ device }: { device: DeviceDto }) {
  const { homeId, can } = useHome();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [moveAnchor, setMoveAnchor] = useState<HTMLElement | null>(null);
  const [update] = useUpdateDeviceMutation();
  const [remove] = useRemoveDeviceMutation();
  const rooms = useRoomsQuery(homeId, { skip: !moveAnchor });
  const confirm = useConfirm();
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const manage = can('devices.manage');

  const run = async (p: Promise<unknown>, ok: string) => {
    try {
      await p;
      dispatch(pushToast({ message: ok, severity: 'success' }));
    } catch (e) {
      dispatch(pushToast({ message: toApiError(e).message, severity: 'error' }));
    }
  };

  return (
    <>
      <IconButton size="small" aria-label={`More actions for ${device.name}`} aria-haspopup="menu" onClick={(e) => setAnchor(e.currentTarget)}>
        <MoreVertical size={18} />
      </IconButton>
      <Menu anchorEl={anchor} open={!!anchor} onClose={() => setAnchor(null)}>
        <MenuItem onClick={() => navigate(`/devices/${device.id}`)}>
          <ListItemIcon>
            <PanelRightOpen size={16} />
          </ListItemIcon>
          Open details
        </MenuItem>
        {manage && (
          <MenuItem onClick={() => { setAnchor(null); void run(update({ homeId, deviceId: device.id, isFavourite: !device.isFavourite }).unwrap(), device.isFavourite ? 'Removed from favourites' : 'Added to favourites'); }}>
            <ListItemIcon>{device.isFavourite ? <StarOff size={16} /> : <Star size={16} />}</ListItemIcon>
            {device.isFavourite ? 'Remove from favourites' : 'Add to favourites'}
          </MenuItem>
        )}
        {manage && (
          <MenuItem onClick={(e) => setMoveAnchor(e.currentTarget)}>
            <ListItemIcon>
              <MoveRight size={16} />
            </ListItemIcon>
            Move to room…
          </MenuItem>
        )}
        {manage && (
          <MenuItem onClick={() => { setAnchor(null); void run(update({ homeId, deviceId: device.id, isHidden: !device.isHidden }).unwrap(), device.isHidden ? 'Device shown' : 'Device hidden from views'); }}>
            <ListItemIcon>
              <EyeOff size={16} />
            </ListItemIcon>
            {device.isHidden ? 'Show device' : 'Hide / ignore device'}
          </MenuItem>
        )}
        {manage && (
          <MenuItem
            sx={{ color: 'error.main' }}
            onClick={async () => {
              setAnchor(null);
              const ok = await confirm({
                title: `Remove ${device.name} from SmartNest?`,
                message: `This removes the device and its history from SmartNest only. The physical device and its ${device.integrationName} entity are not affected, and you can import it again later.`,
                tone: 'danger',
                confirmLabel: 'Remove device',
              });
              if (ok) void run(remove({ homeId, deviceId: device.id }).unwrap(), `${device.name} removed`);
            }}
          >
            <ListItemIcon sx={{ color: 'inherit' }}>
              <Trash2 size={16} />
            </ListItemIcon>
            Remove from SmartNest
          </MenuItem>
        )}
      </Menu>
      <Menu anchorEl={moveAnchor} open={!!moveAnchor} onClose={() => { setMoveAnchor(null); setAnchor(null); }}>
        <MenuItem disabled={!device.roomId} onClick={() => { setMoveAnchor(null); setAnchor(null); void run(update({ homeId, deviceId: device.id, roomId: null }).unwrap(), 'Device unassigned'); }}>
          No room
        </MenuItem>
        {rooms.data?.rooms.map((r) => (
          <MenuItem key={r.id} selected={r.id === device.roomId} onClick={() => { setMoveAnchor(null); setAnchor(null); void run(update({ homeId, deviceId: device.id, roomId: r.id }).unwrap(), `Moved to ${r.name}`); }}>
            <ListItemIcon>
              <AppIcon name={r.icon} size={16} />
            </ListItemIcon>
            {r.name}
          </MenuItem>
        ))}
      </Menu>
    </>
  );
}

interface CardProps {
  device: DeviceDto;
  selectable?: boolean;
  selected?: boolean;
  onSelect?: (id: string, v: boolean) => void;
  showRoom?: boolean;
}

export const DeviceCard = memo(function DeviceCard({ device: initial, selectable, selected, onSelect, showRoom = true }: CardProps) {
  const device = useLiveDevice(initial);
  const op = describeOperatingState(device.state, device.capabilities);
  const lowBattery = device.state.batteryLevel !== undefined && device.state.batteryLevel <= LOW_BATTERY_THRESHOLD;
  return (
    <motion.div layout="position" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: tokens.motion.base }} style={{ height: '100%' }}>
      <Card
        sx={{
          p: 2, height: '100%', display: 'flex', flexDirection: 'column', gap: 1.5, position: 'relative', transition: 'box-shadow 160ms, border-color 160ms',
          borderColor: selected ? 'primary.main' : undefined,
          '&:hover': { boxShadow: tokens.shadow.raised },
          '&:focus-within': { borderColor: 'primary.light' },
        }}
      >
        <Stack direction="row" spacing={1.5} alignItems="flex-start">
          {selectable && <Checkbox size="small" checked={!!selected} onChange={(e) => onSelect?.(device.id, e.target.checked)} inputProps={{ 'aria-label': `Select ${device.name}` }} sx={{ p: 0.5, ml: -0.75 }} />}
          <DeviceTile device={device} />
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography
              component={RouterLink}
              to={`/devices/${device.id}`}
              variant="h5"
              sx={{ color: 'text.primary', textDecoration: 'none', display: 'block', fontSize: '1.02rem', lineHeight: 1.3, '&:hover': { textDecoration: 'underline' } }}
              noWrap
              title={device.name}
            >
              {device.name}
            </Typography>
            <Typography variant="caption" noWrap component="p" title={`${device.roomName ?? 'No room'} · ${device.manufacturer ?? device.integrationName}`}>
              {showRoom ? `${device.roomName ?? 'No room'} · ` : ''}
              {device.manufacturer ?? device.integrationName}
            </Typography>
          </Box>
          <DeviceMenu device={device} />
        </Stack>

        <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap alignItems="center">
          <ConnectivityBadge state={device.connectivity} integrationDisconnected={device.integrationDisconnected} />
          {device.isDemo && <DemoBadge compact />}
          {device.isFavourite && (
            <Tooltip title="Favourite">
              <Star size={15} fill={tokens.color.orange} color={tokens.color.orange} aria-label="Favourite" />
            </Tooltip>
          )}
          {lowBattery && (
            <Typography variant="caption" sx={{ color: 'error.main', fontWeight: 600 }}>
              Battery {device.state.batteryLevel}%
            </Typography>
          )}
        </Stack>

        <Stack direction="row" alignItems="flex-end" justifyContent="space-between" flexWrap="wrap" useFlexGap columnGap={1} rowGap={1} sx={{ mt: 'auto' }}>
          <Box sx={{ minWidth: 0, flex: '1 1 90px' }}>
            <Typography variant="body2" fontWeight={600} noWrap>
              {device.connectivity === 'online' ? (op ?? '') : op ? `Last known: ${op}` : ''}
            </Typography>
            <Typography variant="caption" component="p" noWrap>
              Updated {timeAgo(device.stateUpdatedAt)}
            </Typography>
          </Box>
          <Box sx={{ flexShrink: 0, ml: 'auto' }}>
            <QuickControl device={device} />
          </Box>
        </Stack>
      </Card>
    </motion.div>
  );
});

/** Dense card for the dashboard: icon, name, state and the primary control on one line. */
export const DeviceCompactCard = memo(function DeviceCompactCard({ device: initial }: { device: DeviceDto }) {
  const device = useLiveDevice(initial);
  const op = describeOperatingState(device.state, device.capabilities);
  const online = device.connectivity === 'online' && !device.integrationDisconnected;
  return (
    <Card
      sx={{
        p: 1.25, display: 'flex', flexWrap: 'wrap', alignItems: 'center', columnGap: 1.25, rowGap: 1, minWidth: 0, boxShadow: 'none', transition: 'border-color 150ms',
        '&:hover': { borderColor: 'primary.light' }, '&:focus-within': { borderColor: 'primary.light' },
      }}
    >
      <DeviceTile device={device} size={38} />
      {/* Name and state take the row; a wide control (e.g. cover buttons) wraps underneath instead of squeezing it. */}
      <Box sx={{ minWidth: 0, flex: '1 1 110px' }}>
        <Stack direction="row" spacing={0.5} alignItems="center" sx={{ minWidth: 0 }}>
          <Typography
            component={RouterLink}
            to={`/devices/${device.id}`}
            noWrap
            title={device.name}
            sx={{ color: 'text.primary', textDecoration: 'none', fontWeight: 650, fontSize: '0.9rem', '&:hover': { textDecoration: 'underline' } }}
          >
            {device.name}
          </Typography>
          {device.isDemo && <DemoMark />}
        </Stack>
        {online ? (
          <Typography variant="caption" noWrap component="div" title={`Updated ${timeAgo(device.stateUpdatedAt)}`}>
            {[op, device.roomName].filter(Boolean).join(' · ') || 'No state reported'}
          </Typography>
        ) : (
          <Box sx={{ mt: 0.25 }}>
            <ConnectivityBadge state={device.connectivity} integrationDisconnected={device.integrationDisconnected} />
          </Box>
        )}
      </Box>
      <Box sx={{ flexShrink: 0, ml: 'auto' }}>
        <QuickControl device={device} />
      </Box>
    </Card>
  );
});

/** Compact horizontal row used in list view and dashboard widgets. */
export function DeviceRow({ device: initial, selectable, selected, onSelect }: CardProps) {
  const device = useLiveDevice(initial);
  const op = describeOperatingState(device.state, device.capabilities);
  return (
    <Stack direction="row" alignItems="center" spacing={1.5} sx={{ py: 1.25, px: { xs: 1, sm: 1.5 }, borderBottom: `1px solid ${tokens.color.border}`, minWidth: 0 }}>
      {selectable && <Checkbox size="small" checked={!!selected} onChange={(e) => onSelect?.(device.id, e.target.checked)} inputProps={{ 'aria-label': `Select ${device.name}` }} />}
      <DeviceTile device={device} size={36} />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography component={RouterLink} to={`/devices/${device.id}`} sx={{ color: 'text.primary', textDecoration: 'none', fontWeight: 600, '&:hover': { textDecoration: 'underline' } }} noWrap display="block">
          {device.name}
        </Typography>
        <Typography variant="caption" noWrap component="p">
          {device.roomName ?? 'No room'} · {op ?? device.category}
        </Typography>
      </Box>
      <Box sx={{ display: { xs: 'none', md: 'block' }, width: 140 }}>
        <ConnectivityBadge state={device.connectivity} integrationDisconnected={device.integrationDisconnected} />
      </Box>
      <Typography variant="caption" sx={{ display: { xs: 'none', lg: 'block' }, width: 110 }}>
        {timeAgo(device.stateUpdatedAt)}
      </Typography>
      {device.isDemo && (
        <Box sx={{ display: { xs: 'none', sm: 'block' } }}>
          <DemoBadge compact />
        </Box>
      )}
      <Box sx={{ minWidth: 72, display: 'flex', justifyContent: 'flex-end' }}>
        <QuickControl device={device} />
      </Box>
      <DeviceMenu device={device} />
    </Stack>
  );
}

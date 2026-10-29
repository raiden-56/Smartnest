import { useState } from 'react';
import { Badge, Box, Button, IconButton, List, ListItemButton, Popover, Stack, Typography } from '@mui/material';
import { Bell, BellOff } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useMarkNotificationsReadMutation, useNotificationsQuery } from '../../api/api';
import { timeAgo, useHome } from '../../app/hooks';
import { SeverityDot } from '../../components/common/StatusBadge';
import { tokens } from '../../theme/theme';

/** In-app notifications. External channels (email/push) are not configured in this build. */
export function NotificationsButton() {
  const { homeId, home } = useHome();
  const q = useNotificationsQuery(homeId, { pollingInterval: 120_000 });
  const [markRead] = useMarkNotificationsReadMutation();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const navigate = useNavigate();
  const unread = q.data?.unread ?? 0;
  return (
    <>
      <IconButton aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`} onClick={(e) => setAnchor(e.currentTarget)}>
        <Badge badgeContent={unread} color="error" max={99}>
          <Bell size={20} />
        </Badge>
      </IconButton>
      <Popover
        open={!!anchor}
        anchorEl={anchor}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        PaperProps={{ sx: { width: { xs: 'calc(100vw - 32px)', sm: 380 }, maxHeight: 480 } }}
      >
        <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ px: 2, py: 1.5, borderBottom: `1px solid ${tokens.color.border}` }}>
          <Typography variant="h5" component="h2">
            Notifications
          </Typography>
          <Button size="small" disabled={!unread} onClick={() => void markRead({ homeId })}>
            Mark all read
          </Button>
        </Stack>
        {home.isDemo && (
          <Typography variant="caption" component="p" sx={{ px: 2, pt: 1 }}>
            Demo home: notifications are shown in-app only and never sent externally.
          </Typography>
        )}
        {!q.data?.items.length ? (
          <Stack alignItems="center" spacing={1} sx={{ py: 5, color: 'text.secondary' }}>
            <BellOff size={28} aria-hidden />
            <Typography>You're all caught up.</Typography>
          </Stack>
        ) : (
          <List dense sx={{ py: 0.5 }}>
            {q.data.items.map((n) => (
              <ListItemButton
                key={n.id}
                onClick={() => {
                  if (!n.readAt) void markRead({ homeId, ids: [n.id] });
                  setAnchor(null);
                  if (n.link) navigate(n.link);
                }}
                sx={{ alignItems: 'flex-start', gap: 1.5, py: 1.25, bgcolor: n.readAt ? undefined : 'rgba(56,102,65,0.05)' }}
              >
                <Box sx={{ pt: 0.75 }}>
                  <SeverityDot severity={n.severity} />
                </Box>
                <Box sx={{ minWidth: 0 }}>
                  <Typography variant="body2" fontWeight={n.readAt ? 500 : 700}>
                    {n.title}
                    <Box component="span" sx={{ position: 'absolute', left: -9999 }}>
                      {n.readAt ? '' : ' (unread)'} — {n.severity}
                    </Box>
                  </Typography>
                  <Typography variant="caption" component="p">
                    {n.body}
                  </Typography>
                  <Typography variant="caption" component="p" sx={{ mt: 0.25 }}>
                    {timeAgo(n.createdAt)}
                  </Typography>
                </Box>
              </ListItemButton>
            ))}
          </List>
        )}
      </Popover>
    </>
  );
}

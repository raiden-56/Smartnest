import { Box, Button, Stack, Typography } from '@mui/material';
import { FlaskConical } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { api, useLogoutMutation } from '../api/api';
import { resetLive, useAppDispatch } from '../app/store';
import { isGuest } from './session';

/** Persistent strip shown on every screen while exploring with sample data. */
export function GuestBanner() {
  const [logout] = useLogoutMutation();
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  if (!isGuest()) return null;
  return (
    <Box role="status" sx={{ flexShrink: 0, bgcolor: '#FDEBD8', color: '#8A4B12', borderBottom: '1px solid #F4D3B0' }}>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ px: { xs: 2, md: 3 }, py: 0.5, maxWidth: 1600, mx: 'auto', minHeight: 36 }}>
        <FlaskConical size={15} aria-hidden style={{ flexShrink: 0 }} />
        <Typography variant="body2" sx={{ color: 'inherit', fontWeight: 600, flex: 1, minWidth: 0 }}>
          Guest mode – sample data, changes aren’t saved
        </Typography>
        <Button
          size="small"
          onClick={async () => {
            await logout().unwrap().catch(() => undefined);
            dispatch(resetLive());
            dispatch(api.util.resetApiState());
            navigate('/login');
          }}
          sx={{ color: 'inherit', fontWeight: 700, flexShrink: 0, minHeight: 28, py: 0 }}
        >
          Exit
        </Button>
      </Stack>
    </Box>
  );
}

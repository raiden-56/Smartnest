import { Alert, Button, CircularProgress, Stack, Typography } from '@mui/material';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ROLE_DESCRIPTIONS, ROLE_LABELS } from '@smartnest/shared';
import { api, toApiError, useAcceptInvitationMutation, useInvitationPreviewQuery } from '../../api/api';
import { setCurrentHome, useAppDispatch } from '../../app/store';
import { AuthLayout } from './AuthLayout';

export default function AcceptInvitePage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const preview = useInvitationPreviewQuery(token, { skip: !token });
  const [accept, { isLoading, error }] = useAcceptInvitationMutation();
  const dispatch = useAppDispatch();
  const navigate = useNavigate();

  return (
    <AuthLayout title="Join a home">
      {!token && <Alert severity="error">This invitation link is incomplete.</Alert>}
      {preview.isLoading && <CircularProgress aria-label="Loading invitation" />}
      {preview.error && <Alert severity="error">{toApiError(preview.error).message}</Alert>}
      {preview.data && (
        <Stack spacing={2} sx={{ mt: 2 }}>
          <Typography>
            <strong>{preview.data.invitedBy}</strong> invited you to join <strong>{preview.data.homeName}</strong> as <strong>{ROLE_LABELS[preview.data.role]}</strong>.
          </Typography>
          <Typography color="text.secondary" variant="body2">
            {ROLE_DESCRIPTIONS[preview.data.role]}
          </Typography>
          {error && <Alert severity="error">{toApiError(error).message}</Alert>}
          <Button
            variant="contained"
            size="large"
            disabled={isLoading}
            onClick={async () => {
              const r = await accept(token).unwrap().catch(() => null);
              if (r) {
                dispatch(api.util.invalidateTags(['Homes']));
                dispatch(setCurrentHome(r.homeId));
                navigate('/', { replace: true });
              }
            }}
          >
            Accept invitation
          </Button>
        </Stack>
      )}
    </AuthLayout>
  );
}

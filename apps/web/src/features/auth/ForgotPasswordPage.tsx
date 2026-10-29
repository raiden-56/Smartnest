import { useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { Alert, Button, Link, Stack, TextField } from '@mui/material';
import { useForm } from 'react-hook-form';
import { Link as RouterLink } from 'react-router-dom';
import { forgotPasswordSchema } from '@smartnest/shared';
import type { z } from 'zod';
import { toApiError, useForgotPasswordMutation } from '../../api/api';
import { AuthLayout } from './AuthLayout';

export default function ForgotPasswordPage() {
  const [send, { isLoading, error }] = useForgotPasswordMutation();
  const [done, setDone] = useState(false);
  const { register, handleSubmit, formState } = useForm<z.infer<typeof forgotPasswordSchema>>({ resolver: zodResolver(forgotPasswordSchema) });
  return (
    <AuthLayout title="Reset your password" subtitle="Enter the email you signed up with and we'll send a reset link.">
      {done ? (
        <Stack spacing={2}>
          <Alert severity="success">If an account exists for that email, a reset link is on its way. It expires in 30 minutes.</Alert>
          <Alert severity="info">
            This installation has no email service configured. In development, the reset link is written to the SmartNest server log. Ask your administrator if you
            can't find it.
          </Alert>
          <Button component={RouterLink} to="/login" variant="outlined">
            Back to sign in
          </Button>
        </Stack>
      ) : (
        <form noValidate onSubmit={handleSubmit(async (v) => send(v).unwrap().then(() => setDone(true)).catch(() => undefined))}>
          <Stack spacing={2}>
            {error && <Alert severity="error">{toApiError(error).message}</Alert>}
            <TextField label="Email" type="email" autoComplete="email" autoFocus {...register('email')} error={!!formState.errors.email} helperText={formState.errors.email?.message} />
            <Button type="submit" variant="contained" size="large" disabled={isLoading}>
              Send reset link
            </Button>
            <Link component={RouterLink} to="/login" variant="body2" textAlign="center">
              Back to sign in
            </Link>
          </Stack>
        </form>
      )}
    </AuthLayout>
  );
}

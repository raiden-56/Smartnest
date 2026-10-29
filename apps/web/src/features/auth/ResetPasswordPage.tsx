import { useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { Alert, Button, Stack, TextField } from '@mui/material';
import { useForm } from 'react-hook-form';
import { Link as RouterLink, useSearchParams } from 'react-router-dom';
import { z } from 'zod';
import { passwordSchema } from '@smartnest/shared';
import { toApiError, useResetPasswordMutation } from '../../api/api';
import { AuthLayout } from './AuthLayout';

const schema = z.object({ password: passwordSchema, confirm: z.string() }).refine((v) => v.password === v.confirm, { path: ['confirm'], message: 'Passwords do not match' });

export default function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [reset, { isLoading, error }] = useResetPasswordMutation();
  const [done, setDone] = useState(false);
  const { register, handleSubmit, formState } = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema) });
  return (
    <AuthLayout title="Choose a new password" subtitle="For your security, you'll be signed out on all devices.">
      {!token ? (
        <Alert severity="error">This reset link is incomplete. Request a new one from the sign-in page.</Alert>
      ) : done ? (
        <Stack spacing={2}>
          <Alert severity="success">Your password has been changed.</Alert>
          <Button component={RouterLink} to="/login" variant="contained">
            Sign in
          </Button>
        </Stack>
      ) : (
        <form noValidate onSubmit={handleSubmit(async (v) => reset({ token, password: v.password }).unwrap().then(() => setDone(true)).catch(() => undefined))}>
          <Stack spacing={2}>
            {error && <Alert severity="error">{toApiError(error).message}</Alert>}
            <TextField label="New password" type="password" autoComplete="new-password" autoFocus {...register('password')} error={!!formState.errors.password} helperText={formState.errors.password?.message ?? 'At least 10 characters, including a letter and a number.'} />
            <TextField label="Confirm new password" type="password" autoComplete="new-password" {...register('confirm')} error={!!formState.errors.confirm} helperText={formState.errors.confirm?.message} />
            <Button type="submit" variant="contained" size="large" disabled={isLoading}>
              Change password
            </Button>
          </Stack>
        </form>
      )}
    </AuthLayout>
  );
}

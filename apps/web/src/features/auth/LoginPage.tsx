import { zodResolver } from '@hookform/resolvers/zod';
import { Alert, Button, Link, Stack, TextField, Typography } from '@mui/material';
import { useForm } from 'react-hook-form';
import { Link as RouterLink, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { loginSchema } from '@smartnest/shared';
import type { z } from 'zod';
import { toApiError, useLoginMutation, useMeQuery } from '../../api/api';
import { AuthLayout } from './AuthLayout';

type Form = z.infer<typeof loginSchema>;

/** Only allow same-site relative redirects after login. */
export function safeNext(next: string | null): string {
  return next && next.startsWith('/') && !next.startsWith('//') ? next : '/';
}

export default function LoginPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const me = useMeQuery();
  const [login, { isLoading, error }] = useLoginMutation();
  const { register, handleSubmit, formState } = useForm<Form>({ resolver: zodResolver(loginSchema) });
  const next = safeNext(params.get('next'));

  if (me.data) return <Navigate to={next} replace />;

  return (
    <AuthLayout title="Welcome back" subtitle="Sign in to control your home.">
      <form
        noValidate
        onSubmit={handleSubmit(async (v) => {
          await login(v).unwrap().then(() => navigate(next, { replace: true })).catch(() => undefined);
        })}
      >
        <Stack spacing={2}>
          {error && <Alert severity="error">{toApiError(error).message}</Alert>}
          <TextField label="Email" type="email" autoComplete="email" autoFocus {...register('email')} error={!!formState.errors.email} helperText={formState.errors.email?.message} />
          <TextField label="Password" type="password" autoComplete="current-password" {...register('password')} error={!!formState.errors.password} helperText={formState.errors.password?.message} />
          <Link component={RouterLink} to="/forgot-password" variant="body2" sx={{ alignSelf: 'flex-end' }}>
            Forgot password?
          </Link>
          <Button type="submit" variant="contained" size="large" disabled={isLoading}>
            {isLoading ? 'Signing in…' : 'Sign in'}
          </Button>
          <Typography variant="body2" color="text.secondary" textAlign="center">
            New to SmartNest?{' '}
            <Link component={RouterLink} to={`/register${params.get('next') ? `?next=${encodeURIComponent(next)}` : ''}`}>
              Create an account
            </Link>
          </Typography>
        </Stack>
      </form>
    </AuthLayout>
  );
}

import { zodResolver } from '@hookform/resolvers/zod';
import { Alert, Button, Link, Stack, TextField, Typography } from '@mui/material';
import { useForm } from 'react-hook-form';
import { Link as RouterLink, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { registerSchema } from '@smartnest/shared';
import type { z } from 'zod';
import { toApiError, useMeQuery, useRegisterMutation } from '../../api/api';
import { AuthLayout } from './AuthLayout';
import { safeNext } from './LoginPage';

type Form = z.infer<typeof registerSchema>;

export default function RegisterPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const me = useMeQuery();
  const [registerUser, { isLoading, error }] = useRegisterMutation();
  const { register, handleSubmit, formState } = useForm<Form>({ resolver: zodResolver(registerSchema) });
  const next = safeNext(params.get('next'));
  if (me.data) return <Navigate to={next === '/' ? '/onboarding' : next} replace />;

  return (
    <AuthLayout title="Create your account" subtitle="Set up SmartNest in a couple of minutes. No hardware needed to explore.">
      <form
        noValidate
        onSubmit={handleSubmit(async (v) => {
          await registerUser(v).unwrap().then(() => navigate(next === '/' ? '/onboarding' : next, { replace: true })).catch(() => undefined);
        })}
      >
        <Stack spacing={2}>
          {error && <Alert severity="error">{toApiError(error).message}</Alert>}
          <TextField label="Your name" autoComplete="name" autoFocus {...register('name')} error={!!formState.errors.name} helperText={formState.errors.name?.message} />
          <TextField label="Email" type="email" autoComplete="email" {...register('email')} error={!!formState.errors.email} helperText={formState.errors.email?.message} />
          <TextField
            label="Password"
            type="password"
            autoComplete="new-password"
            {...register('password')}
            error={!!formState.errors.password}
            helperText={formState.errors.password?.message ?? 'At least 10 characters, including a letter and a number.'}
          />
          <Button type="submit" variant="contained" size="large" disabled={isLoading}>
            {isLoading ? 'Creating account…' : 'Create account'}
          </Button>
          <Typography variant="body2" color="text.secondary" textAlign="center">
            Already have an account?{' '}
            <Link component={RouterLink} to="/login">
              Sign in
            </Link>
          </Typography>
        </Stack>
      </form>
    </AuthLayout>
  );
}

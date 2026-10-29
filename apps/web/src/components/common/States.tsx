import type { ReactNode } from 'react';
import { Alert, Box, Button, Card, Skeleton, Stack, Typography } from '@mui/material';
import { AlertTriangle, Lock, RefreshCw } from 'lucide-react';
import { toApiError } from '../../api/api';
import { tokens } from '../../theme/theme';

export function PageHeader({ title, subtitle, actions, eyebrow }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode }) {
  return (
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ xs: 'stretch', sm: 'flex-end' }} justifyContent="space-between" sx={{ mb: 3 }}>
      <Box sx={{ minWidth: 0 }}>
        {eyebrow && <Box sx={{ mb: 0.5 }}>{eyebrow}</Box>}
        <Typography variant="h1" component="h1" sx={{ fontSize: { xs: '1.6rem', md: '2rem' } }}>
          {title}
        </Typography>
        {subtitle && (
          <Typography component="div" color="text.secondary" sx={{ mt: 0.5 }}>
            {subtitle}
          </Typography>
        )}
      </Box>
      {actions && (
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ flexShrink: 0 }}>
          {actions}
        </Stack>
      )}
    </Stack>
  );
}

export function EmptyState({ icon, title, description, action }: { icon?: ReactNode; title: string; description?: ReactNode; action?: ReactNode }) {
  return (
    <Box sx={{ textAlign: 'center', py: { xs: 5, md: 7 }, px: 3, border: `1px dashed ${tokens.color.border}`, borderRadius: `${tokens.radius.lg}px`, bgcolor: 'rgba(255,255,255,0.5)' }}>
      {icon && (
        <Box sx={{ width: 56, height: 56, borderRadius: '50%', bgcolor: 'sage.main', color: 'primary.dark', display: 'grid', placeItems: 'center', mx: 'auto', mb: 2 }} aria-hidden>
          {icon}
        </Box>
      )}
      <Typography variant="h4" component="p">
        {title}
      </Typography>
      {description && (
        <Typography color="text.secondary" sx={{ mt: 1, maxWidth: 460, mx: 'auto' }}>
          {description}
        </Typography>
      )}
      {action && <Box sx={{ mt: 2.5 }}>{action}</Box>}
    </Box>
  );
}

export function ErrorState({ error, onRetry, title = 'Could not load this' }: { error: unknown; onRetry?: () => void; title?: string }) {
  const e = toApiError(error);
  if (e.status === 403) return <PermissionDenied />;
  return (
    <Alert
      severity="error"
      icon={<AlertTriangle size={20} />}
      action={
        onRetry && (
          <Button color="inherit" size="small" startIcon={<RefreshCw size={14} />} onClick={onRetry}>
            Retry
          </Button>
        )
      }
    >
      <strong>{title}.</strong> {e.message}
    </Alert>
  );
}

export function PermissionDenied({ message = 'Your role in this home does not include access to this area. Ask a home owner or administrator if you need it.' }: { message?: string }) {
  return <EmptyState icon={<Lock size={24} />} title="You don't have access" description={message} />;
}

/** Explicit "Not available" marker — used instead of ever inventing a value. */
export function NotAvailable({ label = 'Not available' }: { label?: string }) {
  return (
    <Typography component="span" variant="body2" color="text.secondary" sx={{ fontStyle: 'italic' }}>
      {label}
    </Typography>
  );
}

export function SectionCard({ title, action, children, sx, dense }: { title?: ReactNode; action?: ReactNode; children: ReactNode; sx?: object; dense?: boolean }) {
  return (
    <Card sx={{ p: dense ? 2 : { xs: 2, md: 2.5 }, height: '100%', display: 'flex', flexDirection: 'column', minWidth: 0, ...sx }}>
      {(title || action) && (
        <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1} sx={{ mb: 1.5, minHeight: 32 }}>
          {typeof title === 'string' ? (
            <Typography variant="h4" component="h2" noWrap>
              {title}
            </Typography>
          ) : (
            title
          )}
          {action}
        </Stack>
      )}
      <Box sx={{ flex: 1, minHeight: 0 }}>{children}</Box>
    </Card>
  );
}

// ─── Skeletons (dimensions mirror the real components) ────────────────────

export function SummaryCardsSkeleton({ count = 6 }: { count?: number }) {
  return (
    <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: 'repeat(2, 1fr)', md: 'repeat(3, 1fr)', lg: `repeat(${count}, 1fr)` } }} aria-busy aria-label="Loading summary">
      {Array.from({ length: count }, (_, i) => (
        <Card key={i} sx={{ p: 2, height: 96 }}>
          <Skeleton width="50%" height={18} />
          <Skeleton width="35%" height={36} sx={{ mt: 1 }} />
        </Card>
      ))}
    </Box>
  );
}

export function DeviceGridSkeleton({ count = 8 }: { count?: number }) {
  return (
    <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))' }} aria-busy aria-label="Loading devices">
      {Array.from({ length: count }, (_, i) => (
        <Card key={i} sx={{ p: 2, height: 184 }}>
          <Stack direction="row" spacing={1.5} alignItems="center">
            <Skeleton variant="rounded" width={44} height={44} />
            <Box sx={{ flex: 1 }}>
              <Skeleton width="70%" height={22} />
              <Skeleton width="45%" height={16} />
            </Box>
          </Stack>
          <Skeleton width="40%" height={24} sx={{ mt: 2 }} />
          <Skeleton variant="rounded" height={36} sx={{ mt: 2 }} />
        </Card>
      ))}
    </Box>
  );
}

export function RoomCardsSkeleton({ count = 6 }: { count?: number }) {
  return (
    <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }} aria-busy aria-label="Loading rooms">
      {Array.from({ length: count }, (_, i) => (
        <Card key={i} sx={{ p: 2, height: 148 }}>
          <Skeleton variant="rounded" width={40} height={40} />
          <Skeleton width="60%" height={24} sx={{ mt: 1.5 }} />
          <Skeleton width="40%" height={16} />
        </Card>
      ))}
    </Box>
  );
}

export function ListSkeleton({ rows = 6, height = 56 }: { rows?: number; height?: number }) {
  return (
    <Stack spacing={1} aria-busy aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <Stack key={i} direction="row" spacing={1.5} alignItems="center" sx={{ height }}>
          <Skeleton variant="circular" width={32} height={32} />
          <Box sx={{ flex: 1 }}>
            <Skeleton width="60%" height={18} />
            <Skeleton width="30%" height={14} />
          </Box>
        </Stack>
      ))}
    </Stack>
  );
}

export function ChartSkeleton({ height = 280 }: { height?: number }) {
  return <Skeleton variant="rounded" height={height} aria-busy aria-label="Loading chart" />;
}

export function CameraSkeleton() {
  return <Skeleton variant="rounded" sx={{ aspectRatio: '16 / 9', height: 'auto', width: '100%' }} aria-busy aria-label="Loading camera" />;
}

export function DetailSkeleton() {
  return (
    <Box aria-busy aria-label="Loading">
      <Skeleton width={260} height={44} />
      <Skeleton width={180} height={22} sx={{ mb: 3 }} />
      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', md: '2fr 1fr' } }}>
        <Skeleton variant="rounded" height={360} />
        <Skeleton variant="rounded" height={360} />
      </Box>
    </Box>
  );
}

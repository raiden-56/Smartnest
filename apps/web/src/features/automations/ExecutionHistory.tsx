import { useState } from 'react';
import { Box, Collapse, IconButton, Stack, Typography } from '@mui/material';
import { CheckCircle2, ChevronDown, ChevronRight, CircleDashed, FlaskConical, MinusCircle, XCircle } from 'lucide-react';
import type { AutomationExecutionDto } from '@smartnest/shared';
import { formatDateTime, timeAgo } from '../../app/hooks';
import { tokens } from '../../theme/theme';
import { ExecStatusChip } from './shared';

const STEP_ICON = {
  ok: <CheckCircle2 size={16} color={tokens.color.success} aria-hidden />,
  failed: <XCircle size={16} color={tokens.color.error} aria-hidden />,
  skipped: <MinusCircle size={16} color={tokens.color.textSecondary} aria-hidden />,
  simulated: <FlaskConical size={16} color={tokens.color.primary} aria-hidden />,
};
const STEP_LABEL = { ok: 'Done', failed: 'Failed', skipped: 'Skipped', simulated: 'Simulated — not executed' };

export function ExecutionSteps({ execution }: { execution: AutomationExecutionDto }) {
  if (!execution.steps.length) {
    return (
      <Typography variant="body2" color="text.secondary">
        {execution.status === 'running' ? 'Running…' : 'No steps recorded.'}
      </Typography>
    );
  }
  return (
    <Stack spacing={0.75} component="ol" sx={{ m: 0, pl: 0, listStyle: 'none' }}>
      {execution.steps.map((s) => (
        <Stack key={s.index} component="li" direction="row" spacing={1} alignItems="flex-start">
          <Box sx={{ pt: '2px' }}>{STEP_ICON[s.status] ?? <CircleDashed size={16} />}</Box>
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="body2" fontWeight={600}>
              {s.description} <Typography component="span" variant="caption">— {STEP_LABEL[s.status] ?? s.status}</Typography>
            </Typography>
            {s.message && (
              <Typography variant="caption" component="p" sx={{ color: s.status === 'failed' ? 'error.main' : 'text.secondary', wordBreak: 'break-word' }}>
                {s.message}
              </Typography>
            )}
          </Box>
        </Stack>
      ))}
    </Stack>
  );
}

export function ExecutionHistory({ executions }: { executions: AutomationExecutionDto[] }) {
  const [open, setOpen] = useState<string | null>(executions[0]?.id ?? null);
  if (!executions.length) {
    return <Typography color="text.secondary">This automation has not run yet. Runs where the conditions were not met are not recorded.</Typography>;
  }
  return (
    <Stack divider={<Box sx={{ borderTop: `1px solid ${tokens.color.border}` }} />}>
      {executions.map((e) => {
        const expanded = open === e.id;
        return (
          <Box key={e.id} sx={{ py: 1 }}>
            <Stack direction="row" spacing={1} alignItems="center" sx={{ cursor: 'pointer' }} onClick={() => setOpen(expanded ? null : e.id)}>
              <IconButton size="small" aria-label={expanded ? 'Hide steps' : 'Show steps'} aria-expanded={expanded}>
                {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
              </IconButton>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="body2" fontWeight={600} noWrap title={e.triggeredBy}>
                  {e.triggeredBy}
                </Typography>
                <Typography variant="caption" title={formatDateTime(e.startedAt)}>
                  {timeAgo(e.startedAt)} · {formatDateTime(e.startedAt)}
                  {e.completedAt && ` · ${Math.max(0, Math.round((new Date(e.completedAt).getTime() - new Date(e.startedAt).getTime()) / 100) / 10)}s`}
                </Typography>
              </Box>
              <ExecStatusChip status={e.status} />
            </Stack>
            <Collapse in={expanded} unmountOnExit>
              <Box sx={{ pl: { xs: 1, sm: 5 }, pt: 1 }}>
                <ExecutionSteps execution={e} />
                {e.error && (
                  <Typography variant="caption" component="p" sx={{ mt: 1, color: 'error.main', wordBreak: 'break-word' }}>
                    {e.error}
                  </Typography>
                )}
              </Box>
            </Collapse>
          </Box>
        );
      })}
    </Stack>
  );
}

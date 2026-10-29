import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, Stack } from '@mui/material';
import type { AutomationExecutionDto } from '@smartnest/shared';
import { ExecutionSteps } from './ExecutionHistory';
import { ExecStatusChip } from './shared';

export function RunResultDialog({ result, onClose }: { result: { title: string; execution: AutomationExecutionDto | null; message?: string } | null; onClose: () => void }) {
  const e = result?.execution;
  const severity = !e ? 'info' : e.status === 'succeeded' ? 'success' : e.status === 'simulated' || e.status === 'skipped' ? 'info' : e.status === 'running' ? 'info' : 'warning';
  const summary = !e
    ? null
    : {
        succeeded: 'All actions completed.',
        partial: 'Some actions failed — see the steps below.',
        failed: 'The actions failed — see the steps below.',
        skipped: 'Conditions are not met right now, so no actions ran.',
        simulated: 'Conditions are met. These actions would run:',
        running: 'Still running…',
      }[e.status];
  return (
    <Dialog open={!!result} onClose={onClose} maxWidth="sm" fullWidth aria-labelledby="run-result-title">
      <DialogTitle id="run-result-title">{result?.title}</DialogTitle>
      <DialogContent>
        <Stack spacing={2}>
          {result?.message && <Alert severity="info">{result.message}</Alert>}
          {e && (
            <Alert severity={severity} action={<ExecStatusChip status={e.status} />}>
              {summary}
            </Alert>
          )}
          {e && <ExecutionSteps execution={e} />}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} variant="contained">
          Close
        </Button>
      </DialogActions>
    </Dialog>
  );
}

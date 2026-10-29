import { useState } from 'react';
import type { AutomationDto, AutomationExecutionDto } from '@smartnest/shared';
import { toApiError, useDeleteAutomationMutation, useDuplicateAutomationMutation, useRunAutomationMutation, useSetAutomationEnabledMutation, useSimulateAutomationMutation } from '../../api/api';
import { useHome } from '../../app/hooks';
import { pushToast, useAppDispatch } from '../../app/store';
import { useConfirm } from '../../components/common/Dialogs';

/** Shared enable / run / test / duplicate / delete handlers with consistent feedback. */
export function useAutomationActions() {
  const { homeId } = useHome();
  const dispatch = useAppDispatch();
  const confirm = useConfirm();
  const [setEnabled] = useSetAutomationEnabledMutation();
  const [run] = useRunAutomationMutation();
  const [simulate] = useSimulateAutomationMutation();
  const [duplicate] = useDuplicateAutomationMutation();
  const [remove] = useDeleteAutomationMutation();
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<{ title: string; execution: AutomationExecutionDto | null; message?: string } | null>(null);

  const err = (e: unknown) => dispatch(pushToast({ message: toApiError(e).message, severity: 'error' }));
  const guard = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try {
      await fn();
    } catch (e) {
      err(e);
    } finally {
      setBusy(null);
    }
  };

  return {
    busy,
    result,
    closeResult: () => setResult(null),
    toggle: (a: AutomationDto, enabled: boolean) =>
      guard(`toggle:${a.id}`, async () => {
        await setEnabled({ homeId, automationId: a.id, enabled }).unwrap();
        dispatch(pushToast({ message: `${a.name} ${enabled ? 'enabled' : 'disabled'}${a.executor === 'home_assistant' ? ' in Home Assistant' : ''}`, severity: 'success' }));
      }),
    run: (a: AutomationDto) =>
      guard(`run:${a.id}`, async () => {
        if (a.executor === 'smartnest') {
          const ok = await confirm({ title: `Run “${a.name}” now?`, message: 'Its actions will run for real if its conditions are met. Use “Test” to preview without executing anything.', confirmLabel: 'Run now' });
          if (!ok) return;
        }
        const r = await run({ homeId, automationId: a.id }).unwrap();
        setResult({ title: `Ran “${a.name}”`, execution: r.execution, message: r.message });
      }),
    simulate: (a: AutomationDto) =>
      guard(`sim:${a.id}`, async () => {
        const r = await simulate({ homeId, automationId: a.id }).unwrap();
        setResult({ title: `Test of “${a.name}”`, execution: r.execution, message: 'Nothing was executed. Conditions were evaluated against current device states.' });
      }),
    duplicate: (a: AutomationDto) =>
      guard(`dup:${a.id}`, async () => {
        await duplicate({ homeId, automationId: a.id }).unwrap();
        dispatch(pushToast({ message: 'Copy created (disabled)', severity: 'success' }));
      }),
    remove: async (a: AutomationDto, after?: () => void) => {
      const ok = await confirm({ title: `Delete “${a.name}”?`, message: 'The automation and its execution history will be permanently deleted.', tone: 'danger', confirmLabel: 'Delete' });
      if (!ok) return;
      await guard(`del:${a.id}`, async () => {
        await remove({ homeId, automationId: a.id }).unwrap();
        dispatch(pushToast({ message: 'Automation deleted', severity: 'success' }));
        after?.();
      });
    },
  };
}

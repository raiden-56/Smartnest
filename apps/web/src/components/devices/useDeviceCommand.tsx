import { useCallback, useEffect, useRef } from 'react';
import { nanoid } from '@reduxjs/toolkit';
import { describeCommand, isSensitiveCommand, type CommandDto, type DeviceCommand, type DeviceDto } from '@smartnest/shared';
import { toApiError, useLazyCommandQuery, useSendCommandMutation } from '../../api/api';
import { useHome } from '../../app/hooks';
import { announce, commandUpdated, pushToast, useAppDispatch, useAppSelector } from '../../app/store';
import { useConfirm, useReauth } from '../common/Dialogs';

const TERMINAL = new Set(['confirmed', 'failed', 'timed_out']);

/**
 * Send a typed command to a device and track its lifecycle.
 * - Sensitive commands (unlock, disarm, open garage…) require explicit confirmation.
 * - "reauth_required" prompts for the password and retries once with the same idempotency key.
 * - Results arrive over the WebSocket; if it's down, the hook polls the command.
 * The UI never assumes success — it shows pending until the server confirms.
 */
export function useDeviceCommand(device: DeviceDto) {
  const { homeId } = useHome();
  const dispatch = useAppDispatch();
  const confirm = useConfirm();
  const reauth = useReauth();
  const [sendCommand] = useSendCommandMutation();
  const [fetchCommand] = useLazyCommandQuery();
  const realtime = useAppSelector((s) => s.ui.realtime);
  const latest = useAppSelector((s) => {
    const id = s.live.latestCommandByDevice[device.id];
    return id ? s.live.commands[id] : undefined;
  });
  const pollers = useRef<number[]>([]);

  useEffect(() => () => pollers.current.forEach((t) => window.clearInterval(t)), []);

  const poll = useCallback(
    (commandId: string) => {
      let n = 0;
      const t = window.setInterval(async () => {
        n++;
        const r = await fetchCommand({ homeId, commandId }).unwrap().catch(() => null);
        if (r) dispatch(commandUpdated(r.command));
        if ((r && TERMINAL.has(r.command.status)) || n > 20) window.clearInterval(t);
      }, 1500);
      pollers.current.push(t);
    },
    [dispatch, fetchCommand, homeId],
  );

  const send = useCallback(
    async (command: DeviceCommand): Promise<CommandDto | null> => {
      const sensitive = isSensitiveCommand(command, device.capabilities);
      if (sensitive) {
        const ok = await confirm({
          title: `${describeCommand(command)} — ${device.name}?`,
          message: (
            <>
              This is a security-sensitive action{device.isDemo ? ' (demo device — nothing physical will change)' : ''}. It will be recorded in the audit log.
            </>
          ),
          tone: 'security',
          confirmLabel: describeCommand(command),
        });
        if (!ok) return null;
      }
      const idempotencyKey = nanoid();
      const attempt = () => sendCommand({ homeId, deviceId: device.id, command, idempotencyKey, confirmed: sensitive || undefined }).unwrap();
      try {
        let res: { command: CommandDto };
        try {
          res = await attempt();
        } catch (e) {
          if (toApiError(e).code !== 'reauth_required') throw e;
          if (!(await reauth())) return null;
          res = await attempt();
        }
        dispatch(commandUpdated(res.command));
        if (realtime !== 'live') poll(res.command.id);
        return res.command;
      } catch (e) {
        const err = toApiError(e);
        dispatch(pushToast({ message: `${device.name}: ${err.message}`, severity: 'error' }));
        dispatch(announce(`${describeCommand(command)} for ${device.name} could not be sent. ${err.message}`));
        return null;
      }
    },
    [confirm, device, dispatch, homeId, poll, realtime, reauth, sendCommand],
  );

  const pending = !!latest && (latest.status === 'pending' || latest.status === 'sent');
  return {
    send,
    latest,
    pending,
    /** Pending for a specific capability (so only the relevant control shows a spinner) */
    pendingFor: (capability: string) => pending && latest?.command.capability === capability,
  };
}

export function controlsDisabledReason(device: DeviceDto): string | null {
  if (device.integrationDisconnected) return 'The integration for this device is disconnected.';
  if (device.connectivity === 'offline') return 'The device is offline.';
  if (device.connectivity === 'unavailable') return 'The device is unavailable.';
  return null;
}

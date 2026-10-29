import { useEffect, useRef } from 'react';
import type { RealtimeEvent } from '@smartnest/shared';
import { api } from '../api/api';
import { announce, cameraViewers, commandUpdated, deviceRemoved, deviceUpdated, pushToast, sceneExecutionUpdated, setRealtime, useAppDispatch } from '../app/store';

type Tag = Parameters<typeof api.util.invalidateTags>[0][number];

/**
 * Connects to the authenticated WebSocket channel for the current home and
 * folds server events into the Redux store. Reconnects with backoff; while
 * disconnected the UI shows a "Reconnecting" indicator and components fall
 * back to polling for command results.
 */
export function useRealtime(homeId: string | null): void {
  const dispatch = useAppDispatch();
  const pendingTags = useRef(new Set<string>());
  const flushTimer = useRef<number | null>(null);

  useEffect(() => {
    if (!homeId) return;
    let ws: WebSocket | null = null;
    let closed = false;
    let attempt = 0;
    let retryTimer: number | null = null;

    const invalidate = (...tags: string[]) => {
      tags.forEach((t) => pendingTags.current.add(t));
      if (flushTimer.current) return;
      flushTimer.current = window.setTimeout(() => {
        flushTimer.current = null;
        const list = [...pendingTags.current] as Tag[];
        pendingTags.current.clear();
        dispatch(api.util.invalidateTags(list));
      }, 1500);
    };

    const handle = (e: RealtimeEvent) => {
      switch (e.type) {
        case 'device.updated':
          dispatch(deviceUpdated(e.device));
          invalidate('DeviceCounts', 'Rooms');
          break;
        case 'device.removed':
          dispatch(deviceRemoved(e.deviceId));
          invalidate('DeviceCounts', 'Rooms', 'Devices');
          break;
        case 'command.updated': {
          dispatch(commandUpdated(e.command));
          const c = e.command;
          if (c.source === 'user' && (c.status === 'failed' || c.status === 'timed_out')) {
            dispatch(announce(`${c.description} for ${c.deviceName} ${c.status === 'failed' ? 'failed' : 'was not confirmed'}.`));
          } else if (c.source === 'user' && c.status === 'confirmed') {
            dispatch(announce(`${c.deviceName}: ${c.description} ${c.verified ? 'confirmed' : 'acknowledged'}.`));
          }
          break;
        }
        case 'scene.execution':
          dispatch(sceneExecutionUpdated(e.execution));
          if (e.execution.status !== 'running') invalidate('Scenes', 'SceneExecutions');
          break;
        case 'automation.execution':
          invalidate('Automations', 'AutomationExecutions');
          break;
        case 'activity.created':
          invalidate('Activity');
          break;
        case 'notification.created':
          invalidate('Notifications');
          if (e.notification.severity === 'critical' || e.notification.severity === 'warning') {
            dispatch(pushToast({ message: e.notification.title, severity: e.notification.severity === 'critical' ? 'error' : 'warning', action: e.notification.link ? { label: 'View', href: e.notification.link } : undefined }));
          }
          break;
        case 'integration.updated':
          invalidate('Integrations');
          break;
        case 'camera.viewers':
          dispatch(cameraViewers({ deviceId: e.deviceId, count: e.activeViewers }));
          break;
        case 'home.changed':
          invalidate('Home', 'Rooms', 'Members', 'Devices', 'DeviceCounts', 'Integrations');
          break;
      }
    };

    const connect = () => {
      dispatch(setRealtime(attempt === 0 ? 'connecting' : 'reconnecting'));
      const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
      ws = new WebSocket(`${proto}://${window.location.host}/api/ws`);
      ws.onopen = () => ws?.send(JSON.stringify({ type: 'subscribe', homeId }));
      ws.onmessage = (m) => {
        let msg: RealtimeEvent | { type: 'subscribed' | 'ready' | 'pong' | 'error' };
        try {
          msg = JSON.parse(m.data as string);
        } catch {
          return;
        }
        if (msg.type === 'subscribed') {
          if (attempt > 0) invalidate('Devices', 'DeviceCounts', 'Rooms', 'Activity', 'Integrations', 'Notifications'); // resync after a gap
          attempt = 0;
          dispatch(setRealtime('live'));
          return;
        }
        if (msg.type === 'ready' || msg.type === 'pong' || msg.type === 'error') return;
        handle(msg as RealtimeEvent);
      };
      ws.onclose = (ev) => {
        ws = null;
        if (closed) return;
        if (ev.code === 4401) {
          dispatch(setRealtime('offline'));
          dispatch(api.util.invalidateTags(['Me']));
          return;
        }
        dispatch(setRealtime('reconnecting'));
        const delay = Math.min(30_000, 1000 * 2 ** attempt) * (0.5 + Math.random() / 2);
        attempt++;
        retryTimer = window.setTimeout(connect, delay);
      };
    };
    connect();

    return () => {
      closed = true;
      if (retryTimer) window.clearTimeout(retryTimer);
      ws?.close();
    };
  }, [homeId, dispatch]);
}

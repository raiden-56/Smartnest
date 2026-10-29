import { useMemo } from 'react';
import { LOW_BATTERY_THRESHOLD, hasCapability, type DeviceDto } from '@smartnest/shared';
import { useDevicesQuery } from '../../../api/api';
import { useHome } from '../../../app/hooks';
import { useLiveDevices } from '../../../app/store';

const POLL = { pollingInterval: 60_000 };

function mergeUnique(...lists: (DeviceDto[] | undefined)[]): DeviceDto[] {
  const map = new Map<string, DeviceDto>();
  for (const l of lists) for (const d of l ?? []) map.set(d.id, d);
  return [...map.values()];
}

/** Locks, alarm panels, contact sensors and safety devices — the inputs for security views. */
export function useSecurityDevices() {
  const { homeId, can } = useHome();
  const skip = !can('devices.view');
  const locks = useDevicesQuery({ homeId, capability: 'lock', pageSize: 50 }, { ...POLL, skip });
  const alarms = useDevicesQuery({ homeId, capability: 'alarmPanel', pageSize: 20 }, { ...POLL, skip });
  const contacts = useDevicesQuery({ homeId, capability: 'contact', pageSize: 50 }, { ...POLL, skip });
  const safety = useDevicesQuery({ homeId, capability: 'safetyAlarm', pageSize: 50 }, { ...POLL, skip });
  const merged = useMemo(() => mergeUnique(alarms.data?.items, locks.data?.items, contacts.data?.items, safety.data?.items), [alarms.data, locks.data, contacts.data, safety.data]);
  const devices = useLiveDevices(merged);
  const queries = [locks, alarms, contacts, safety];
  return {
    devices,
    isLoading: queries.some((q) => q.isLoading),
    error: queries.find((q) => q.error)?.error,
    refetch: () => queries.forEach((q) => void q.refetch()),
  };
}

export interface SecurityAlert {
  device: DeviceDto;
  reason: string;
}

/** Active alerts are computed only from reported states — nothing is inferred for offline devices. */
export function computeSecurityAlerts(devices: DeviceDto[]): SecurityAlert[] {
  const online = devices.filter((d) => d.connectivity === 'online');
  const armed = online.some((d) => typeof d.state.alarmState === 'string' && d.state.alarmState.startsWith('armed'));
  const alerts: SecurityAlert[] = [];
  for (const d of online) {
    if (hasCapability(d.capabilities, 'safetyAlarm') && d.state.hazardDetected) alerts.push({ device: d, reason: 'Hazard detected' });
    else if (hasCapability(d.capabilities, 'alarmPanel') && d.state.alarmState === 'triggered') alerts.push({ device: d, reason: 'Alarm triggered' });
    else if (hasCapability(d.capabilities, 'lock') && d.state.lockState === 'jammed') alerts.push({ device: d, reason: 'Lock jammed' });
    else if (armed && hasCapability(d.capabilities, 'contact') && d.state.contactOpen) alerts.push({ device: d, reason: 'Open while alarm is armed' });
  }
  return alerts;
}

export function isLowBattery(d: DeviceDto): boolean {
  return d.state.batteryLevel !== undefined && d.state.batteryLevel <= LOW_BATTERY_THRESHOLD;
}

export function attentionReason(d: DeviceDto): string | null {
  if (d.integrationDisconnected) return 'Integration disconnected';
  if (d.connectivity === 'offline') return 'Offline';
  if (d.connectivity === 'unavailable') return 'Unavailable';
  if (d.connectivity === 'unknown') return 'Connectivity unknown';
  if (d.lastError) return d.lastError;
  return null;
}

/** Devices that are offline/unavailable/unknown or reported a recent error. */
export function useAttentionDevices() {
  const { homeId, can } = useHome();
  const skip = !can('devices.view');
  const offline = useDevicesQuery({ homeId, connectivity: 'offline', pageSize: 50 }, { ...POLL, skip });
  const unavailable = useDevicesQuery({ homeId, connectivity: 'unavailable', pageSize: 50 }, { ...POLL, skip });
  const unknown = useDevicesQuery({ homeId, connectivity: 'unknown', pageSize: 50 }, { ...POLL, skip });
  const recent = useDevicesQuery({ homeId, sort: 'updated', order: 'desc', pageSize: 100 }, { ...POLL, skip });
  const merged = useMemo(
    () => mergeUnique(offline.data?.items, unavailable.data?.items, unknown.data?.items, recent.data?.items),
    [offline.data, unavailable.data, unknown.data, recent.data],
  );
  const live = useLiveDevices(merged);
  const devices = live.filter((d) => attentionReason(d) !== null);
  const queries = [offline, unavailable, unknown, recent];
  return { devices, isLoading: queries.some((q) => q.isLoading), error: queries.find((q) => q.error)?.error, refetch: () => queries.forEach((q) => void q.refetch()) };
}

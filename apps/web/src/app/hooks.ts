import { useMemo } from 'react';
import { formatDistanceToNowStrict, format } from 'date-fns';
import { convertTemperature, roleHasPermission, type HomeDto, type Permission } from '@smartnest/shared';
import { useHomeQuery, useMeQuery } from '../api/api';
import { useAppSelector } from './store';

/** The selected home plus a permission checker. Pages render only inside a selected home. */
export function useCurrentHome() {
  const homeId = useAppSelector((s) => s.ui.currentHomeId);
  const q = useHomeQuery(homeId ?? '', { skip: !homeId });
  const home = q.data?.home;
  return useMemo(
    () => ({
      homeId: homeId ?? '',
      home,
      isLoading: q.isLoading,
      error: q.error,
      can: (p: Permission) => !!home && roleHasPermission(home.role, p),
    }),
    [homeId, home, q.isLoading, q.error],
  );
}

/** Must be used inside the authenticated shell, where the home is guaranteed. */
export function useHome(): { homeId: string; home: HomeDto; can: (p: Permission) => boolean } {
  const { homeId, home, can } = useCurrentHome();
  return { homeId, home: home as HomeDto, can };
}

/** Temperature display respecting the user's preference, falling back to the home's unit. */
export function useTemperatureUnit(): 'C' | 'F' {
  const { home } = useCurrentHome();
  const me = useMeQuery();
  const pref = me.data?.preferences.temperatureUnit ?? 'home';
  return pref === 'home' ? (home?.temperatureUnit ?? 'C') : pref;
}

export function useFormatTemperature() {
  const unit = useTemperatureUnit();
  return (value: number | undefined | null, deviceUnit: 'C' | 'F' = 'C', digits = 1) => {
    if (value === undefined || value === null || Number.isNaN(value)) return null;
    const v = convertTemperature(value, deviceUnit, unit);
    return `${v.toFixed(digits)}°${unit}`;
  };
}

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return 'Never';
  const d = new Date(iso);
  if (Date.now() - d.getTime() < 15_000) return 'just now';
  return `${formatDistanceToNowStrict(d)} ago`;
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return format(new Date(iso), 'd MMM yyyy, HH:mm');
}

export function formatTime(iso: string): string {
  return format(new Date(iso), 'HH:mm');
}

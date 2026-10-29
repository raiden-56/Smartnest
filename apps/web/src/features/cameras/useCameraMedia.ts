import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { toApiError, useCameraTokenMutation } from '../../api/api';

/** Tokens are valid for 60 s; renew comfortably before expiry. */
const TOKEN_RENEW_MS = 45_000;
export const SNAPSHOT_REFRESH_MS = 5_000;

export function usePageVisible(): boolean {
  const [visible, setVisible] = useState(() => typeof document === 'undefined' || document.visibilityState !== 'hidden');
  useEffect(() => {
    const on = () => setVisible(document.visibilityState !== 'hidden');
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, []);
  return visible;
}

export function useInView(ref: RefObject<Element | null>): boolean {
  const [inView, setInView] = useState(true);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver((entries) => setInView(entries.some((e) => e.isIntersecting)), { rootMargin: '100px' });
    io.observe(el);
    return () => io.disconnect();
  }, [ref]);
  return inView;
}

/**
 * Short-lived, signed media URLs for one camera. URLs come only from the
 * server's token endpoint — no integration credentials ever reach the browser.
 */
export function useCameraMedia(homeId: string, deviceId: string, active: boolean) {
  const [getToken] = useCameraTokenMutation();
  const [urls, setUrls] = useState<{ snapshotUrl: string; streamUrl: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const cancelled = useRef(false);

  const fetchToken = useCallback(async () => {
    try {
      const r = await getToken({ homeId, deviceId }).unwrap();
      if (!cancelled.current) {
        setUrls({ snapshotUrl: r.snapshotUrl, streamUrl: r.streamUrl });
        setError(null);
      }
    } catch (e) {
      if (!cancelled.current) setError(toApiError(e).message);
    }
  }, [getToken, homeId, deviceId]);

  useEffect(() => {
    cancelled.current = false;
    if (!active) return;
    void fetchToken();
    const t = window.setInterval(() => void fetchToken(), TOKEN_RENEW_MS);
    return () => {
      cancelled.current = true;
      window.clearInterval(t);
    };
  }, [active, fetchToken]);

  // Periodic snapshot refresh while active
  useEffect(() => {
    if (!active) return;
    const t = window.setInterval(() => setTick((x) => x + 1), SNAPSHOT_REFRESH_MS);
    return () => window.clearInterval(t);
  }, [active]);

  const snapshotSrc = urls ? `${urls.snapshotUrl}&_=${tick}` : null;
  const refresh = useCallback(() => {
    setTick((x) => x + 1);
    void fetchToken();
  }, [fetchToken]);

  return { urls, snapshotSrc, error, refresh };
}

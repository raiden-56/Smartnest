import type { ReactNode } from 'react';
import { MotionConfig } from 'framer-motion';
import { useMeQuery } from '../api/api';

/**
 * Applies the user's animation preference. "system" (default) follows the
 * OS prefers-reduced-motion setting; CSS transitions are also disabled by the
 * theme's reduced-motion media query.
 */
export function MotionPreference({ children }: { children: ReactNode }) {
  const me = useMeQuery();
  const pref = me.data?.preferences.reducedMotion ?? 'system';
  return <MotionConfig reducedMotion={pref === 'on' ? 'always' : pref === 'off' ? 'never' : 'user'}>{children}</MotionConfig>;
}

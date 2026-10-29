/**
 * Guest mode: a frontend-only way to explore SmartNest with sample data, used
 * where no backend is available (e.g. the GitHub Pages build). It is compiled
 * in only when VITE_GUEST_MODE=true; otherwise every helper here is inert and
 * the app talks to the real API exactly as before.
 */
export const GUEST_MODE_AVAILABLE = import.meta.env.VITE_GUEST_MODE === 'true';

const KEY = 'smartnest.guest';
/** Fallback for browsers that block sessionStorage: guest mode then lasts until reload. */
let memoryFlag = false;

/** True while a guest session is active in this browser tab (survives reloads). */
export function isGuest(): boolean {
  if (!GUEST_MODE_AVAILABLE) return false;
  if (memoryFlag) return true;
  try {
    return sessionStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

export function startGuestSession(): void {
  memoryFlag = true;
  try {
    sessionStorage.setItem(KEY, '1');
  } catch {
    /* storage unavailable */
  }
}

export function endGuestSession(): void {
  memoryFlag = false;
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* storage unavailable */
  }
}

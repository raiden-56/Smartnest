export function startOfHour(d: Date): Date {
  const x = new Date(d);
  x.setUTCMinutes(0, 0, 0);
  return x;
}

/** Current wall-clock parts in an IANA timezone, without external date libraries. */
export function zonedNow(timezone: string, at = new Date()): { hour: number; minute: number; weekday: number; dateKey: string } {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', minute: '2-digit', weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hourCycle: 'h23' }).formatToParts(at);
  } catch {
    parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', hour: '2-digit', minute: '2-digit', weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hourCycle: 'h23' }).formatToParts(at);
  }
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return {
    hour: Number(get('hour')),
    minute: Number(get('minute')),
    weekday: weekdays.indexOf(get('weekday')),
    dateKey: `${get('year')}-${get('month')}-${get('day')}`,
  };
}

/** The instant at which the current local day began in `timezone`. */
export function startOfLocalDay(timezone: string, at = new Date()): Date {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(at);
  } catch {
    parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(at);
  }
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const elapsedMs = ((get('hour') * 60 + get('minute')) * 60 + get('second')) * 1000 + at.getMilliseconds();
  return new Date(at.getTime() - elapsedMs);
}

export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

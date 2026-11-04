const POINTS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];

export function compass(az: number): string {
  return POINTS[Math.round((((az % 360) + 360) % 360) / 22.5) % 16];
}

// Times are shown in the observer's time zone (a city's zone, or the device's when unknown),
// so "Tomorrow 05:42" means 05:42 where you'll be standing.
let zone: string | undefined;

/** IANA zone such as "Asia/Tokyo"; undefined = this device's zone. Invalid names are ignored. */
export function setTimeZone(tz?: string) {
  try {
    if (tz) new Intl.DateTimeFormat('en', { timeZone: tz });
    zone = tz;
  } catch {
    zone = undefined;
  }
}

export const timeZone = () => zone;

/** Short zone name for display, e.g. "GMT+9" or "PST". */
export function tzName(d: Date): string {
  const part = new Intl.DateTimeFormat([], { timeZone: zone, timeZoneName: 'short' })
    .formatToParts(d)
    .find((p) => p.type === 'timeZoneName');
  return part?.value ?? '';
}

export function fmtTime(d: Date, seconds = true): string {
  return d.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    ...(seconds ? { second: '2-digit' } : {}),
    timeZone: zone,
  });
}

const dayKey = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: zone });

export function fmtDay(d: Date, ref: Date): string {
  if (dayKey(d) === dayKey(ref)) return 'Today';
  if (dayKey(d) === dayKey(new Date(ref.getTime() + 86_400_000))) return 'Tomorrow';
  return d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short', timeZone: zone });
}

export function fmtUtc(d: Date): string {
  return `${d.toISOString().slice(11, 19)} UTC`;
}

export function fmtAgo(ms: number): string {
  const m = Math.round(ms / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}

export function fmtDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}m ${String(s % 60).padStart(2, '0')}s` : `${s}s`;
}

export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** Friendly countdown: "now", "in 4 min", "in 2 h 05 min", "in 3 days". */
export function fmtIn(ms: number): string {
  if (ms < 60_000) return 'now';
  const m = Math.round(ms / 60_000);
  if (m < 60) return `in ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 48) return `in ${h} h ${String(m % 60).padStart(2, '0')} min`;
  return `in ${Math.round(h / 24)} days`;
}

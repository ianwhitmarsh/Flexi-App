/** Small shared helpers. */

let counter = 0;

/** Collision-resistant id for client-created records (demo backend). */
export function uid(prefix = 'id'): string {
  counter += 1;
  return `${prefix}_${Date.now().toString(36)}_${counter.toString(36)}`;
}

export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Format an ISO date (yyyy-mm-dd) as e.g. "Sat, Jun 7". */
export function formatDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

/** "8:00 AM – 4:00 PM" from "08:00"/"16:00". */
export function formatTimeRange(start: string, end: string): string {
  return `${prettyTime(start)} – ${prettyTime(end)}`;
}

function prettyTime(t: string): string {
  const [hStr, m] = t.split(':');
  let h = Number(hStr);
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${m ?? '00'} ${ampm}`;
}

/**
 * "HH:MM" (24h) as minutes past midnight. Use this rather than comparing the
 * strings directly — "9:00" sorts after "10:00" but is earlier in the day.
 */
export function minutesOfDay(t: string): number {
  const [h, m] = t.split(':');
  return Number(h) * 60 + Number(m ?? 0);
}

export function timeAgo(iso?: string): string {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.round(hrs / 24)}d`;
}

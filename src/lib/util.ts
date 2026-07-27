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

/** The date, times and zone any shift-like value needs for its span. */
type ShiftTimes = {
  date: string;
  startTime: string;
  endTime: string;
  /** IANA zone the wall-clock times belong to. Absent on shifts posted before
   *  it was recorded — those fall back to the viewer's zone. */
  timezone?: string;
};

/**
 * The wall clock a given instant shows in `timezone`, as epoch milliseconds of
 * that reading treated as if it were UTC. Comparing it to the instant gives the
 * zone's offset at that moment, DST included.
 */
function wallClockAsUtc(instant: number, timezone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(instant));

  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  // `hour12: false` can render midnight as 24; Date.UTC normalises it anyway.
  return Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
}

/**
 * The instant at which `timezone` reads the given wall clock.
 *
 * Solved by correction rather than by an offset table: guess that the wall
 * clock is UTC, ask the zone what it would actually show then, and shift by the
 * difference. One further pass settles the cases where the first correction
 * crosses a DST boundary and lands on a different offset.
 *
 * Ambiguous times — the hour that repeats when clocks go back — resolve to the
 * first of the two, and non-existent times to the instant the clock jumps to.
 * Both are deterministic, which is what matters for a shift boundary.
 */
function instantInZone(
  year: number,
  monthIndex: number,
  day: number,
  minutesFromMidnight: number,
  timezone: string,
): Date {
  const target = Date.UTC(year, monthIndex, day, 0, minutesFromMidnight);
  let instant = target - (wallClockAsUtc(target, timezone) - target);
  const drift = wallClockAsUtc(instant, timezone) - target;
  if (drift !== 0) instant -= drift;
  return new Date(instant);
}

/**
 * When a shift ends, as a local instant.
 *
 * The stored `date` and `HH:MM` times are local wall clock, so they are rebuilt
 * in local time rather than parsed as UTC. `shiftSpan` in `mockBackend` parses
 * at UTC midnight, which is right there because it only ever compares two
 * shifts against each other and the constant offset cancels — against the
 * actual clock it would not, and every comparison would be wrong by the
 * viewer's UTC offset.
 *
 * The overnight rule matches `shiftSpan` and `shift_slot` in db/schema.sql: an
 * end at or before the start belongs to the next day. Minutes beyond 59 roll
 * over into hours and days on their own, so a 30-hour offset needs no special
 * casing.
 */
/**
 * This device's IANA zone, or undefined where the runtime cannot say.
 *
 * Used when posting a shift: an employer creating one is almost always at the
 * business, so their device's zone is the shift's zone. Better than deriving it
 * from a free-text city, and it needs no service.
 */
export function deviceTimezone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}

/** When a shift starts, by the same rules as `shiftEndsAt`. */
export function shiftStartsAt(shift: ShiftTimes): Date {
  const [year, month, day] = shift.date.split('-').map(Number);
  const minutes = minutesOfDay(shift.startTime);
  if (shift.timezone) return instantInZone(year, month - 1, day, minutes, shift.timezone);
  return new Date(year, month - 1, day, 0, minutes);
}

export function shiftEndsAt(shift: ShiftTimes): Date {
  const [year, month, day] = shift.date.split('-').map(Number);
  const start = minutesOfDay(shift.startTime);
  const end = minutesOfDay(shift.endTime);
  const minutes = end > start ? end : end + 24 * 60;

  // With a zone recorded, the shift's own clock decides — so a worker in
  // Phoenix reading a Dallas shift gets Dallas's 17:00, not their own.
  if (shift.timezone) return instantInZone(year, month - 1, day, minutes, shift.timezone);

  // Without one, the viewer's zone stands in, exactly as before. Shifts posted
  // before the zone was recorded keep their existing behaviour rather than
  // being given a guessed one.
  return new Date(year, month - 1, day, 0, minutes);
}

/**
 * True once a shift is over. Nobody can work it, so it must not be discovered,
 * offered, or accepted.
 *
 * Deliberately the end and not the start: filling a shift that has already
 * begun is what same-day hiring is for.
 */
export function hasShiftEnded(shift: ShiftTimes, now: Date = new Date()): boolean {
  return shiftEndsAt(shift).getTime() <= now.getTime();
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

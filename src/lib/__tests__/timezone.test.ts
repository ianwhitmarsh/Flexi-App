/**
 * Shift timezones (BIG-85).
 *
 * A shift's `HH:MM` times are a wall clock. Without a zone they were read in
 * the *viewer's* zone, so a worker in Phoenix looking at a Dallas shift was an
 * hour out. With one recorded, the shift's own clock decides.
 *
 * These assert against real UTC instants rather than against the helper's own
 * arithmetic, so a wrong offset or a mishandled DST transition fails rather
 * than agreeing with itself.
 */

import { hasShiftEnded, shiftEndsAt, shiftStartsAt } from '../util';

/** `Date.UTC` in a form that reads like the instant being asserted. */
const utc = (iso: string) => new Date(iso).getTime();

/**
 * The rest of this file is only meaningful if the host is not sitting in one of
 * the zones under test. `jest.setup.js` pins UTC for exactly that reason; this
 * asserts the pin took, so the suite fails loudly rather than going quietly
 * vacuous if a runtime ever ignores it.
 */
describe('test environment', () => {
  it('runs in UTC, so no asserted zone can coincide with the host', () => {
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe('UTC');
    expect(new Date(2026, 6, 27, 12, 0).toISOString()).toBe('2026-07-27T12:00:00.000Z');
  });
});

describe('a shift with a recorded zone', () => {
  it('resolves Central summer time at UTC-5', () => {
    // 2026-07-27 17:00 CDT === 22:00Z
    const end = shiftEndsAt({
      date: '2026-07-27',
      startTime: '09:00',
      endTime: '17:00',
      timezone: 'America/Chicago',
    });

    expect(end.getTime()).toBe(utc('2026-07-27T22:00:00Z'));
  });

  it('resolves Central winter time at UTC-6', () => {
    // Same wall clock in December is an hour further from UTC.
    const end = shiftEndsAt({
      date: '2026-12-15',
      startTime: '09:00',
      endTime: '17:00',
      timezone: 'America/Chicago',
    });

    expect(end.getTime()).toBe(utc('2026-12-15T23:00:00Z'));
  });

  it('keeps Arizona at UTC-7 in both seasons, because it skips DST', () => {
    const summer = shiftEndsAt({
      date: '2026-07-27',
      startTime: '09:00',
      endTime: '17:00',
      timezone: 'America/Phoenix',
    });
    const winter = shiftEndsAt({
      date: '2026-12-15',
      startTime: '09:00',
      endTime: '17:00',
      timezone: 'America/Phoenix',
    });

    expect(summer.getTime()).toBe(utc('2026-07-28T00:00:00Z'));
    expect(winter.getTime()).toBe(utc('2026-12-16T00:00:00Z'));
  });

  it('resolves Eastern summer time at UTC-4', () => {
    const end = shiftEndsAt({
      date: '2026-07-27',
      startTime: '09:00',
      endTime: '17:00',
      timezone: 'America/New_York',
    });

    expect(end.getTime()).toBe(utc('2026-07-27T21:00:00Z'));
  });

  it('carries an overnight end into the next day, in the shift’s zone', () => {
    // 22:00–06:00 Central: ends 06:00 the following morning === 11:00Z.
    const end = shiftEndsAt({
      date: '2026-07-27',
      startTime: '22:00',
      endTime: '06:00',
      timezone: 'America/Chicago',
    });

    expect(end.getTime()).toBe(utc('2026-07-28T11:00:00Z'));
  });

  it('spans the DST spring-forward without losing or gaining an hour', () => {
    // 2026-03-08 US clocks go 02:00 -> 03:00 CST->CDT. A 01:00–05:00 shift is
    // three real hours, not four.
    const start = shiftStartsAt({
      date: '2026-03-08',
      startTime: '01:00',
      endTime: '05:00',
      timezone: 'America/Chicago',
    });
    const end = shiftEndsAt({
      date: '2026-03-08',
      startTime: '01:00',
      endTime: '05:00',
      timezone: 'America/Chicago',
    });

    expect(start.getTime()).toBe(utc('2026-03-08T07:00:00Z'));
    expect(end.getTime()).toBe(utc('2026-03-08T10:00:00Z'));
    expect(end.getTime() - start.getTime()).toBe(3 * 60 * 60 * 1000);
  });

  it('resolves the repeated hour at fall-back deterministically', () => {
    // 2026-11-01 01:30 happens twice in Central. Whichever is chosen, it must
    // be one of the two real instants and must not vary between calls.
    const shift = {
      date: '2026-11-01',
      startTime: '01:30',
      endTime: '02:30',
      timezone: 'America/Chicago',
    };

    const first = shiftStartsAt(shift).getTime();
    const again = shiftStartsAt(shift).getTime();

    expect(first).toBe(again);
    expect([utc('2026-11-01T06:30:00Z'), utc('2026-11-01T07:30:00Z')]).toContain(first);
  });
});

describe('a shift with no zone', () => {
  it('is still read in the viewer’s zone, unchanged', () => {
    const end = shiftEndsAt({ date: '2026-07-27', startTime: '09:00', endTime: '17:00' });

    // Constructed the same way the old implementation did.
    expect(end.getTime()).toBe(new Date(2026, 6, 27, 17, 0).getTime());
  });

  it('still answers hasShiftEnded from the clock', () => {
    const past = { date: '2020-01-01', startTime: '09:00', endTime: '17:00' };
    const future = { date: '2099-01-01', startTime: '09:00', endTime: '17:00' };

    expect(hasShiftEnded(past)).toBe(true);
    expect(hasShiftEnded(future)).toBe(false);
  });
});

describe('comparing across zones', () => {
  it('puts a Phoenix worker an hour ahead of a Dallas shift, not level with it', () => {
    const dallasEnd = shiftEndsAt({
      date: '2026-07-27',
      startTime: '09:00',
      endTime: '17:00',
      timezone: 'America/Chicago',
    });

    // 16:00 in Phoenix is 18:00 in Dallas — the shift is over by then.
    const phoenixFourPm = new Date(utc('2026-07-27T23:00:00Z'));
    expect(dallasEnd.getTime()).toBeLessThan(phoenixFourPm.getTime());

    // 14:00 Phoenix is 16:00 Dallas — still running.
    const phoenixTwoPm = new Date(utc('2026-07-27T21:00:00Z'));
    expect(dallasEnd.getTime()).toBeGreaterThan(phoenixTwoPm.getTime());
  });

  it('judges hasShiftEnded by the shift’s clock, not the caller’s', () => {
    const dallas = {
      date: '2026-07-27',
      startTime: '09:00',
      endTime: '17:00',
      timezone: 'America/Chicago',
    };

    // 21:30Z is 16:30 in Dallas: live.
    expect(hasShiftEnded(dallas, new Date(utc('2026-07-27T21:30:00Z')))).toBe(false);
    // 22:30Z is 17:30 in Dallas: over.
    expect(hasShiftEnded(dallas, new Date(utc('2026-07-27T22:30:00Z')))).toBe(true);
  });

  it('overlaps two shifts whose wall clocks look disjoint but whose zones collide', () => {
    // 09:00–17:00 Eastern is 13:00–21:00Z. 09:00–17:00 Pacific is 16:00–00:00Z.
    // Read as bare wall clocks they are identical and would appear to overlap
    // completely; read in their own zones they overlap by five hours, and the
    // exact instants are what proves the zones were applied.
    const eastern = {
      date: '2026-07-27',
      startTime: '09:00',
      endTime: '17:00',
      timezone: 'America/New_York',
    };
    const pacific = { ...eastern, timezone: 'America/Los_Angeles' };

    expect(shiftStartsAt(eastern).getTime()).toBe(utc('2026-07-27T13:00:00Z'));
    expect(shiftEndsAt(eastern).getTime()).toBe(utc('2026-07-27T21:00:00Z'));
    expect(shiftStartsAt(pacific).getTime()).toBe(utc('2026-07-27T16:00:00Z'));
    expect(shiftEndsAt(pacific).getTime()).toBe(utc('2026-07-28T00:00:00Z'));

    // Half-open overlap, the same test `hasOverlappingBooking` applies.
    const overlaps =
      shiftStartsAt(pacific).getTime() < shiftEndsAt(eastern).getTime() &&
      shiftEndsAt(pacific).getTime() > shiftStartsAt(eastern).getTime();
    expect(overlaps).toBe(true);
  });
});

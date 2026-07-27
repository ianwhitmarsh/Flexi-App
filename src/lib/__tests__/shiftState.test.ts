/**
 * Whether a shift is still live (BIG-86).
 *
 * The suggested opener ends "Any questions before the shift?", which reads as
 * *you are working this*. On a shift that is already filled by somebody else,
 * closed, or simply over, that is untrue — and one tap would send it. The chat
 * screen gates the draft on `isShiftLive`; this pins what that means.
 */

import { hasShiftEnded, isShiftLive } from '../util';

/** A shift running 09:00–17:00 on a fixed day, in the runtime's own zone. */
const shift = (over: Partial<{ status: string; date: string; timezone: string }> = {}) => ({
  date: '2026-07-27',
  startTime: '09:00',
  endTime: '17:00',
  status: 'open',
  ...over,
});

/** Local noon and local 6pm on that day — mid-shift and after it. */
const midShift = new Date(2026, 6, 27, 12, 0);
const afterShift = new Date(2026, 6, 27, 18, 0);

describe('isShiftLive', () => {
  it('is true for an open shift that is still running', () => {
    expect(isShiftLive(shift(), midShift)).toBe(true);
  });

  it('is true for an open shift that has not started yet', () => {
    expect(isShiftLive(shift(), new Date(2026, 6, 27, 7, 0))).toBe(true);
  });

  it('is false once the shift is filled — it went to somebody else', () => {
    expect(isShiftLive(shift({ status: 'filled' }), midShift)).toBe(false);
  });

  it('is false once the employer closes it', () => {
    expect(isShiftLive(shift({ status: 'closed' }), midShift)).toBe(false);
  });

  it('is false once it has ended, even while still marked open', () => {
    expect(isShiftLive(shift(), afterShift)).toBe(false);
    // The status really is still `open` — ended is derived, not written.
    expect(shift().status).toBe('open');
  });

  it('agrees with hasShiftEnded on the timing half', () => {
    expect(hasShiftEnded(shift(), midShift)).toBe(false);
    expect(hasShiftEnded(shift(), afterShift)).toBe(true);
  });

  it("reads the end by the shift's own clock, not the viewer's", () => {
    // 09:00–17:00 in Chicago (CDT, UTC-5) ends at 22:00 UTC. These instants are
    // absolute, so the assertion holds whatever zone the runtime is in.
    const dallas = shift({ timezone: 'America/Chicago' });

    // 20:00 UTC is 15:00 in Dallas — still running, though a viewer reading the
    // times as their own would have called it over at 17:00 UTC.
    expect(isShiftLive(dallas, new Date(Date.UTC(2026, 6, 27, 20, 0)))).toBe(true);
    // 22:00 UTC is 17:00 in Dallas — over.
    expect(isShiftLive(dallas, new Date(Date.UTC(2026, 6, 27, 22, 0)))).toBe(false);
  });

  it('carries the overnight rule through, so a late-night shift stays live', () => {
    const overnight = shift({ status: 'open' });
    const nightShift = { ...overnight, startTime: '22:00', endTime: '06:00' };

    // 02:00 the next morning: still running.
    expect(isShiftLive(nightShift, new Date(2026, 6, 28, 2, 0))).toBe(true);
    // 07:00: over.
    expect(isShiftLive(nightShift, new Date(2026, 6, 28, 7, 0))).toBe(false);
  });
});

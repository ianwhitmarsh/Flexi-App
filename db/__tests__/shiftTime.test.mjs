/**
 * What a shift's times actually mean, once the database knows their zone.
 *
 * Every one of these fails against the schema as it stood before: `shift_slot`
 * returned a wall clock with nothing saying whose, so it could be compared to
 * another shift but never to the clock, and never correctly to a shift in a
 * different zone.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { freshDb, seed, offerShift, accept, localTime, futureJuly, span, HOUR } from './harness.mjs';

const utc = (v) => new Date(v).toISOString();

describe('accept_offer and the end of a shift', () => {
  it('still accepts a Dallas shift that is running, under a UTC server clock', async () => {
    // The bug this replaces: the server reads UTC, so a naive comparison sees
    // an evening Texas shift as long over while it is still being worked.
    const db = await freshDb();
    const { employer, worker } = await seed(db);
    const s = await localTime(db, 'America/Chicago', -1);
    const e = await localTime(db, 'America/Chicago', 1);

    const { offer } = await offerShift(db, {
      employer, worker, date: s.d, start: s.t, end: e.t, timezone: 'America/Chicago',
    });

    assert.equal((await accept(db, worker, offer)).status, 'accepted');
  });

  it('refuses a Dallas shift that ended an hour ago', async () => {
    const db = await freshDb();
    const { employer, worker } = await seed(db);
    const s = await localTime(db, 'America/Chicago', -3);
    const e = await localTime(db, 'America/Chicago', -1);

    const { offer } = await offerShift(db, {
      employer, worker, date: s.d, start: s.t, end: e.t, timezone: 'America/Chicago',
    });

    const r = await accept(db, worker, offer);
    assert.equal(r.status, 'error');
    assert.match(r.message, /already ended/i);
  });

  it('accepts a Phoenix shift that is running, where there is no DST to help', async () => {
    const db = await freshDb();
    const { employer, worker } = await seed(db);
    const s = await localTime(db, 'America/Phoenix', -1);
    const e = await localTime(db, 'America/Phoenix', 1);

    const { offer } = await offerShift(db, {
      employer, worker, date: s.d, start: s.t, end: e.t, timezone: 'America/Phoenix',
    });

    assert.equal((await accept(db, worker, offer)).status, 'accepted');
  });

  it('still books a shift posted before the zone column existed', async () => {
    const db = await freshDb();
    const { employer, worker } = await seed(db);
    const s = await localTime(db, 'America/Chicago', -1);
    const e = await localTime(db, 'America/Chicago', 1);

    const { offer } = await offerShift(db, {
      employer, worker, date: s.d, start: s.t, end: e.t, timezone: null,
    });

    assert.equal((await accept(db, worker, offer)).status, 'accepted');
  });
});

describe('shift_slot resolves each launch state to real instants', () => {
  const lower = async (db, date, start, end, zone) =>
    (await db.query(`select lower(public.shift_slot($1::date, $2, $3, $4)) l`, [date, start, end, zone]))
      .rows[0].l;

  it('puts Central summer 09:00 at 14:00 UTC (TX, OK)', async () => {
    const db = await freshDb();
    assert.equal(utc(await lower(db, '2026-07-27', '09:00', '17:00', 'America/Chicago')),
                 '2026-07-27T14:00:00.000Z');
  });

  it('puts Central winter 09:00 an hour later, at 15:00 UTC', async () => {
    const db = await freshDb();
    assert.equal(utc(await lower(db, '2026-01-27', '09:00', '17:00', 'America/Chicago')),
                 '2026-01-27T15:00:00.000Z');
  });

  it('puts Eastern summer 09:00 at 13:00 UTC (FL, GA)', async () => {
    const db = await freshDb();
    assert.equal(utc(await lower(db, '2026-07-27', '09:00', '17:00', 'America/New_York')),
                 '2026-07-27T13:00:00.000Z');
  });

  it('holds Phoenix at UTC-7 in July, because Arizona skips DST (AZ)', async () => {
    const db = await freshDb();
    assert.equal(utc(await lower(db, '2026-07-27', '09:00', '17:00', 'America/Phoenix')),
                 '2026-07-27T16:00:00.000Z');
    assert.equal(utc(await lower(db, '2026-01-27', '09:00', '17:00', 'America/Phoenix')),
                 '2026-01-27T16:00:00.000Z');
  });

  it('keeps an overnight shift four hours long', async () => {
    const db = await freshDb();
    const r = await db.query(
      `select lower(s) lo, upper(s) hi
         from public.shift_slot('2026-07-27'::date, '22:00', '02:00', 'America/Chicago') s`);
    assert.equal(span(r.rows[0].lo, r.rows[0].hi), 4 * HOUR);
  });
});

describe('DST boundaries are the zone’s problem, not arithmetic here', () => {
  const hours = async (db, date, start, end) => {
    const r = await db.query(
      `select lower(s) lo, upper(s) hi from public.shift_slot($1::date, $2, $3, 'America/Chicago') s`,
      [date, start, end]);
    return span(r.rows[0].lo, r.rows[0].hi) / HOUR;
  };

  it('makes 01:00–05:00 on spring-forward three real hours, not four', async () => {
    const db = await freshDb();
    assert.equal(await hours(db, '2026-03-08', '01:00', '05:00'), 3);
  });

  it('makes 00:00–04:00 on fall-back five real hours, not four', async () => {
    const db = await freshDb();
    assert.equal(await hours(db, '2026-11-01', '00:00', '04:00'), 5);
  });
});

describe('overlap is judged in absolute time, so it works across a state line', () => {
  it('refuses a second shift whose wall clock looks disjoint but whose hours collide', async () => {
    // Dallas 08:00–10:00 is 13:00–15:00 UTC. Phoenix 06:00–07:30 is 13:00–14:30
    // UTC. Read as bare wall clocks they never meet; in real time they do.
    const db = await freshDb();
    const { employer, worker } = await seed(db);
    const day = await futureJuly(db);

    const dallas = await offerShift(db, {
      employer, worker, date: day, start: '08:00', end: '10:00', timezone: 'America/Chicago' });
    const phoenix = await offerShift(db, {
      employer, worker, date: day, start: '06:00', end: '07:30', timezone: 'America/Phoenix' });

    assert.equal((await accept(db, worker, dallas.offer)).status, 'accepted');
    assert.equal((await accept(db, worker, phoenix.offer)).status, 'overlap');
  });

  it('allows identical wall clocks three zones apart, which used to be refused', async () => {
    // Eastern 12:00–14:00 is 16:00–18:00 UTC; Phoenix 12:00–14:00 is 19:00–21:00
    // UTC. A worker could genuinely do both, and was being stopped.
    const db = await freshDb();
    const { employer, worker } = await seed(db);
    const day = await futureJuly(db);

    const east = await offerShift(db, {
      employer, worker, date: day, start: '12:00', end: '14:00', timezone: 'America/New_York' });
    const west = await offerShift(db, {
      employer, worker, date: day, start: '12:00', end: '14:00', timezone: 'America/Phoenix' });

    assert.equal((await accept(db, worker, east.offer)).status, 'accepted');
    assert.equal((await accept(db, worker, west.offer)).status, 'accepted');
  });
});

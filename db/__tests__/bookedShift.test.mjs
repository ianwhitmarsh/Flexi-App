/**
 * A booked shift is frozen on the terms the worker agreed to (BIG-76).
 *
 * The threat is not the app — there is no edit-a-shift screen. It is a direct
 * PostgREST call with the anon key, which the `shifts owner write` policy
 * permits on every column of your own shift. So the guard has to live in the
 * database, and these tests drive it the same way: plain UPDATEs, not backend
 * methods.
 */

import assert from 'node:assert/strict';
import { before, beforeEach, describe, it } from 'node:test';

import { freshDb, seed, offerShift, accept, futureJuly } from './harness.mjs';

/** The refusal the trigger raises, matched loosely enough to survive rewording. */
const REFUSED = /booked/i;

describe('once a worker holds a confirmed booking', () => {
  let db;
  let shift;
  let employer;

  before(async () => {
    db = await freshDb();
    const people = await seed(db);
    employer = people.employer;
    const day = await futureJuly(db);
    const offered = await offerShift(db, {
      employer,
      worker: people.worker,
      date: day,
      start: '09:00',
      end: '17:00',
      timezone: 'America/Chicago',
    });
    shift = offered.shift;

    const r = await accept(db, people.worker, offered.offer);
    assert.equal(r.status, 'accepted', 'fixture must actually book the shift');
  });

  const change = (sql, params) => db.query(`update public.shifts set ${sql} where id = $1`, params);

  it('refuses a change to the pay rate', async () => {
    await assert.rejects(() => change('pay_rate_cents = 1200', [shift]), REFUSED);
  });

  it('refuses a change to the pay type', async () => {
    await assert.rejects(() => change("pay_type = 'shift'", [shift]), REFUSED);
  });

  it('refuses a change to the date', async () => {
    await assert.rejects(() => change("date = date + 1", [shift]), REFUSED);
  });

  it('refuses a change to the start or end time', async () => {
    await assert.rejects(() => change("start_time = '06:00'", [shift]), REFUSED);
    await assert.rejects(() => change("end_time = '23:00'", [shift]), REFUSED);
  });

  it('refuses a change to the timezone, which moves the shift in real time', async () => {
    // The wall clock is untouched here. 09:00 Chicago and 09:00 Phoenix are two
    // hours apart in July, so this alone changes when the worker must turn up.
    await assert.rejects(() => change("timezone = 'America/Phoenix'", [shift]), REFUSED);
  });

  it('refuses moving the shift back to open', async () => {
    await assert.rejects(() => change("status = 'open'", [shift]), REFUSED);
  });

  it('allows the fields that carry no commitment', async () => {
    await change("description = 'Use the side entrance, ask for Sam'", [shift]);
    await change("requirements = '{Black shirt}'", [shift]);
    await change("title = 'Weekend Barista (AM)'", [shift]);
    await change("location = '12 Harbor St'", [shift]);
    await change("role = 'Barista'", [shift]);

    const r = await db.query(`select description, title from public.shifts where id = $1`, [shift]);
    assert.match(r.rows[0].description, /side entrance/);
    assert.equal(r.rows[0].title, 'Weekend Barista (AM)');
  });

  it('leaves closeShift working', async () => {
    // What the employer's Close action does. Cancelling the booking itself is
    // BIG-54; this only asserts the trigger does not stand in the way.
    await change("status = 'closed'", [shift]);
    const r = await db.query(`select status from public.shifts where id = $1`, [shift]);
    assert.equal(r.rows[0].status, 'closed');
  });
});

describe('while nobody is booked', () => {
  let db;
  let shift;

  beforeEach(async () => {
    db = await freshDb();
    const { employer } = await seed(db);
    const day = await futureJuly(db);
    const r = await db.query(
      `insert into public.shifts
         (business_id, title, role, pay_rate_cents, date, start_time, end_time, timezone)
       values ($1, 'Barista', 'Barista', 2000, $2::date, '09:00', '17:00', 'America/Chicago')
       returning id`,
      [employer, day],
    );
    shift = r.rows[0].id;
  });

  it('every frozen column is still editable', async () => {
    // AC-3: this is the ordinary editing the rule must not touch. A column
    // privilege would have broken exactly this, which is why it is a trigger.
    await db.query(
      `update public.shifts
          set pay_rate_cents = 2200, pay_type = 'shift', date = date + 1,
              start_time = '08:00', end_time = '16:00', timezone = 'America/New_York'
        where id = $1`,
      [shift],
    );
    const r = await db.query(`select pay_rate_cents, start_time, timezone from public.shifts where id = $1`, [shift]);
    assert.equal(r.rows[0].pay_rate_cents, 2200);
    assert.equal(r.rows[0].start_time, '08:00');
    assert.equal(r.rows[0].timezone, 'America/New_York');
  });

  it('a closed shift with no booking can still be reopened', async () => {
    await db.query(`update public.shifts set status = 'closed' where id = $1`, [shift]);
    await db.query(`update public.shifts set status = 'open' where id = $1`, [shift]);
    const r = await db.query(`select status from public.shifts where id = $1`, [shift]);
    assert.equal(r.rows[0].status, 'open');
  });

  it('a cancelled booking unfreezes the shift', async () => {
    // The trigger looks for `status = 'confirmed'` specifically, not for any
    // booking row. Once BIG-54 cancels one, the shift is ordinary again.
    //
    // I wrote this against `cancelled`, predicting BIG-37 would only widen the
    // vocabulary and leave the test untouched. Half right: the trigger really
    // is indifferent to *which* not-confirmed status this is — it asks whether
    // the status is `confirmed`. But BIG-37 *replaced* the vocabulary rather
    // than extending it, so plain `cancelled` no longer passes the check
    // constraint and the fixture did need updating.
    const { worker } = await seed(db);
    await db.query(
      `insert into public.bookings (shift_id, worker_id, business_id, slot, status)
       select $1, $2, business_id,
              public.shift_slot(date, start_time, end_time, timezone), 'cancelled_by_worker'
         from public.shifts where id = $1`,
      [shift, worker],
    );
    await db.query(`update public.shifts set pay_rate_cents = 2500 where id = $1`, [shift]);
    const r = await db.query(`select pay_rate_cents from public.shifts where id = $1`, [shift]);
    assert.equal(r.rows[0].pay_rate_cents, 2500);
  });
});

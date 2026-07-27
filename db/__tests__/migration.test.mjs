/**
 * The upgrade path for a database that already exists.
 *
 * `bookings.slot` was a naive `tsrange` and is now a `tstzrange`. There is no
 * cast between them, so the column is retyped and every value rebuilt from the
 * shift it came from. This is the first change to the file that has to drop and
 * restore the exclusion constraint, so it is the first to exercise that guard.
 */

import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';

import { blankDb, priorSchema, SCHEMA, span, HOUR } from './harness.mjs';

const E = '00000000-0000-4000-8000-0000000000e1';
const W = '00000000-0000-4000-8000-0000000000c1';
const ZONED = '00000000-0000-4000-8000-000000000011';
const LEGACY = '00000000-0000-4000-8000-000000000012';
const CLASH = '00000000-0000-4000-8000-000000000013';

describe('retyping bookings.slot on a database that already has rows', () => {
  let db;

  before(async () => {
    db = await blankDb();
    await db.exec(priorSchema);
    await db.exec(`
      insert into auth.users (id) values ('${E}'), ('${W}');
      insert into public.profiles (id, email, role) values
        ('${E}', 'e@example.com', 'business'), ('${W}', 'w@example.com', 'worker');
      insert into public.businesses (id, company_name, category, city, about, contact_name)
        values ('${E}', 'Blue Harbor Coffee', 'Restaurant', 'Dallas', '', 'Sam');
      insert into public.worker_profiles
        (id, full_name, headline, bio, city, skills, years_experience, availability)
        values ('${W}', 'María Reyes', 'Barista', '', 'Dallas', '{}', 2, '{}');
      insert into public.shifts
        (id, business_id, title, role, pay_rate, date, start_time, end_time, timezone) values
        ('${ZONED}',  '${E}', 'Day',   'Barista', 20, '2030-07-27', '09:00', '17:00', 'America/Chicago'),
        ('${LEGACY}', '${E}', 'Night', 'Barista', 20, '2030-08-02', '22:00', '02:00', null),
        ('${CLASH}',  '${E}', 'Clash', 'Barista', 20, '2030-07-27', '10:00', '12:00', 'America/Chicago');
      insert into public.bookings (shift_id, worker_id, business_id, slot) values
        ('${ZONED}',  '${W}', '${E}', public.shift_slot('2030-07-27'::date, '09:00', '17:00')),
        ('${LEGACY}', '${W}', '${E}', public.shift_slot('2030-08-02'::date, '22:00', '02:00'));
    `);
  });

  const slotColumn = async () =>
    (await db.query(`select udt_name, is_nullable from information_schema.columns
                      where table_schema = 'public' and table_name = 'bookings'
                        and column_name = 'slot'`)).rows[0];

  it('starts out as the naive tsrange it is today', async () => {
    assert.equal((await slotColumn()).udt_name, 'tsrange');
  });

  it('applies, and applies again without erroring', async () => {
    // The whole file, not an extracted region. It could not be applied this way
    // when this test was written — the unguarded policies stopped it long
    // before it reached the retype — so it had to pick out the two regions the
    // migration lived in. Now the file itself is the upgrade path.
    await db.exec(SCHEMA);
    // The second pass is what caught the exclusion constraint's guard trapping
    // the wrong error: an exclusion constraint builds an index of the same
    // name, so Postgres reports `duplicate_table`, not `duplicate_object`.
    await db.exec(SCHEMA);
  });

  it('leaves slot a tstzrange that is still not null', async () => {
    assert.deepEqual(await slotColumn(), { udt_name: 'tstzrange', is_nullable: 'NO' });
  });

  it('rebuilds a zoned booking against its own zone', async () => {
    const r = await db.query(`select lower(slot) lo from public.bookings where shift_id = $1`, [ZONED]);
    // 09:00 Central in July is 14:00 UTC.
    assert.equal(new Date(r.rows[0].lo).toISOString(), '2030-07-27T14:00:00.000Z');
  });

  it('gives a booking with no zone the documented Central fallback', async () => {
    const r = await db.query(`select lower(slot) lo, upper(slot) hi from public.bookings where shift_id = $1`, [LEGACY]);
    // 22:00 Central in August is 03:00 UTC the next day.
    assert.equal(new Date(r.rows[0].lo).toISOString(), '2030-08-03T03:00:00.000Z');
    // And it is still an overnight shift, not the empty range.
    assert.equal(span(r.rows[0].lo, r.rows[0].hi), 4 * HOUR);
  });

  it('puts the overlap constraint back, still biting', async () => {
    const con = await db.query(
      `select 1 from pg_constraint where conname = 'bookings_no_worker_overlap'`);
    assert.equal(con.rows.length, 1);

    await assert.rejects(
      db.query(`insert into public.bookings (shift_id, worker_id, business_id, slot)
                values ($1, $2, $3, public.shift_slot('2030-07-27'::date, '10:00', '12:00', 'America/Chicago'))`,
               [CLASH, W, E]),
      /exclusion constraint|no_worker_overlap/i,
    );
  });
});

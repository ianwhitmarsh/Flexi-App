/**
 * `pay_rate` and `desired_rate` become integer cents (BIG-88).
 *
 * The half that cannot be checked by reading is the migration: converting a
 * column in place on a database that already holds `numeric` rates, without
 * truncating them. The frozen pre-tstzrange schema still declares both as
 * `numeric`, so it doubles as the "before" state for this too.
 */

import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';

import { blankDb, freshDb, priorSchema, SCHEMA } from './harness.mjs';

const column = async (db, table, name) =>
  (
    await db.query(
      `select data_type from information_schema.columns
        where table_schema = 'public' and table_name = $1 and column_name = $2`,
      [table, name],
    )
  ).rows[0];

describe('a fresh database', () => {
  let db;
  before(async () => {
    db = await freshDb();
  });

  it('stores both rates as integers', async () => {
    assert.deepEqual(await column(db, 'shifts', 'pay_rate_cents'), { data_type: 'integer' });
    assert.deepEqual(await column(db, 'worker_profiles', 'desired_rate_cents'), { data_type: 'integer' });
  });

  it('has no numeric rate columns left', async () => {
    assert.equal(await column(db, 'shifts', 'pay_rate'), undefined);
    assert.equal(await column(db, 'worker_profiles', 'desired_rate'), undefined);
  });
});

describe('converting a database that already holds numeric rates', () => {
  let db;

  before(async () => {
    db = await blankDb();
    await db.exec(priorSchema);

    const E = '00000000-0000-4000-8000-0000000000e2';
    const W = '00000000-0000-4000-8000-0000000000c2';
    await db.exec(`
      insert into auth.users (id) values ('${E}'), ('${W}');
      insert into public.profiles (id, email, role) values
        ('${E}', 'e@example.com', 'business'), ('${W}', 'w@example.com', 'worker');
      insert into public.businesses (id, company_name, category, city, about, contact_name)
        values ('${E}', 'Blue Harbor Coffee', 'Restaurant', 'Dallas', '', 'Sam');
      insert into public.worker_profiles
        (id, full_name, headline, bio, city, skills, years_experience, availability, desired_rate)
        values ('${W}', 'María Reyes', 'Barista', '', 'Dallas', '{}', 2, '{}', 22.75);
      insert into public.shifts
        (business_id, title, role, pay_rate, date, start_time, end_time) values
        ('${E}', 'Whole dollars', 'Barista', 22,     '2030-07-27', '09:00', '17:00'),
        ('${E}', 'Half dollar',   'Barista', 18.50,  '2030-07-27', '09:00', '17:00'),
        ('${E}', 'Awkward cents', 'Barista', 8.15,   '2030-07-27', '09:00', '17:00'),
        ('${E}', 'Third decimal', 'Barista', 18.999, '2030-07-27', '09:00', '17:00');
    `);

    // The `numeric` state this is migrating away from.
    assert.deepEqual(await column(db, 'shifts', 'pay_rate'), { data_type: 'numeric' });

    await db.exec(SCHEMA);
  });

  it('converts rather than truncates', async () => {
    const r = await db.query(
      `select title, pay_rate_cents from public.shifts order by title`,
    );
    assert.deepEqual(
      Object.fromEntries(r.rows.map((x) => [x.title, x.pay_rate_cents])),
      // 18.50 must not land on 1850 by luck and 8.15 on 814 by truncation.
      {
        'Awkward cents': 815,
        'Half dollar': 1850,
        'Whole dollars': 2200,
        // Only reachable by a hand-written insert — the app refuses a third
        // decimal. Pinned so it rounds to the nearest cent rather than losing
        // one, whether that comes from the explicit `round` or from the cast.
        'Third decimal': 1900,
      },
    );
  });

  it('converts the worker profile rate too', async () => {
    const r = await db.query(`select desired_rate_cents from public.worker_profiles`);
    assert.equal(r.rows[0].desired_rate_cents, 2275);
  });

  it('leaves the columns integer, under the new names', async () => {
    assert.deepEqual(await column(db, 'shifts', 'pay_rate_cents'), { data_type: 'integer' });
    assert.equal(await column(db, 'shifts', 'pay_rate'), undefined);
  });

  it('is safe to apply again', async () => {
    // BIG-87's rule. The rename is guarded on the old column still existing, so
    // the second pass finds nothing to do rather than erroring — and must not
    // multiply the stored values by a hundred a second time.
    await db.exec(SCHEMA);
    const r = await db.query(
      `select pay_rate_cents from public.shifts where title = 'Half dollar'`,
    );
    assert.equal(r.rows[0].pay_rate_cents, 1850);
  });
});

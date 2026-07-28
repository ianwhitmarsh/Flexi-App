/**
 * The policies, actually enforced (BIG-90).
 *
 * Every other suite here runs as superuser, which bypasses RLS — so until now
 * the 34 policies in schema.sql were only ever asserted to *exist*. That is the
 * difference between "the schema loaded" and "a worker cannot read another
 * worker's timesheet".
 *
 * `asUser` switches to the `authenticated` role, which the tables are not owned
 * by, so the policies apply. The first test proves the mechanism can fail;
 * without it, everything below could pass by simply not enforcing anything.
 */

import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';

import { asUser, freshDb, seed, offerShift, accept, futureJuly } from './harness.mjs';

/**
 * A rival business: a real employer account with no connection to the shift.
 *
 * Its absence was a genuine hole. Every negative assertion about `timesheets`
 * and `shift_payments` used to be made from a *worker's* session, so the
 * employer branch of both `... business read` policies — the clause that scopes
 * them to the owning business — had nothing watching it. Scoping it to any
 * business account instead of the owner passed the whole suite.
 */
async function rivalEmployer(db) {
  const id = '00000000-0000-4000-8000-0000000000b1';
  await db.exec(`
    insert into auth.users (id) values ('${id}');
    insert into public.profiles (id, email, role) values ('${id}', 'rival@example.com', 'business');
    insert into public.businesses (id, company_name, category, city, about, contact_name)
      values ('${id}', 'Rival Coffee', 'Restaurant', 'Dallas', '', 'Pat');
  `);
  return id;
}

/** A second worker, so "somebody else's row" is a real row and not an absence. */
async function otherWorker(db, n = 9) {
  const id = `00000000-0000-4000-8000-0000000000f${n}`;
  await db.exec(`
    insert into auth.users (id) values ('${id}');
    insert into public.profiles (id, email, role) values ('${id}', 'other${n}@example.com', 'worker');
    insert into public.worker_profiles
      (id, full_name, headline, bio, city, skills, years_experience, availability)
      values ('${id}', 'Other Worker', 'Cook', '', 'Dallas', '{}', 3, '{}');
  `);
  return id;
}

describe('the mechanism itself', () => {
  let db;
  let worker;

  before(async () => {
    db = await freshDb();
    ({ worker } = await seed(db));
  });

  it('enforces RLS as a signed-in user, and not as superuser', async () => {
    // The load-bearing test. `profiles` is self-read only, so a superuser
    // seeing more rows than the signed-in user is the proof that switching
    // roles changes anything at all. If these two numbers are ever equal,
    // every other assertion in this file is worthless.
    const all = await db.query(`select count(*)::int c from public.profiles`);
    assert.ok(all.rows[0].c >= 2, 'fixture needs at least two profiles');

    const mine = await asUser(db, worker, () =>
      db.query(`select count(*)::int c from public.profiles`),
    );
    assert.equal(mine.rows[0].c, 1);
    assert.notEqual(mine.rows[0].c, all.rows[0].c);
  });

  it('puts the connection back afterwards', async () => {
    // A test that leaked `authenticated` would change the meaning of every
    // fixture after it, and fail somewhere unrelated.
    const r = await db.query(`select current_user`);
    assert.notEqual(r.rows[0].current_user, 'authenticated');
  });

  it('resets the role even when the block throws', async () => {
    await assert.rejects(() => asUser(db, worker, () => db.query(`select 1/0`)));
    const r = await db.query(`select current_user`);
    assert.notEqual(r.rows[0].current_user, 'authenticated');
  });
});

describe('a worker cannot read another worker', () => {
  let db;
  let worker;
  let other;

  before(async () => {
    db = await freshDb();
    ({ worker } = await seed(db));
    other = await otherWorker(db);
  });

  it('sees only their own profiles row', async () => {
    const r = await asUser(db, worker, () => db.query(`select id from public.profiles`));
    assert.deepEqual(r.rows.map((x) => x.id), [worker]);
  });

  it('but can see other worker_profiles, which are listings', async () => {
    // Deliberately asserting the *permissive* side too. `workers readable` is
    // `auth.role() = 'authenticated'` on purpose — an employer has to be able
    // to read a candidate — so a test that only checked denials would call this
    // a leak when it is the design.
    //
    // That openness includes `resume_url`, which is a reference to a private
    // object. Whether that is right is BIG-91; this test records what the
    // schema does today, not a decision that it should. If BIG-91 tightens it,
    // this test changes with it.
    const r = await asUser(db, worker, () =>
      db.query(`select id from public.worker_profiles order by id`),
    );
    assert.ok(r.rows.length >= 2, 'listings are readable by any signed-in user');
    assert.ok(r.rows.some((x) => x.id === other));
  });

  it('cannot write another worker profile', async () => {
    await asUser(db, worker, () =>
      db.query(`update public.worker_profiles set headline = 'hacked' where id = $1`, [other]),
    );
    const r = await db.query(`select headline from public.worker_profiles where id = $1`, [other]);
    assert.equal(r.rows[0].headline, 'Cook');
  });
});

describe('money and hours are private to the two parties', () => {
  let db;
  let employer;
  let worker;
  let other;
  let rival;
  let shift;

  before(async () => {
    db = await freshDb();
    ({ employer, worker } = await seed(db));
    other = await otherWorker(db, 8);
    rival = await rivalEmployer(db);
    const day = await futureJuly(db);
    const offered = await offerShift(db, {
      employer, worker, date: day, start: '09:00', end: '17:00', timezone: 'America/Chicago',
    });
    shift = offered.shift;
    const r = await accept(db, worker, offered.offer);
    assert.equal(r.status, 'accepted', 'fixture must book the shift');

    const booking = await db.query(`select id from public.bookings where shift_id = $1`, [shift]);
    await db.query(
      `insert into public.timesheets (booking_id, clock_in_at) values ($1, now())`,
      [booking.rows[0].id],
    );
    // Reaches the worker through `booking_id`, not a `worker_id` of its own —
    // which is what `payments worker read` joins on.
    await db.query(
      `insert into public.shift_payments (booking_id, shift_id, bill_rate_cents, wage_rate_cents, scheduled_hours)
       values ($1, $2, 3100, 2000, 8)`,
      [booking.rows[0].id, shift],
    );
  });

  it('lets the worker read their own timesheet', async () => {
    const r = await asUser(db, worker, () => db.query(`select id from public.timesheets`));
    assert.equal(r.rows.length, 1);
  });

  it('lets the employer read a timesheet for a shift they own', async () => {
    const r = await asUser(db, employer, () => db.query(`select id from public.timesheets`));
    assert.equal(r.rows.length, 1);
  });

  it('hides it from an unrelated worker', async () => {
    const r = await asUser(db, other, () => db.query(`select id from public.timesheets`));
    assert.deepEqual(r.rows, []);
  });

  it('hides the payment from an unrelated worker', async () => {
    const r = await asUser(db, other, () => db.query(`select id from public.shift_payments`));
    assert.deepEqual(r.rows, []);
  });

  it('hides the timesheet from a business that does not own the shift', async () => {
    // Correct behaviour, but *not* for the reason the ownership clause suggests,
    // and the difference is worth knowing before trusting this test.
    //
    // `timesheets business read` reaches the shift through `bookings`, and a
    // policy subquery is itself subject to the referenced table's RLS for the
    // calling user. `bookings participants` already denies the rival, so the
    // subquery finds nothing and `shifts.business_id = auth.uid()` is never
    // consulted. Measured on this fixture: the rival sees 0 bookings, 0
    // timesheets — and 1 shift.
    //
    // So weakening the ownership clause here does not fail this test. What
    // fails it is dropping the join through `bookings` altogether.
    const r = await asUser(db, rival, () => db.query(`select id from public.timesheets`));
    assert.deepEqual(r.rows, []);
  });

  it('hides the payment from a business that does not own the shift', async () => {
    // The one that matters most, and the one with a single line of defence.
    //
    // `payments business read` joins straight to `shifts`, and `shifts
    // readable` is `auth.role() = 'authenticated'` — permissive to anyone
    // signed in. So unlike the timesheets case above, nothing stands behind the
    // ownership clause: weaken it and `bill_rate_cents` and `wage_rate_cents`
    // leak to any business account. That is exactly the shape of the leak this
    // pair of tests was added for.
    const r = await asUser(db, rival, () => db.query(`select id from public.shift_payments`));
    assert.deepEqual(r.rows, []);
  });

  it('shows the payment to both parties', async () => {
    const asWorker = await asUser(db, worker, () => db.query(`select wage_rate_cents from public.shift_payments`));
    assert.equal(asWorker.rows[0].wage_rate_cents, 2000);
    const asEmployer = await asUser(db, employer, () => db.query(`select bill_rate_cents from public.shift_payments`));
    assert.equal(asEmployer.rows[0].bill_rate_cents, 3100);
  });
});

describe('a thread cannot be repointed at a different shift', () => {
  let db;
  let employer;
  let worker;
  let thread;

  before(async () => {
    db = await freshDb();
    ({ employer, worker } = await seed(db));
    const day = await futureJuly(db);
    const { shift } = await offerShift(db, {
      employer, worker, date: day, start: '09:00', end: '17:00', timezone: 'America/Chicago',
    });
    const r = await db.query(
      `insert into public.matches (shift_id, worker_id, business_id) values ($1, $2, $3) returning id`,
      [shift, worker, employer],
    );
    thread = r.rows[0].id;
  });

  it('lets a participant write the three message columns', async () => {
    await asUser(db, worker, () =>
      db.query(
        `update public.matches set last_message = 'hello', last_message_at = now() where id = $1`,
        [thread],
      ),
    );
    const r = await db.query(`select last_message from public.matches where id = $1`, [thread]);
    assert.equal(r.rows[0].last_message, 'hello');
  });

  it('refuses to let them move the thread to another shift', async () => {
    // The column grant, not a policy — `with check` sees only the new row, so
    // it cannot tell that `shift_id` changed. This is the mechanism that
    // actually protects a thread's identity, and it has never been exercised.
    const before = await db.query(`select shift_id from public.matches where id = $1`, [thread]);
    await assert.rejects(
      () => asUser(db, worker, () =>
        db.query(`update public.matches set shift_id = gen_random_uuid() where id = $1`, [thread]),
      ),
      /permission denied|column .*shift_id/i,
    );
    const after = await db.query(`select shift_id from public.matches where id = $1`, [thread]);
    assert.equal(after.rows[0].shift_id, before.rows[0].shift_id);
  });

  it('refuses to let them hand the thread to a different business', async () => {
    await assert.rejects(
      () => asUser(db, worker, () =>
        db.query(`update public.matches set business_id = $1 where id = $2`, [worker, thread]),
      ),
      /permission denied|column .*business_id/i,
    );
  });
});

describe('security definer still bypasses RLS, which is its job', () => {
  it('books a shift when called as authenticated, not as superuser', async () => {
    // `accept_offer` writes `bookings` and updates `shifts` — neither of which
    // the worker may touch directly. If it stopped being `security definer`,
    // every other suite would keep passing because they call it as superuser.
    const db = await freshDb();
    const { employer, worker } = await seed(db);
    const day = await futureJuly(db);
    const { offer, shift } = await offerShift(db, {
      employer, worker, date: day, start: '09:00', end: '17:00', timezone: 'America/Chicago',
    });

    const direct = await asUser(db, worker, () =>
      db.query(`select count(*)::int c from public.bookings`),
    );
    assert.equal(direct.rows[0].c, 0);

    const r = await asUser(db, worker, () =>
      db.query(`select public.accept_offer($1::uuid) as result`, [offer]),
    );
    assert.equal(r.rows[0].result.status, 'accepted');

    const booked = await db.query(`select status from public.shifts where id = $1`, [shift]);
    assert.equal(booked.rows[0].status, 'filled');
  });
});

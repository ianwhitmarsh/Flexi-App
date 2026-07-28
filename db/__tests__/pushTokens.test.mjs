/**
 * A push token belongs to its owner and nobody else (BIG-89).
 *
 * A token is a device address: whoever holds one can push arbitrary
 * notifications to that phone, for as long as the app stays installed. It used
 * to be readable by any business that had offered the worker a shift, because
 * the send happened from the employer's device.
 *
 * This is the kind of thing that can only be tested by actually enforcing RLS —
 * as superuser every one of these reads succeeds. See `asUser` in harness.mjs.
 */

import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';

import { asUser, freshDb, seed, offerShift, futureJuly } from './harness.mjs';

describe('push tokens are strictly self-access', () => {
  let db;
  let employer;
  let worker;

  before(async () => {
    db = await freshDb();
    ({ employer, worker } = await seed(db));

    // The employer has offered this worker a shift — the exact relationship the
    // dropped policy keyed on. If it were still there, the reads below would
    // succeed.
    const day = await futureJuly(db);
    await offerShift(db, {
      employer, worker, date: day, start: '09:00', end: '17:00', timezone: 'America/Chicago',
    });

    await db.query(`insert into public.push_tokens (user_id, token) values ($1, $2)`, [
      worker,
      'ExponentPushToken[worker-device]',
    ]);
    await db.query(`insert into public.push_tokens (user_id, token) values ($1, $2)`, [
      employer,
      'ExponentPushToken[employer-device]',
    ]);
  });

  it('lets a worker read their own token', async () => {
    const r = await asUser(db, worker, () => db.query(`select token from public.push_tokens`));
    assert.deepEqual(r.rows.map((x) => x.token), ['ExponentPushToken[worker-device]']);
  });

  it('hides the worker token from the employer who offered them a shift', async () => {
    // The whole point. Not an error — RLS filters, so the row simply is not
    // there. Asserting the employer sees *only their own* rather than zero
    // rows, so this cannot pass by the table being empty.
    const r = await asUser(db, employer, () => db.query(`select token from public.push_tokens`));
    assert.deepEqual(r.rows.map((x) => x.token), ['ExponentPushToken[employer-device]']);
  });

  it('lets a worker register and remove their own token', async () => {
    await asUser(db, worker, () =>
      db.query(`insert into public.push_tokens (user_id, token) values ($1, 'second-device')`, [worker]),
    );
    const mine = await asUser(db, worker, () => db.query(`select count(*)::int c from public.push_tokens`));
    assert.equal(mine.rows[0].c, 2);

    await asUser(db, worker, () =>
      db.query(`delete from public.push_tokens where token = 'second-device'`),
    );
    const after = await asUser(db, worker, () => db.query(`select count(*)::int c from public.push_tokens`));
    assert.equal(after.rows[0].c, 1);
  });

  it('refuses to let anyone register a token against somebody else', async () => {
    await assert.rejects(
      () => asUser(db, employer, () =>
        db.query(`insert into public.push_tokens (user_id, token) values ($1, 'stolen')`, [worker]),
      ),
      /row-level security/i,
    );
  });

  it('has no policy left that reads across users', async () => {
    const r = await db.query(
      `select policyname from pg_policies where tablename = 'push_tokens' order by policyname`,
    );
    assert.deepEqual(r.rows.map((x) => x.policyname), ['push tokens self']);
  });
});

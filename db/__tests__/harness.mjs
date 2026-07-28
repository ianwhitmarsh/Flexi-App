/**
 * Runs db/schema.sql against a real PostgreSQL, in memory. See README.md.
 */

import { PGlite } from '@electric-sql/pglite';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DB_DIR = join(HERE, '..');

export const SCHEMA = readFileSync(join(DB_DIR, 'schema.sql'), 'utf8');
const STUBS = readFileSync(join(HERE, 'supabase-stubs.sql'), 'utf8');

/** An empty database with the Supabase stand-ins loaded, and nothing else. */
export async function blankDb() {
  const db = await PGlite.create({ extensions: { btree_gist } });
  // Supabase runs its database in UTC. Pinning it here reproduces the condition
  // that made the first version of the ended check wrong.
  await db.exec(`set timezone = 'UTC';`);
  await db.exec(STUBS);
  return db;
}

/** A database with the current schema applied, as a fresh project would get. */
export async function freshDb() {
  const db = await blankDb();
  await db.exec(SCHEMA);
  return db;
}

/**
 * A frozen copy of schema.sql from before `bookings.slot` became a `tstzrange`
 * — the state any database created up to that point is in. See
 * fixtures/README.md for why it is a committed file rather than
 * `git show HEAD:db/schema.sql`.
 */
export const priorSchema = readFileSync(
  join(HERE, 'fixtures', 'schema-before-tstzrange.sql'),
  'utf8',
);

let seq = 0;
const nextId = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`;

/** One employer and one worker, with the profile rows the schema requires. */
export async function seed(db) {
  const employer = nextId();
  const worker = nextId();
  await db.exec(`
    insert into auth.users (id) values ('${employer}'), ('${worker}');
    insert into public.profiles (id, email, role) values
      ('${employer}', 'employer@example.com', 'business'),
      ('${worker}', 'worker@example.com', 'worker');
    insert into public.businesses (id, company_name, category, city, about, contact_name)
      values ('${employer}', 'Blue Harbor Coffee', 'Restaurant', 'Dallas', '', 'Sam');
    insert into public.worker_profiles
      (id, full_name, headline, bio, city, skills, years_experience, availability)
      values ('${worker}', 'María Reyes', 'Barista', '', 'Dallas', '{}', 2, '{}');
    -- accept_offer refuses a worker who is not payroll-ready (BIG-73), and
    -- payroll_status defaults to not_started. These suites are about shift
    -- timing and overlap, so the fixture is somebody who could actually take
    -- the shift; the gate itself is covered by payroll.test.ts.
    -- (No backticks in here: this is inside a JS template literal.)
    update public.worker_profiles set payroll_status = 'ready' where id = '${worker}';
  `);
  return { employer, worker };
}

/** Post a shift and offer it to `worker`. */
export async function offerShift(db, { employer, worker, date, start, end, timezone }) {
  const shift = nextId();
  const batch = nextId();
  const offer = nextId();
  await db.query(
    `insert into public.shifts
       (id, business_id, title, role, pay_rate_cents, date, start_time, end_time, timezone)
     values ($1, $2, 'Shift', 'Barista', 2000, $3::date, $4, $5, $6)`,
    [shift, employer, date, start, end, timezone],
  );
  await db.query(
    `insert into public.offer_batches (id, shift_id, business_id) values ($1, $2, $3)`,
    [batch, shift, employer],
  );
  await db.query(
    `insert into public.offers (id, batch_id, shift_id, worker_id) values ($1, $2, $3, $4)`,
    [offer, batch, shift, worker],
  );
  return { shift, offer };
}

/** Call `accept_offer` as `worker`. Errors come back as `status: 'error'`. */
export async function accept(db, worker, offerId) {
  await db.exec(`select set_config('test.uid', '${worker}', false);`);
  try {
    const r = await db.query(`select public.accept_offer($1::uuid) as result`, [offerId]);
    return r.rows[0].result;
  } catch (e) {
    return { status: 'error', message: e.message };
  }
}

/** The wall clock `zone` shows right now, shifted by `hours`. */
export async function localTime(db, zone, hours) {
  const r = await db.query(
    `select to_char((now() at time zone $1) + make_interval(hours => $2), 'HH24:MI') t,
            to_char((now() at time zone $1) + make_interval(hours => $2), 'YYYY-MM-DD') d`,
    [zone, hours],
  );
  return r.rows[0];
}

/**
 * A 27 July a few years out. July so the offsets a test asserts are known
 * (Central UTC-5, Eastern UTC-4, Phoenix UTC-7); derived from the current year
 * so a fixture never drifts into the past and starts tripping the ended check.
 */
export async function futureJuly(db) {
  const r = await db.query(`select make_date(extract(year from now())::int + 3, 7, 27)::text d`);
  return r.rows[0].d;
}

/** Milliseconds between the ends of a range row. */
export const span = (lo, hi) => new Date(hi).getTime() - new Date(lo).getTime();
export const HOUR = 3600 * 1000;

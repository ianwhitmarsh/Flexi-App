/**
 * db/schema.sql must be safe to apply to a database that already has it.
 *
 * It is pasted into the Supabase SQL editor by hand, and it is the only
 * description of the schema there is — so it is also the upgrade path. It could
 * not do that job: 15 of its 28 policies had no `drop policy if exists`, so a
 * second run stopped at the first one and every migration below it — the
 * `duplicate_column` guards, the status-check widening, the slot backfill and
 * retype — was unreachable on the only kind of database that needed them.
 *
 * These tests fail if any statement stops being safe to repeat.
 */

import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';

import { blankDb, freshDb, SCHEMA, priorSchema } from './harness.mjs';

/**
 * Everything about the database that the schema is responsible for. Compared
 * whole, so a statement that quietly changes something on a second run is
 * caught even if it does not raise.
 */
async function snapshot(db) {
  const rows = async (sql) => (await db.query(sql)).rows;
  return {
    policies: await rows(`
      select schemaname, tablename, policyname, cmd, permissive, qual, with_check
        from pg_policies
       where schemaname in ('public', 'storage')
       order by schemaname, tablename, policyname`),
    columns: await rows(`
      select table_name, column_name, udt_name, is_nullable, column_default
        from information_schema.columns
       where table_schema = 'public'
       order by table_name, column_name`),
    constraints: await rows(`
      select conname, contype, pg_get_constraintdef(oid) def
        from pg_constraint
       where connamespace = 'public'::regnamespace
       order by conname, def`),
    routines: await rows(`
      select p.proname, pg_get_function_identity_arguments(p.oid) args,
             pg_get_function_result(p.oid) result, p.provolatile, p.prosecdef
        from pg_proc p
       where p.pronamespace = 'public'::regnamespace
       order by p.proname, args`),
    indexes: await rows(`
      select indexname, indexdef from pg_indexes
       where schemaname = 'public' order by indexname`),
    grants: await rows(`
      select table_name, privilege_type, grantee, column_name
        from information_schema.column_privileges
       where table_schema = 'public' and grantee = 'authenticated'
       order by table_name, column_name, privilege_type`),
    published: await rows(`
      select schemaname, tablename from pg_publication_tables
       where pubname = 'supabase_realtime' order by schemaname, tablename`),
  };
}

describe('applying schema.sql to a database that already has it', () => {
  let once;
  let twice;

  before(async () => {
    const a = await freshDb();
    once = await snapshot(a);

    const b = await blankDb();
    await b.exec(SCHEMA);
    // The assertion is that this does not throw. Before this change it stopped
    // here, at `policy "profiles self read" for table "profiles" already exists`.
    await b.exec(SCHEMA);
    twice = await snapshot(b);
  });

  it('does not error the second time', () => {
    // Reaching `before` without throwing is the assertion; this pins it as a
    // named test rather than a setup failure nobody reads.
    assert.ok(twice);
  });

  it('leaves exactly the state one run leaves', () => {
    assert.deepEqual(twice, once);
  });

  it('leaves every policy with the same rule it had', () => {
    // Called out separately from the whole-state check above because this is
    // the part a `drop policy` + `create policy` pair could plausibly get
    // wrong, and the one with a security consequence if it did.
    assert.deepEqual(twice.policies, once.policies);
    assert.equal(once.policies.length, 28);
  });
});

describe('the statements below the policy section', () => {
  let db;

  before(async () => {
    // A database as it stood before any of this: the frozen pre-tstzrange copy,
    // whose policies are also unguarded.
    db = await blankDb();
    await db.exec(priorSchema);
    await db.exec(SCHEMA);
  });

  it('are reached, so a migration in them actually runs', async () => {
    // `bookings.slot` is retyped roughly 400 lines below the first policy. On
    // the old file the run never got there. This is the whole point: the
    // upgrade path is only an upgrade path if execution reaches it.
    const r = await db.query(`
      select udt_name from information_schema.columns
       where table_schema = 'public' and table_name = 'bookings' and column_name = 'slot'`);
    assert.equal(r.rows[0].udt_name, 'tstzrange');
  });

  it('reach the function definitions too', async () => {
    const r = await db.query(`
      select pg_get_function_result(oid) result
        from pg_proc
       where pronamespace = 'public'::regnamespace and proname = 'shift_slot'`);
    assert.deepEqual(r.rows, [{ result: 'tstzrange' }]);
  });

  it('reach the column grants on matches', async () => {
    const r = await db.query(`
      select column_name from information_schema.column_privileges
       where table_schema = 'public' and table_name = 'matches'
         and grantee = 'authenticated' and privilege_type = 'UPDATE'
       order by column_name`);
    assert.deepEqual(r.rows.map((x) => x.column_name),
                     ['last_message', 'last_message_at', 'opener_dismissed_at']);
  });
});

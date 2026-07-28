# Schema tests

`db/schema.sql` is pasted into the Supabase SQL editor by hand, so nothing had
ever executed it. These tests run the real file against a real PostgreSQL —
[PGlite](https://pglite.dev), Postgres 18 compiled to WebAssembly, in memory,
with the full IANA timezone database. No server, no Docker, no network.

```bash
npm run test:db
```

They exist because the rules being tested are ones a person cannot check by
reading. Whether an 18:00–23:00 shift in Texas is over depends on the shift's
zone, the server's zone, and whether it is July or January; the first attempt at
that check got it wrong in review, and the correction is only trustworthy if
something runs it.

`supabase-stubs.sql` stands in for what Supabase provides and PGlite does not:
the `auth` and `storage` schemas, the `anon` / `authenticated` / `service_role`
roles and their table grants, and the `supabase_realtime` publication.

## What is and is not covered

Fixtures run as **superuser**, which bypasses RLS — that is what makes seeding
convenient. `asUser(db, id, fn)` switches to the `authenticated` role for the
duration of a block, and because the tables are owned by `postgres` and that
role is not the owner, **the policies are enforced**.

Covered: `shift_slot`, `accept_offer`, the migration path, and the policies on
`profiles`, `worker_profiles`, `timesheets` and `shift_payments` — plus the
column grants on `matches`, which are what actually stop a thread being
repointed at another shift, and which no policy could express.

**Not** covered:

* **The storage policies.** `storage.objects` is a stub here, so testing them
  would assert the behaviour of the stub rather than of Supabase.
* **Auth itself.** `auth.uid()` reads `request.jwt.claims` exactly as Supabase's
  does, but nothing here issues or verifies a JWT. These tests check what the
  policies do with an identity, not how the identity is established.
* **That this is Supabase.** It is PostgreSQL 18 with the same SQL. Whether the
  live project matches is still BIG-60.

`rls.test.mjs` opens with a test asserting the mechanism can fail — a superuser
seeing more rows than the signed-in user. Without it, every other assertion in
that file could pass by simply not enforcing anything, which is the exact
failure this replaced.

Two things are pinned deliberately:

* **`set timezone = 'UTC'`**, because that is what Supabase runs and it is the
  condition that made the naive version of the ended check wrong.
* **Dates derived from the current year**, not hard-coded, so a fixture never
  drifts into the past and starts tripping the ended check it was not written
  to test.

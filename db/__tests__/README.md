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
roles, and the `supabase_realtime` publication. The harness connects as
superuser, so **row-level security is never exercised here** — these tests cover
`shift_slot`, `accept_offer`, and the migration path, not the policies.

Two things are pinned deliberately:

* **`set timezone = 'UTC'`**, because that is what Supabase runs and it is the
  condition that made the naive version of the ended check wrong.
* **Dates derived from the current year**, not hard-coded, so a fixture never
  drifts into the past and starts tripping the ended check it was not written
  to test.

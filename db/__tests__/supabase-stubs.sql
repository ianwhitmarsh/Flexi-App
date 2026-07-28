-- Stand-ins for the pieces Supabase provides and PGlite does not, so that
-- db/schema.sql parses and runs unchanged.
--
-- Fixtures run as superuser, which bypasses RLS — that is what makes seeding
-- convenient. `asUser()` in harness.mjs switches to the `authenticated` role,
-- and because these tables are owned by `postgres` and `authenticated` is not
-- the owner, RLS is enforced for the duration. See db/__tests__/README.md.
create role anon;
create role authenticated;
create role service_role;

-- What Supabase grants its roles. Without this, a query as `authenticated`
-- fails with "permission denied for table" *before* RLS is consulted — which
-- would look like a policy doing its job when it is really the grant missing.
--
-- `alter default privileges` rather than a plain grant, because the tables do
-- not exist yet: schema.sql runs after this file. It also has to be this way
-- round so schema.sql's own `revoke update on public.matches from
-- authenticated` lands on top, rather than being clobbered by a later blanket
-- grant.
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on sequences to anon, authenticated, service_role;

create schema if not exists auth;
create table if not exists auth.users (id uuid primary key);

-- Read the identity the way Supabase does — from the request's JWT claims —
-- rather than from a bespoke GUC. That matters: `auth.uid()` is what every
-- policy in schema.sql is written against, so a stub taking its value from
-- somewhere else would be testing a different function than the one that ships.
create or replace function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claims', true)::json ->> 'sub', '')::uuid $$;
create or replace function auth.role() returns text language sql stable as
  $$ select coalesce(current_setting('request.jwt.claims', true)::json ->> 'role', 'anon') $$;

-- `authenticated` has to be able to call these: they appear inside policy
-- expressions, which are evaluated as the querying role.
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid(), auth.role() to anon, authenticated, service_role;

create schema if not exists storage;
create table if not exists storage.buckets (id text primary key, name text, public boolean);
create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text, name text, owner uuid
);
alter table storage.objects enable row level security;
create or replace function storage.foldername(p text) returns text[] language sql immutable as
  $$ select string_to_array(p, '/') $$;

-- Supabase Realtime's publication, which schema.sql adds tables to.
create publication supabase_realtime;

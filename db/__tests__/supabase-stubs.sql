-- Stand-ins for the pieces Supabase provides and PGlite does not. The harness
-- connects as superuser, so RLS is never enforced here; these exist only so
-- db/schema.sql parses and runs unchanged.
create role anon;
create role authenticated;
create role service_role;

create schema if not exists auth;
create table if not exists auth.users (id uuid primary key);
create or replace function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
create or replace function auth.role() returns text language sql stable as
  $$ select 'authenticated'::text $$;

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

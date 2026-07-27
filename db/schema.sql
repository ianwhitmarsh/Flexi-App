-- Flexi — Supabase schema, row-level security, and match-making trigger.
--
-- Paste this into the Supabase SQL editor. Run it as many times as you like:
-- every statement is idempotent, so applying it to a database that already has
-- it upgrades that database rather than failing.
--
-- That is what the file has always been trying to be — `create table if not
-- exists` throughout, `duplicate_column` guards on every added column, the
-- `shifts_status_check` widening, the `bookings.slot` backfill and retype. It
-- previously said "one project = one run", and that belief was how it came to
-- accumulate an upgrade path that could never actually run: 15 of its 28
-- policies had no `drop policy if exists`, so a second run aborted at the first
-- one and nothing below it was ever reached.
--
-- So: when adding to this file, assume it will land on a database that already
-- exists. `db/__tests__/rerunnable.test.mjs` fails if any statement stops being
-- safe to repeat.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text,
  role        text check (role in ('worker', 'business')),
  created_at  timestamptz not null default now()
);

create table if not exists public.worker_profiles (
  id                uuid primary key references public.profiles (id) on delete cascade,
  full_name         text not null,
  headline          text,
  bio               text,
  city              text,
  skills            text[] not null default '{}',
  years_experience  int not null default 0,
  desired_rate      numeric,
  availability      text[] not null default '{}',
  avatar_url        text,
  resume_url        text,
  resume_name       text,
  updated_at        timestamptz not null default now()
);

create table if not exists public.businesses (
  id            uuid primary key references public.profiles (id) on delete cascade,
  company_name  text not null,
  category      text,
  city          text,
  about         text,
  contact_name  text,
  logo_url      text,
  updated_at    timestamptz not null default now()
);

-- How this business talks and what it expects, captured once at onboarding.
-- Prompt context for the opener Flexi sends on their behalf; every key is
-- optional, so an employer who skips the step stores `{}` rather than null and
-- readers never have to distinguish "skipped" from "not asked yet".
do $$ begin
  alter table public.businesses
    add column ai_profile jsonb not null default '{}'::jsonb;
exception when duplicate_column then null; end $$;

create table if not exists public.shifts (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references public.businesses (id) on delete cascade,
  title         text not null,
  role          text not null,
  pay_rate      numeric not null,
  pay_type      text not null default 'hour' check (pay_type in ('hour', 'shift')),
  date          date not null,
  start_time    text not null,
  end_time      text not null,
  location      text,
  description   text,
  requirements  text[] not null default '{}',
  -- `filled` (a worker accepted an offer) and `closed` (the employer called it
  -- off) both leave every deck; they are kept apart because no-show, show-up
  -- rate and timesheet policy all need to know which happened.
  status        text not null default 'open' check (status in ('open', 'filled', 'closed')),
  created_at    timestamptz not null default now()
);

-- Widen the status check on databases created before `filled` existed: the
-- `create table if not exists` above is a no-op for them, so the constraint
-- has to be replaced explicitly. Dropping first keeps this re-runnable.
--
-- Historical rows are left alone on purpose. A shift closed before this change
-- might have been staffed or might have been called off, and nothing stored
-- distinguishes them — guessing would corrupt the very distinction being added.
alter table public.shifts drop constraint if exists shifts_status_check;
alter table public.shifts
  add constraint shifts_status_check check (status in ('open', 'filled', 'closed'));

-- IANA zone the shift's wall-clock times belong to, e.g. `America/Chicago`,
-- captured from the poster's device. Nullable on purpose: shifts posted before
-- this existed have no reliable zone to infer, and the app reads those in the
-- viewer's zone exactly as it always did. Guessing would be worse than absent.
--
-- `shift_slot` resolves it into real instants, so a shift's start and end are
-- absolute points in time rather than a wall clock with no zone attached.
do $$ begin
  alter table public.shifts add column timezone text;
exception when duplicate_column then null; end $$;

create table if not exists public.swipes (
  id          uuid primary key default gen_random_uuid(),
  swiper_id   uuid not null references public.profiles (id) on delete cascade,
  role        text not null check (role in ('worker', 'business')),
  shift_id    uuid not null references public.shifts (id) on delete cascade,
  worker_id   uuid not null references public.profiles (id) on delete cascade,
  direction   text not null check (direction in ('like', 'pass', 'super')),
  created_at  timestamptz not null default now(),
  unique (swiper_id, role, shift_id, worker_id)
);

-- Conversation threads. Named `matches` for continuity: every `messages` row
-- points at it, so renaming the table would orphan existing chat history. A
-- row here means a worker showed interest in a shift and a conversation is
-- open, not that anything was agreed.
create table if not exists public.matches (
  id               uuid primary key default gen_random_uuid(),
  shift_id         uuid not null references public.shifts (id) on delete cascade,
  worker_id        uuid not null references public.profiles (id) on delete cascade,
  business_id      uuid not null references public.profiles (id) on delete cascade,
  created_at       timestamptz not null default now(),
  last_message     text,
  last_message_at  timestamptz,
  unique (shift_id, worker_id)
);

-- When the employer discarded the suggested opener for this thread. The draft
-- is derived from their voice profile and never stored, so this is the only
-- state it needs. Nullable: null means "not decided yet", which is what makes
-- the draft appear.
do $$ begin
  alter table public.matches add column opener_dismissed_at timestamptz;
exception when duplicate_column then null; end $$;

create table if not exists public.messages (
  id          uuid primary key default gen_random_uuid(),
  match_id    uuid not null references public.matches (id) on delete cascade,
  sender_id   uuid not null references public.profiles (id) on delete cascade,
  body        text not null,
  created_at  timestamptz not null default now()
);

-- Foreign key used by the business deck join (swipes -> worker_profiles).
do $$ begin
  alter table public.swipes
    add constraint swipes_worker_id_fkey
    foreign key (worker_id) references public.worker_profiles (id) on delete cascade;
exception when duplicate_object then null; end $$;

create index if not exists shifts_status_idx on public.shifts (status);
create index if not exists swipes_shift_idx on public.swipes (shift_id);
create index if not exists messages_match_idx on public.messages (match_id);

-- ---------------------------------------------------------------------------
-- Match-making trigger: create a match once BOTH sides have liked.
-- SECURITY DEFINER so it can insert the match row regardless of who swiped.
-- ---------------------------------------------------------------------------

-- A worker's like opens a conversation thread with the employer. It does not
-- mean the two sides agreed anything: nothing is agreed until an offer is sent
-- and accepted, which is the single commit point for money.
--
-- This replaces the mutual-like matcher. Business-role swipes no longer happen
-- (the employer reviews an Interested list instead of swiping a deck), so they
-- are ignored rather than removed — dropping the branch would strand the
-- `role = 'business'` rows already in `swipes`.
create or replace function public.on_swipe()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_business uuid;
begin
  if new.direction = 'pass' or new.role <> 'worker' then
    return new;
  end if;

  select business_id into v_business from public.shifts where id = new.shift_id;
  if v_business is null then
    return new;
  end if;

  -- Idempotent: a worker re-liking the same shift reuses the open thread
  -- rather than starting a second one.
  insert into public.matches (shift_id, worker_id, business_id)
  values (new.shift_id, new.worker_id, v_business)
  on conflict (shift_id, worker_id) do nothing;

  return new;
end;
$$;

drop trigger if exists trg_on_swipe on public.swipes;
create trigger trg_on_swipe
  after insert on public.swipes
  for each row execute function public.on_swipe();

-- Backfill: likes recorded while threads only opened on a mutual like have no
-- thread, so the employer's Message action would have nowhere to go. Open one
-- per outstanding like. Idempotent — `on conflict` leaves existing threads and
-- their messages untouched.
insert into public.matches (shift_id, worker_id, business_id, created_at)
select distinct on (sw.shift_id, sw.worker_id)
       sw.shift_id, sw.worker_id, s.business_id, sw.created_at
from public.swipes sw
join public.shifts s on s.id = sw.shift_id
where sw.role = 'worker'
  and sw.direction <> 'pass'
order by sw.shift_id, sw.worker_id, sw.created_at
on conflict (shift_id, worker_id) do nothing;

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

alter table public.profiles        enable row level security;
alter table public.worker_profiles enable row level security;
alter table public.businesses      enable row level security;
alter table public.shifts          enable row level security;
alter table public.swipes          enable row level security;
alter table public.matches         enable row level security;
alter table public.messages        enable row level security;

-- profiles: read/write your own row
drop policy if exists "profiles self read"   on public.profiles;
create policy "profiles self read"   on public.profiles for select using (auth.uid() = id);
drop policy if exists "profiles self insert" on public.profiles;
create policy "profiles self insert" on public.profiles for insert with check (auth.uid() = id);
drop policy if exists "profiles self update" on public.profiles;
create policy "profiles self update" on public.profiles for update using (auth.uid() = id);

-- worker_profiles & businesses are listings: any signed-in user can read them,
-- but only the owner can write their own.
drop policy if exists "workers readable"   on public.worker_profiles;
create policy "workers readable"   on public.worker_profiles for select using (auth.role() = 'authenticated');
drop policy if exists "workers self write" on public.worker_profiles;
create policy "workers self write" on public.worker_profiles for all
  using (auth.uid() = id) with check (auth.uid() = id);

drop policy if exists "businesses readable"   on public.businesses;
create policy "businesses readable"   on public.businesses for select using (auth.role() = 'authenticated');
drop policy if exists "businesses self write" on public.businesses;
create policy "businesses self write" on public.businesses for all
  using (auth.uid() = id) with check (auth.uid() = id);

-- shifts: anyone signed in can browse; only the owning business can write.
drop policy if exists "shifts readable"   on public.shifts;
create policy "shifts readable"   on public.shifts for select using (auth.role() = 'authenticated');
drop policy if exists "shifts owner write" on public.shifts;
create policy "shifts owner write" on public.shifts for all
  using (auth.uid() = business_id) with check (auth.uid() = business_id);

-- swipes: you can read and create your own.
drop policy if exists "swipes self read"   on public.swipes;
create policy "swipes self read"   on public.swipes for select using (auth.uid() = swiper_id);
drop policy if exists "swipes self insert" on public.swipes;
create policy "swipes self insert" on public.swipes for insert with check (auth.uid() = swiper_id);
-- A business also needs to see worker swipes on its own shifts (to build the deck).
drop policy if exists "swipes on my shifts" on public.swipes;
create policy "swipes on my shifts" on public.swipes for select using (
  exists (select 1 from public.shifts s where s.id = shift_id and s.business_id = auth.uid())
);

-- matches: visible to the two participants.
drop policy if exists "matches participants" on public.matches;
create policy "matches participants" on public.matches for select using (
  auth.uid() = worker_id or auth.uid() = business_id
);
-- A participant may touch their own thread, and only their own thread. The
-- `with check` is stated rather than left implicit: with it omitted Postgres
-- reuses `using` as the check, which happens to be the same expression here,
-- but relying on that makes the next edit to `using` silently change what a row
-- is allowed to become.
drop policy if exists "matches participant update" on public.matches;
create policy "matches participant update" on public.matches for update
  using (auth.uid() = worker_id or auth.uid() = business_id)
  with check (auth.uid() = worker_id or auth.uid() = business_id);

-- Which COLUMNS a participant may write is a separate question, and a policy
-- cannot answer it: `with check` only ever sees the new row, so there is no way
-- to say "this column must not change" — no `old` to compare against, unlike in
-- a trigger. Column privileges are the mechanism for that.
--
-- `sendMessage` is the only client write to this table anywhere in the app and
-- it sets exactly these two columns. What identifies the thread — which shift,
-- which worker, which business — is written once by `on_swipe` and must never
-- move afterwards: repointing a thread would carry its whole message history to
-- a different shift, or hand it to a business that was never part of it.
--
-- `on_swipe` is unaffected: it is `security definer`, so it runs as the owner
-- rather than as `authenticated`.
revoke update on public.matches from authenticated;
grant update (last_message, last_message_at, opener_dismissed_at) on public.matches to authenticated;

-- messages: readable/writable by either participant of the parent match.
drop policy if exists "messages read" on public.messages;
create policy "messages read" on public.messages for select using (
  exists (
    select 1 from public.matches m
    where m.id = match_id and (m.worker_id = auth.uid() or m.business_id = auth.uid())
  )
);
drop policy if exists "messages send" on public.messages;
create policy "messages send" on public.messages for insert with check (
  sender_id = auth.uid() and exists (
    select 1 from public.matches m
    where m.id = match_id and (m.worker_id = auth.uid() or m.business_id = auth.uid())
  )
);

-- ---------------------------------------------------------------------------
-- Race-mode offers: an employer sends one shift to several interested workers
-- and the first acceptance wins. See `accept_offer` below for the locking.
-- ---------------------------------------------------------------------------

-- 'standard' keeps the existing swipe-and-match behaviour; 'race' opts the
-- shift into batch offers.
do $$ begin
  alter table public.shifts
    add column fill_mode text not null default 'standard'
    check (fill_mode in ('standard', 'race'));
exception when duplicate_column then null; end $$;

create table if not exists public.offer_batches (
  id           uuid primary key default gen_random_uuid(),
  shift_id     uuid not null references public.shifts (id) on delete cascade,
  business_id  uuid not null references public.profiles (id) on delete cascade,
  created_at   timestamptz not null default now()
);

create table if not exists public.offers (
  id            uuid primary key default gen_random_uuid(),
  batch_id      uuid not null references public.offer_batches (id) on delete cascade,
  shift_id      uuid not null references public.shifts (id) on delete cascade,
  worker_id     uuid not null references public.profiles (id) on delete cascade,
  status        text not null default 'sent'
                check (status in ('sent', 'accepted', 'filled', 'declined')),
  created_at    timestamptz not null default now(),
  responded_at  timestamptz,
  unique (batch_id, worker_id)
);

-- One booking per shift. This unique constraint is the last line of defence
-- against a double-booking if two accepts somehow slip past the row lock.
create table if not exists public.bookings (
  id           uuid primary key default gen_random_uuid(),
  shift_id     uuid not null unique references public.shifts (id) on delete cascade,
  worker_id    uuid not null references public.profiles (id) on delete cascade,
  business_id  uuid not null references public.profiles (id) on delete cascade,
  offer_id     uuid references public.offers (id) on delete set null,
  status       text not null default 'confirmed' check (status in ('confirmed', 'cancelled')),
  created_at   timestamptz not null default now()
);

-- The shift's window as a range of real instants, used by the overlap
-- constraint below, by the overlap check in `accept_offer`, and by the ended
-- check there — one definition so they cannot disagree.
--
-- `start_time` / `end_time` are free text and nothing validates their order. An
-- end that is not after the start means the shift runs past midnight, so the
-- end belongs to the following day: 22:00–02:00 is a four-hour overnight shift,
-- not an empty one.
--
-- The zone is what makes this a `tstzrange` rather than the `tsrange` it used
-- to be. Without one the range was a wall clock with nothing saying whose, so
-- it could only ever be compared against another shift — never against the
-- clock, and never correctly against a shift in a different zone. `AT TIME
-- ZONE` on a naive timestamp is immutable, so this function stays immutable and
-- DST is handled by the zone rather than by arithmetic here.
--
-- `America/Chicago` stands in when a shift has no zone. Those are the rows
-- posted before the column existed, and this is the choice AC-2 asks to be
-- written down rather than left to be inferred later:
--
--   * Their times were *already* being compared in a single unstated zone, so
--     naming one changes nothing about how they compare with each other. It
--     only makes the assumption legible.
--   * Central covers Texas and Oklahoma, and sits between Eastern (FL, GA) and
--     Mountain (AZ), so the worst case for a mis-zoned legacy row is two hours
--     rather than three.
--   * It is deliberately not `UTC`. UTC would be wrong for all five launch
--     states by four to seven hours and would resurrect exactly the bug this
--     replaces.
--
-- New shifts always carry their own zone, so this fallback shrinks to nothing.
drop function if exists public.shift_slot(date, text, text);

create or replace function public.shift_slot(p_date date, p_start text, p_end text, p_timezone text)
returns tstzrange
language sql
immutable
as $$
  select tstzrange(
    (p_date + p_start::time) at time zone coalesce(p_timezone, 'America/Chicago'),
    (case when p_end::time > p_start::time
          then p_date + p_end::time
          else p_date + 1 + p_end::time
     end) at time zone coalesce(p_timezone, 'America/Chicago'),
    '[)'
  );
$$;

-- One worker cannot hold two confirmed bookings that overlap in time.
--
-- The shift row lock in `accept_offer` only serialises accepts for the *same*
-- shift. One worker accepting two different overlapping shifts at once locks
-- two different rows, so both calls can clear the time check before either
-- inserts. Carrying the window on the booking itself lets an exclusion
-- constraint catch that however the two statements interleave.
create extension if not exists btree_gist;

do $$ begin
  alter table public.bookings add column slot tstzrange;
exception when duplicate_column then null; end $$;

-- Databases created before the zone existed carry `slot` as a naive `tsrange`.
-- There is no cast from one to the other, and inventing one would mean guessing
-- a zone per row — so the column is retyped and emptied, and the recompute
-- below rebuilds every value from the shift it came from. `slot` is derived
-- data, never entered, so nothing is lost.
--
-- The exclusion constraint has to go first: it indexes the column being
-- retyped. It is recreated below, against the new type.
do $$ begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'bookings'
       and column_name = 'slot' and udt_name = 'tsrange'
  ) then
    alter table public.bookings drop constraint if exists bookings_no_worker_overlap;
    alter table public.bookings alter column slot drop not null;
    alter table public.bookings alter column slot type tstzrange using null;
  end if;
end $$;

-- Recompute rows the column is missing, rows just emptied by the retype above,
-- and rows an earlier definition of `shift_slot` collapsed to the empty range
-- (every overnight shift booked before BIG-62). Empty ranges overlap nothing,
-- so those bookings are invisible to the constraint until they are rebuilt.
update public.bookings b
   set slot = public.shift_slot(s.date, s.start_time, s.end_time, s.timezone)
  from public.shifts s
 where s.id = b.shift_id and (b.slot is null or isempty(b.slot));

alter table public.bookings alter column slot set not null;

-- Guarded by an explicit lookup rather than by trapping `duplicate_object`,
-- which is what this used to do and which never worked. An exclusion constraint
-- builds an index of the same name, and Postgres reports that collision first
-- as `duplicate_table` — so the handler never fired and a second run raised
-- `relation "bookings_no_worker_overlap" already exists`. Nothing had exercised
-- it before: the retype above is the first change that drops this constraint
-- and puts it back.
do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'bookings_no_worker_overlap'
  ) then
    alter table public.bookings
      add constraint bookings_no_worker_overlap
      exclude using gist (worker_id with =, slot with &&)
      where (status = 'confirmed');
  end if;
end $$;

-- Expo push tokens. A user can have one row per device.
create table if not exists public.push_tokens (
  user_id     uuid not null references public.profiles (id) on delete cascade,
  token       text not null,
  updated_at  timestamptz not null default now(),
  primary key (user_id, token)
);

create index if not exists offers_worker_idx   on public.offers (worker_id, status);
create index if not exists offers_shift_idx    on public.offers (shift_id);
create index if not exists bookings_worker_idx on public.bookings (worker_id);

-- Foreign key used by the offer -> worker profile join.
do $$ begin
  alter table public.offers
    add constraint offers_worker_id_fkey
    foreign key (worker_id) references public.worker_profiles (id) on delete cascade;
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- accept_offer: the whole first-accept-wins decision in one transaction.
--
-- `select ... for update` on the shift row serialises concurrent accepts for
-- the same shift, so the booking check below cannot race. It does not cover
-- one worker accepting two different overlapping shifts at once — those lock
-- different rows — so the insert also relies on `bookings_no_worker_overlap`
-- and reports the loser as `overlap`. SECURITY DEFINER so it can move sibling
-- offers belonging to other workers.
--
-- Returns one of:
--   {"status":"accepted","bookingId":"..."}  booking created, siblings filled,
--                                            shift closed
--   {"status":"filled"}                      someone else already won
--   {"status":"overlap"}                     worker is busy at that time
--
-- Raises when a precondition fails: the offer is not `sent`, or the shift is
-- not `open`. Neither is reachable from the app today — nothing declines an
-- offer, and a losing racer is answered `filled` above — so these enforce in
-- the function what was previously only implied by what the client displays.
-- ---------------------------------------------------------------------------

create or replace function public.accept_offer(p_offer_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me         uuid := auth.uid();
  v_offer      public.offers%rowtype;
  v_shift      public.shifts%rowtype;
  v_booking_id uuid;
  v_overlaps   int;
  v_slot       tstzrange;
begin
  select * into v_offer from public.offers where id = p_offer_id;
  if not found or v_offer.worker_id <> v_me then
    raise exception 'Offer not found';
  end if;

  -- Serialise every accept for this shift.
  select * into v_shift from public.shifts where id = v_offer.shift_id for update;
  if not found then
    raise exception 'Shift not found';
  end if;

  -- Someone already won this shift: retire the caller's offer and say so.
  if exists (select 1 from public.bookings where shift_id = v_offer.shift_id) then
    update public.offers
      set status = 'filled', responded_at = now()
      where shift_id = v_offer.shift_id and status = 'sent';
    return jsonb_build_object('status', 'filled');
  end if;

  -- Preconditions the client cannot be trusted to enforce. Deliberately after
  -- the booking test above: a worker who lost the race holds a `filled` offer
  -- on a `closed` shift, and must still get the friendly `filled` answer
  -- rather than one of these.
  if v_offer.status <> 'sent' then
    raise exception 'This offer is no longer available';
  end if;

  if v_shift.status <> 'open' then
    raise exception 'This shift is no longer open';
  end if;

  v_slot := public.shift_slot(v_shift.date, v_shift.start_time, v_shift.end_time, v_shift.timezone);

  -- Nobody can work a shift that is over, so it must not be bookable.
  --
  -- This is the check an earlier attempt got wrong, and the reason it was wrong
  -- is worth keeping: `shift_slot` used to return a naive wall clock, and
  -- comparing that to `now()` or `localtimestamp` measured it against the
  -- *database server's* clock — UTC on Supabase. An 18:00–23:00 shift in Texas
  -- was declared over at 18:00 local, because UTC had already passed 23:00. It
  -- refused live shifts rather than ended ones. Pinning the server `TimeZone`
  -- would not have rescued it either: the launch states span UTC-4 to UTC-7, so
  -- any single zone is wrong for four of the five, and Arizona skips DST.
  --
  -- It is safe now only because `shift_slot` resolves the shift's own zone, so
  -- `upper(v_slot)` is a real instant and both sides of this comparison are
  -- `timestamptz`. If that ever reverts to a naive type, this reverts with it.
  --
  -- Deliberately after the booking test above, like the other preconditions: a
  -- worker who lost the race on a shift that has since ended should still get
  -- the friendly `filled` answer rather than this.
  if upper(v_slot) <= now() then
    raise exception 'This shift has already ended';
  end if;

  -- Already booked elsewhere during this window? Compared as ranges, using the
  -- same `shift_slot` the constraint below hangs on, so the friendly check and
  -- the enforced one always agree. Not restricted to the same calendar date:
  -- an overnight shift starting on day N runs into day N+1. Because the ranges
  -- are absolute, this is also right for a worker holding shifts in two
  -- different zones — in either direction. Wall clocks that look disjoint can
  -- collide, and identical wall clocks two zones apart do not.
  select count(*) into v_overlaps
  from public.bookings b
  join public.shifts s on s.id = b.shift_id
  where b.worker_id = v_me
    and b.status = 'confirmed'
    and public.shift_slot(s.date, s.start_time, s.end_time, s.timezone) && v_slot;
  if v_overlaps > 0 then
    return jsonb_build_object('status', 'overlap');
  end if;

  -- The check above can still be stale if this worker is accepting another
  -- overlapping shift concurrently: that call locked a different shift row.
  -- `bookings_no_worker_overlap` is what actually decides it, and whichever
  -- insert lands second gets the same `overlap` answer as the sequential case.
  begin
    insert into public.bookings (shift_id, worker_id, business_id, offer_id, slot)
    values (v_offer.shift_id, v_me, v_shift.business_id, v_offer.id, v_slot)
    returning id into v_booking_id;
  exception when exclusion_violation then
    return jsonb_build_object('status', 'overlap');
  end;

  update public.offers
    set status = 'accepted', responded_at = now()
    where id = v_offer.id;

  -- Every other live offer for this shift loses.
  update public.offers
    set status = 'filled', responded_at = now()
    where shift_id = v_offer.shift_id and id <> v_offer.id and status = 'sent';

  -- The shift is taken. Both decks select on `status = 'open'`, so moving it
  -- off `open` here is what stops workers who were never offered it from
  -- swiping a shift that is already gone. `filled` rather than `closed`: the
  -- work is covered, not called off, and no-show and show-up-rate policy later
  -- depends on being able to tell those apart.
  update public.shifts set status = 'filled' where id = v_offer.shift_id;

  return jsonb_build_object('status', 'accepted', 'bookingId', v_booking_id);
end;
$$;

alter table public.offer_batches enable row level security;
alter table public.offers        enable row level security;
alter table public.bookings      enable row level security;
alter table public.push_tokens   enable row level security;

-- Everything below drops before creating, so this section can be applied on
-- its own to a project that already has the tables above it.

-- offer_batches: only the owning business reads/writes.
drop policy if exists "batches owner read"  on public.offer_batches;
create policy "batches owner read"  on public.offer_batches for select
  using (auth.uid() = business_id);

-- `s.status = 'open'` is the enforced half of the same precondition the two
-- backends check. Both of those run on the device, so RLS is what actually
-- stops a batch being sent for a closed or already-booked shift.
drop policy if exists "batches owner write" on public.offer_batches;
create policy "batches owner write" on public.offer_batches for insert
  with check (auth.uid() = business_id and exists (
    select 1 from public.shifts s
    where s.id = shift_id and s.business_id = auth.uid() and s.status = 'open'
  ));

-- offers: the offered worker reads their own; the owning business reads and
-- creates them. Status transitions happen only inside `accept_offer`.
drop policy if exists "offers worker read" on public.offers;
create policy "offers worker read" on public.offers for select
  using (auth.uid() = worker_id);

drop policy if exists "offers business read" on public.offers;
create policy "offers business read" on public.offers for select using (
  exists (select 1 from public.shifts s where s.id = shift_id and s.business_id = auth.uid())
);

drop policy if exists "offers business insert" on public.offers;
create policy "offers business insert" on public.offers for insert with check (
  exists (
    select 1 from public.shifts s
    where s.id = shift_id and s.business_id = auth.uid() and s.status = 'open'
  )
);

-- Declining is the one offer transition a client performs directly. Accepting
-- goes through `accept_offer`, which is `security definer` and so bypasses
-- these policies entirely; there is no equivalent for decline, so it needs a
-- policy of its own. Scoped to the worker's own live offers: `using` picks the
-- rows they may touch, `with check` stops the update leaving the row as
-- anything but `declined` — without it a worker could set their own offer to
-- `accepted` and skip the booking transaction.
drop policy if exists "offers worker decline" on public.offers;
create policy "offers worker decline" on public.offers for update
  using (auth.uid() = worker_id and status = 'sent')
  with check (auth.uid() = worker_id and status = 'declined');

-- bookings: visible to the two participants; only `accept_offer` writes them.
drop policy if exists "bookings participants" on public.bookings;
create policy "bookings participants" on public.bookings for select using (
  auth.uid() = worker_id or auth.uid() = business_id
);

-- push_tokens: you manage your own.
drop policy if exists "push tokens self" on public.push_tokens;
create policy "push tokens self" on public.push_tokens for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- The offer sender needs to look up recipients' tokens.
drop policy if exists "push tokens readable by offerers" on public.push_tokens;
create policy "push tokens readable by offerers" on public.push_tokens for select using (
  exists (
    select 1 from public.offers o
    join public.shifts s on s.id = o.shift_id
    where o.worker_id = push_tokens.user_id and s.business_id = auth.uid()
  )
);

-- ---------------------------------------------------------------------------
-- Storage bucket for résumés — private, owner write, narrow read.
--
-- A résumé carries a legal name, employment history and usually a phone number.
-- This bucket used to be `public = true` with `select using (bucket_id =
-- 'resumes')` — a predicate true for every caller, signed in or not — so every
-- résumé was readable by anyone holding the URL, forever. The URLs were not
-- secret either: they were stored in `worker_profiles.resume_url`, which every
-- signed-in user can read.
--
-- Reading is now the same rule as seeing the profile itself (BIG-77): the
-- worker, or an employer with a live connection to them. The app mints
-- short-lived signed URLs instead of storing permanent ones.
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('resumes', 'resumes', false)
on conflict (id) do update set public = false;

-- The first path segment is the owning worker's uid; `uploadResume` writes
-- `<uid>/<timestamp>-<name>`.
drop policy if exists "resumes public read" on storage.objects;
drop policy if exists "resumes readable by owner or connected employer" on storage.objects;
create policy "resumes readable by owner or connected employer" on storage.objects for select using (
  bucket_id = 'resumes'
  and (
    -- The worker's own file.
    (storage.foldername(name))[1] = auth.uid()::text
    -- Or an employer this worker is connected to, by the same test
    -- `getWorkerProfile` applies: interest in, an offer on, or a booking for
    -- one of the caller's own shifts.
    or exists (
      select 1
      from public.swipes sw
      join public.shifts s on s.id = sw.shift_id
      where sw.role = 'worker'
        and sw.direction <> 'pass'
        and sw.worker_id::text = (storage.foldername(name))[1]
        and s.business_id = auth.uid()
    )
    or exists (
      select 1
      from public.offers o
      join public.shifts s on s.id = o.shift_id
      where o.worker_id::text = (storage.foldername(name))[1]
        and s.business_id = auth.uid()
    )
    or exists (
      select 1
      from public.bookings b
      where b.worker_id::text = (storage.foldername(name))[1]
        and b.business_id = auth.uid()
    )
  )
);

drop policy if exists "resumes owner write" on storage.objects;
create policy "resumes owner write" on storage.objects for insert with check (
  bucket_id = 'resumes' and (storage.foldername(name))[1] = auth.uid()::text
);
drop policy if exists "resumes owner update" on storage.objects;
create policy "resumes owner update" on storage.objects for update using (
  bucket_id = 'resumes' and (storage.foldername(name))[1] = auth.uid()::text
);

-- Enable Realtime on messages (also add via Dashboard → Database → Replication).
-- Adding a table already in the publication is an error rather than a no-op,
-- so this asks first.
do $$ begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public' and tablename = 'messages'
  ) then
    alter publication supabase_realtime add table public.messages;
  end if;
end $$;

-- Flexi — Supabase schema, row-level security, and match-making trigger.
-- Paste this into the Supabase SQL editor (one project = one run).

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
create policy "profiles self read"   on public.profiles for select using (auth.uid() = id);
create policy "profiles self insert" on public.profiles for insert with check (auth.uid() = id);
create policy "profiles self update" on public.profiles for update using (auth.uid() = id);

-- worker_profiles & businesses are listings: any signed-in user can read them,
-- but only the owner can write their own.
create policy "workers readable"   on public.worker_profiles for select using (auth.role() = 'authenticated');
create policy "workers self write" on public.worker_profiles for all
  using (auth.uid() = id) with check (auth.uid() = id);

create policy "businesses readable"   on public.businesses for select using (auth.role() = 'authenticated');
create policy "businesses self write" on public.businesses for all
  using (auth.uid() = id) with check (auth.uid() = id);

-- shifts: anyone signed in can browse; only the owning business can write.
create policy "shifts readable"   on public.shifts for select using (auth.role() = 'authenticated');
create policy "shifts owner write" on public.shifts for all
  using (auth.uid() = business_id) with check (auth.uid() = business_id);

-- swipes: you can read and create your own.
create policy "swipes self read"   on public.swipes for select using (auth.uid() = swiper_id);
create policy "swipes self insert" on public.swipes for insert with check (auth.uid() = swiper_id);
-- A business also needs to see worker swipes on its own shifts (to build the deck).
create policy "swipes on my shifts" on public.swipes for select using (
  exists (select 1 from public.shifts s where s.id = shift_id and s.business_id = auth.uid())
);

-- matches: visible to the two participants.
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
create policy "messages read" on public.messages for select using (
  exists (
    select 1 from public.matches m
    where m.id = match_id and (m.worker_id = auth.uid() or m.business_id = auth.uid())
  )
);
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

-- The shift's window as a range, used by the overlap constraint below and by
-- the overlap check in `accept_offer` — one definition so the two cannot
-- disagree.
--
-- `start_time` / `end_time` are free text and nothing validates their order. An
-- end that is not after the start means the shift runs past midnight, so the
-- end belongs to the following day: 22:00–02:00 is a four-hour overnight shift,
-- not an empty one.
create or replace function public.shift_slot(p_date date, p_start text, p_end text)
returns tsrange
language sql
immutable
as $$
  select tsrange(
    p_date + p_start::time,
    case when p_end::time > p_start::time
         then p_date + p_end::time
         else p_date + 1 + p_end::time
    end,
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
  alter table public.bookings add column slot tsrange;
exception when duplicate_column then null; end $$;

-- Recompute rows the column is missing, and rows an earlier definition of
-- `shift_slot` collapsed to the empty range (every overnight shift booked
-- before BIG-62). Empty ranges overlap nothing, so those bookings are invisible
-- to the constraint until they are rebuilt.
update public.bookings b
   set slot = public.shift_slot(s.date, s.start_time, s.end_time)
  from public.shifts s
 where s.id = b.shift_id and (b.slot is null or isempty(b.slot));

alter table public.bookings alter column slot set not null;

do $$ begin
  alter table public.bookings
    add constraint bookings_no_worker_overlap
    exclude using gist (worker_id with =, slot with &&)
    where (status = 'confirmed');
exception when duplicate_object then null; end $$;

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
  v_slot       tsrange;
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

  v_slot := public.shift_slot(v_shift.date, v_shift.start_time, v_shift.end_time);

  -- Already booked elsewhere during this window? Compared as ranges, using the
  -- same `shift_slot` the constraint below hangs on, so the friendly check and
  -- the enforced one always agree. Not restricted to the same calendar date:
  -- an overnight shift starting on day N runs into day N+1.
  select count(*) into v_overlaps
  from public.bookings b
  join public.shifts s on s.id = b.shift_id
  where b.worker_id = v_me
    and b.status = 'confirmed'
    and public.shift_slot(s.date, s.start_time, s.end_time) && v_slot;
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
-- Storage bucket for résumés (public read, owner write).
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('resumes', 'resumes', true)
on conflict (id) do nothing;

create policy "resumes public read" on storage.objects for select using (bucket_id = 'resumes');
create policy "resumes owner write" on storage.objects for insert with check (
  bucket_id = 'resumes' and (storage.foldername(name))[1] = auth.uid()::text
);
create policy "resumes owner update" on storage.objects for update using (
  bucket_id = 'resumes' and (storage.foldername(name))[1] = auth.uid()::text
);

-- Enable Realtime on messages (also add via Dashboard → Database → Replication).
alter publication supabase_realtime add table public.messages;

-- Run this in the Supabase SQL editor for your project.
-- Enables Row Level Security everywhere so the privacy model
-- (no one-sided visibility, no exact location) is enforced by the
-- database itself, not just app code.

create extension if not exists "uuid-ossp";

-- ---------- PROFILES ----------
-- Note: photo_url points at a file in the `profile-photos` storage bucket
-- (see storage policies near the bottom of this file). photo_verified is
-- set to true only after the moderate-photo Edge Function approves it —
-- profiles with photo_verified = false should be treated as not yet
-- visible to other users (enforced in the sightings/discovery query, see
-- the "Only show verified profiles" policy below).
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  bio text,
  birthdate date not null,
  photo_url text,
  photo_verified boolean default false,
  is_premium boolean default false,
  expo_push_token text,
  created_at timestamptz default now(),
  constraint must_be_18_plus check (birthdate <= (current_date - interval '18 years'))
);

alter table profiles enable row level security;

-- Everyone can always see their own profile (even before photo approval,
-- so they can check their own status/edit it). Other users can only see
-- profiles that have passed photo moderation — an unverified profile is
-- invisible to everyone but its owner, which keeps unmoderated photos
-- out of discovery entirely.
create policy "Users can view own or verified profiles"
  on profiles for select
  using (auth.uid() = id or photo_verified = true);

create policy "Users can update own profile"
  on profiles for update using (auth.uid() = id);

create policy "Users can insert own profile"
  on profiles for insert with check (auth.uid() = id);

-- ---------- PRESENCE REPORTS ----------
-- Ephemeral: only the current/most recent coarse area bucket per user is
-- kept (upserted, not appended), so this table is not a location history.
-- Only ever written by the report-presence Edge Function via the service
-- role — never directly by clients.
create table presence_reports (
  user_id uuid primary key references profiles(id) on delete cascade,
  area text not null,
  reported_at timestamptz default now()
);

alter table presence_reports enable row level security;
-- No select/insert policies for regular users: this table is intentionally
-- inaccessible from the client. Only the service role (Edge Function) touches it.

-- ---------- PROXIMITY SIGHTINGS ----------
-- Stores coarse, time-bounded "crossed paths" events only.
-- No raw GPS trail is retained — rows expire and are purged.
create table sightings (
  id uuid primary key default uuid_generate_v4(),
  user_a uuid references profiles(id) on delete cascade,
  user_b uuid references profiles(id) on delete cascade,
  approx_area text, -- coarse label (e.g. geohash truncated to ~100m), never exact coords
  first_seen_at timestamptz default now(),
  last_seen_at timestamptz default now(),
  expires_at timestamptz default (now() + interval '48 hours'),
  unique (user_a, user_b)
);

alter table sightings enable row level security;

create policy "Users can view their own sightings only"
  on sightings for select
  using (auth.uid() = user_a or auth.uid() = user_b);

-- Sightings are written by a trusted backend function (service role),
-- not directly by clients, to prevent spoofing proximity.

-- ---------- NOTICES (one-sided until mutual) ----------
create table notices (
  id uuid primary key default uuid_generate_v4(),
  from_user uuid references profiles(id) on delete cascade,
  to_user uuid references profiles(id) on delete cascade,
  created_at timestamptz default now(),
  unique (from_user, to_user)
);

alter table notices enable row level security;

-- Critical privacy rule: you can see notices you SENT,
-- but only see notices sent TO you once it's a mutual match
-- (i.e. you've also sent one to them), UNLESS you're premium
-- with "see who noticed you" unlocked.
create policy "See notices you sent"
  on notices for select
  using (auth.uid() = from_user);

create policy "See notices sent to you only if mutual or premium"
  on notices for select
  using (
    auth.uid() = to_user
    and (
      exists (
        select 1 from notices n2
        where n2.from_user = notices.to_user
        and n2.to_user = notices.from_user
      )
      or exists (
        select 1 from profiles p
        where p.id = auth.uid() and p.is_premium = true
      )
    )
  );

create policy "Users can send notices as themselves"
  on notices for insert with check (auth.uid() = from_user);

-- ---------- MATCHES (created when notices become mutual) ----------
create table matches (
  id uuid primary key default uuid_generate_v4(),
  user_a uuid references profiles(id) on delete cascade,
  user_b uuid references profiles(id) on delete cascade,
  matched_at timestamptz default now(),
  unique (user_a, user_b)
);

alter table matches enable row level security;

create policy "Users can view their own matches"
  on matches for select
  using (auth.uid() = user_a or auth.uid() = user_b);

-- ---------- MESSAGES (only within a match) ----------
create table messages (
  id uuid primary key default uuid_generate_v4(),
  match_id uuid references matches(id) on delete cascade,
  sender_id uuid references profiles(id) on delete cascade,
  body text not null,
  created_at timestamptz default now()
);

alter table messages enable row level security;

create policy "Users can view messages in their own matches"
  on messages for select
  using (
    exists (
      select 1 from matches m
      where m.id = messages.match_id
      and (m.user_a = auth.uid() or m.user_b = auth.uid())
    )
  );

create policy "Users can send messages in their own matches"
  on messages for insert
  with check (
    auth.uid() = sender_id
    and exists (
      select 1 from matches m
      where m.id = messages.match_id
      and (m.user_a = auth.uid() or m.user_b = auth.uid())
    )
  );

-- ---------- BLOCKS ----------
-- A block is one-directional and immediate: the blocked user disappears
-- from the blocker's discovery, notices, and matches, and can no longer
-- message them. The blocked user is never told they were blocked.
create table blocks (
  id uuid primary key default uuid_generate_v4(),
  blocker_id uuid references profiles(id) on delete cascade,
  blocked_id uuid references profiles(id) on delete cascade,
  created_at timestamptz default now(),
  unique (blocker_id, blocked_id)
);

alter table blocks enable row level security;

create policy "Users can create their own blocks"
  on blocks for insert with check (auth.uid() = blocker_id);

create policy "Users can view their own blocks"
  on blocks for select using (auth.uid() = blocker_id);

create policy "Users can remove their own blocks"
  on blocks for delete using (auth.uid() = blocker_id);

-- Helper used by other policies: true if either user has blocked the other.
create or replace function is_blocked(user_1 uuid, user_2 uuid)
returns boolean as $$
  select exists (
    select 1 from blocks
    where (blocker_id = user_1 and blocked_id = user_2)
       or (blocker_id = user_2 and blocked_id = user_1)
  );
$$ language sql stable;

-- Re-scope existing policies so blocked pairs never see each other again,
-- even in old data (sightings, notices, matches, messages).
drop policy "Users can view their own sightings only" on sightings;
create policy "Users can view their own sightings only"
  on sightings for select
  using (
    (auth.uid() = user_a or auth.uid() = user_b)
    and not is_blocked(user_a, user_b)
  );

drop policy "See notices you sent" on notices;
create policy "See notices you sent"
  on notices for select
  using (auth.uid() = from_user and not is_blocked(from_user, to_user));

drop policy "See notices sent to you only if mutual or premium" on notices;
create policy "See notices sent to you only if mutual or premium"
  on notices for select
  using (
    auth.uid() = to_user
    and not is_blocked(from_user, to_user)
    and (
      exists (
        select 1 from notices n2
        where n2.from_user = notices.to_user
        and n2.to_user = notices.from_user
      )
      or exists (
        select 1 from profiles p
        where p.id = auth.uid() and p.is_premium = true
      )
    )
  );

drop policy "Users can view their own matches" on matches;
create policy "Users can view their own matches"
  on matches for select
  using (
    (auth.uid() = user_a or auth.uid() = user_b)
    and not is_blocked(user_a, user_b)
  );

drop policy "Users can view messages in their own matches" on messages;
create policy "Users can view messages in their own matches"
  on messages for select
  using (
    exists (
      select 1 from matches m
      where m.id = messages.match_id
      and (m.user_a = auth.uid() or m.user_b = auth.uid())
      and not is_blocked(m.user_a, m.user_b)
    )
  );

drop policy "Users can send messages in their own matches" on messages;
create policy "Users can send messages in their own matches"
  on messages for insert
  with check (
    auth.uid() = sender_id
    and exists (
      select 1 from matches m
      where m.id = messages.match_id
      and (m.user_a = auth.uid() or m.user_b = auth.uid())
      and not is_blocked(m.user_a, m.user_b)
    )
  );

-- ---------- REPORTS ----------
create table reports (
  id uuid primary key default uuid_generate_v4(),
  reporter_id uuid references profiles(id) on delete cascade,
  reported_id uuid references profiles(id) on delete cascade,
  reason text not null,
  details text,
  created_at timestamptz default now(),
  resolved boolean default false
);

alter table reports enable row level security;

create policy "Users can create reports"
  on reports for insert with check (auth.uid() = reporter_id);

create policy "Users can view their own submitted reports"
  on reports for select using (auth.uid() = reporter_id);

-- ---------- ADMIN ACCESS ----------
-- No dashboard/UI for granting this — deliberately manual. Run this
-- directly in the SQL editor for each trusted admin account:
--   update profiles set is_admin = true where id = 'THEIR_USER_UUID';
alter table profiles add column is_admin boolean default false;

create policy "Admins can view all reports"
  on reports for select
  using (exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin = true));

create policy "Admins can resolve reports"
  on reports for update
  using (exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin = true));

create policy "Admins can view all profiles regardless of verification"
  on profiles for select
  using (exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin = true));

-- ---------- AUTO-CREATE MATCH ON MUTUAL NOTICE ----------
create or replace function check_mutual_notice()
returns trigger as $$
begin
  if exists (
    select 1 from notices
    where from_user = new.to_user and to_user = new.from_user
  ) then
    insert into matches (user_a, user_b)
    values (least(new.from_user, new.to_user), greatest(new.from_user, new.to_user))
    on conflict do nothing;
  end if;
  return new;
end;
$$ language plpgsql security definer;

create trigger on_notice_created
  after insert on notices
  for each row execute function check_mutual_notice();

-- ---------- PUSH NOTIFICATIONS ON NEW MATCHES AND MESSAGES ----------
create extension if not exists pg_net;

create or replace function notify_new_match()
returns trigger as $$
begin
  perform net.http_post(
    url := 'YOUR_SUPABASE_PROJECT_URL/functions/v1/send-push',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer YOUR_SERVICE_ROLE_KEY'),
    body := jsonb_build_object(
      'recipient_id', new.user_a,
      'title', 'New match!',
      'body', 'You noticed each other. Say hi.',
      'data', jsonb_build_object('type', 'match', 'match_id', new.id)
    )
  );
  perform net.http_post(
    url := 'YOUR_SUPABASE_PROJECT_URL/functions/v1/send-push',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer YOUR_SERVICE_ROLE_KEY'),
    body := jsonb_build_object(
      'recipient_id', new.user_b,
      'title', 'New match!',
      'body', 'You noticed each other. Say hi.',
      'data', jsonb_build_object('type', 'match', 'match_id', new.id)
    )
  );
  return new;
end;
$$ language plpgsql security definer;

create trigger on_match_created
  after insert on matches
  for each row execute function notify_new_match();

create or replace function notify_new_message()
returns trigger as $$
declare
  recipient uuid;
begin
  select case when m.user_a = new.sender_id then m.user_b else m.user_a end
  into recipient
  from matches m where m.id = new.match_id;

  perform net.http_post(
    url := 'YOUR_SUPABASE_PROJECT_URL/functions/v1/send-push',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer YOUR_SERVICE_ROLE_KEY'),
    body := jsonb_build_object(
      'recipient_id', recipient,
      'title', 'New message',
      'body', left(new.body, 100),
      'data', jsonb_build_object('type', 'message', 'match_id', new.match_id)
    )
  );
  return new;
end;
$$ language plpgsql security definer;

create trigger on_message_created
  after insert on messages
  for each row execute function notify_new_message();

-- ---------- CLEANUP OLD SIGHTINGS (run via cron / scheduled function) ----------
create or replace function purge_expired_sightings()
returns void as $$
begin
  delete from sightings where expires_at < now();
  delete from presence_reports where reported_at < now() - interval '1 hour';
end;
$$ language plpgsql security definer;

-- ---------- PROFILE PHOTO STORAGE ----------
insert into storage.buckets (id, name, public)
values ('profile-photos', 'profile-photos', false)
on conflict (id) do nothing;

create policy "Users can upload their own profile photo"
  on storage.objects for insert
  with check (
    bucket_id = 'profile-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Users can update their own profile photo"
  on storage.objects for update
  using (
    bucket_id = 'profile-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Users can view own or verified profile photos"
  on storage.objects for select
  using (
    bucket_id = 'profile-photos'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or exists (
        select 1 from profiles p
        where p.id::text = (storage.foldername(name))[1]
        and p.photo_verified = true
      )
    )
  );
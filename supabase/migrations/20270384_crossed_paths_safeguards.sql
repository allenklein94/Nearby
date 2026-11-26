-- Crossed paths safeguards (owner, 2026-11-02, after 20270383; staged, never deployed with build 87). Three gaps left by 0383:
--   1. Stale read (0382): viewer_may_read_profile granted a profile read from ANY sighting row, expired or no longer allowed,
--      until the 10-minute purge. Now a sighting counts only while live (expires_at > now()) AND its pair passes the
--      crossed-paths rule, checked on every read.
--   2. Feature consent: being in the Dating or Friends pool was treated as consent to Crossed Paths. Now BOTH people must
--      also have turned Crossed Paths on: private.crossed_paths_consent, OFF by default (no backfill: nobody is opted in by
--      this migration), changed only by set_crossed_paths_sharing (the Settings switch). Off = at once: the pair rule
--      refuses, that person's sightings and probe record are deleted, nothing new is recorded. Every change is logged with its
--      time (private.crossed_paths_consent_log; no client access; cascades on account deletion).
--   3. Probing (concrete exploit, code reading of report-presence): the reported cell is client-supplied and the only check is
--      700 mph against the caller's own previous report, with no rate limit. Tiles 11-33 m apart can be claimed every ~0.1 s,
--      so an opted-in account could sweep ~1 km2 in about 2 minutes and find an opted-in person to ~33 m, then repeat to
--      follow them. Now, for people with Crossed Paths on only, a private one-row record keeps their last ELIGIBLE cell:
--      a NEW cell is eligible at most once per 30 s and 20 times per rolling hour (owner approved as initial values,
--      2026-11-02; watch for friction after launch); re-reporting the same cell only refreshes it. The limits are per account
--      (never per session or device): signing out/in, a new session, clearing presence or switching Crossed Paths off and
--      on keep them (off clears only the cell). Several accounts each get their own allowance (each needs its own verified
--      phone, 0352); documented in PRODUCT_AUDIT/CROSSED_PATHS_LOCATION_TRUST_2026-11-02.md. A sighting is recorded only if BOTH people have an
--      eligible cell from the last 10 minutes, the sighting's cell is one of them and the two are at most one tile apart
--      (the premium 3 x 3). An over-limit sweep therefore creates nothing, even on an exact hit.
--   4. One encounter per pair until it expires (owner decision 2026-11-02): a crossing is recorded ONCE and never refreshed
--      (last_seen_at / expires_at stay as first written, 48 h), so repeated claims of a guessed cell confirm nothing new.
--      A private per-pair memory (private.crossed_paths_encounters: the two account ids + the expiry, no location, no time
--      of the crossing) is written with every new crossing and is NOT deleted when either person switches off, leaves the
--      pool, is hidden or blocks: while it is live, no crossing for that pair is created again, so switching off and on (or
--      leaving and rejoining Dating/Friends, or blocking and unblocking) can't manufacture a fresh encounter. It is deleted
--      at its expiry (purge, every 10 min) or with either account. After that a new crossing is a new encounter (+ its push):
--      inherent to the feature, disclosed. A re-crossing that finds an expired, not-yet-purged row turns it into the new
--      encounter (first_seen_at reset) and sends the same push as a new row.
--      The edge function's `matchedCount` (a per-cell headcount returned to ANY caller, consent or not; unused by the app)
--      is removed in the report-presence source (redeploy with this migration).
-- Not changed: presence_reports themselves (still stored for every reporter: push targeting + online status), the push rule
-- (20270353), 48 h expiry, the stored pin (item 148), the app's reads. Probe records are purged by purge_expired_sightings
-- (every 10 min): the cell after 10 minutes, the row after an hour; encounter memories at their expiry. Residual by design:
-- two people who BOTH turned Crossed Paths on can learn "within ~11-33 m in the last 10 minutes" from one well-guessed
-- claimed cell, once per encounter (48 h per pair), and the target is told who it was.
-- Requires 20270383 (pair rule + guard), 20270382 (viewer_may_read_profile). Deploy after 20270383.

create table if not exists private.crossed_paths_consent (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  enabled_at timestamptz not null default now()
);
create table if not exists private.crossed_paths_consent_log (
  id bigserial primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  enabled boolean not null,
  changed_at timestamptz not null default now()
);
create index if not exists crossed_paths_consent_log_user on private.crossed_paths_consent_log (user_id, changed_at);
create table if not exists private.crossed_paths_probe (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  eligible_area text,
  eligible_at timestamptz,
  last_new_cell_at timestamptz,
  window_start timestamptz,
  window_count integer not null default 0
);
-- 4. one encounter per pair: ids + expiry only (user_a < user_b, as sightings store them)
create table if not exists private.crossed_paths_encounters (
  user_a uuid not null references public.profiles(id) on delete cascade,
  user_b uuid not null references public.profiles(id) on delete cascade,
  expires_at timestamptz not null,
  primary key (user_a, user_b),
  check (user_a < user_b)
);
create index if not exists crossed_paths_encounters_user_b on private.crossed_paths_encounters (user_b);
create index if not exists crossed_paths_encounters_expires on private.crossed_paths_encounters (expires_at);
revoke all on private.crossed_paths_consent, private.crossed_paths_consent_log, private.crossed_paths_probe,
  private.crossed_paths_encounters from public, anon, authenticated;
revoke all on sequence private.crossed_paths_consent_log_id_seq from public, anon, authenticated;

-- The numbers, in one place (owner approved as initial values, 2026-11-02).
create or replace function private.crossed_paths_probe_limits()
returns jsonb language sql immutable set search_path to 'public' as $function$
  select jsonb_build_object('new_cell_gap_seconds', 30, 'new_cells_per_hour', 20, 'eligible_minutes', 10, 'tile', 0.0001);
$function$;
revoke all on function private.crossed_paths_probe_limits() from public, anon, authenticated;

-- 2. Consent: the pair rule now also needs both people's Crossed Paths switch.
create or replace function private.crossed_paths_pair_allowed(a uuid, b uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select a is not null and b is not null and a <> b
    and exists (select 1 from private.crossed_paths_consent c where c.user_id = a)
    and exists (select 1 from private.crossed_paths_consent c where c.user_id = b)
    and public.person_discoverable(a) and public.person_discoverable(b)
    and not exists (select 1 from blocks k where (k.blocker_id = a and k.blocked_id = b)
                                             or (k.blocker_id = b and k.blocked_id = a))
    and exists (
      select 1 from profiles pa, profiles pb
       where pa.id = a and pb.id = b
         and coalesce(pa.photo_verified, false) and not coalesce(pa.profile_hidden, false)
         and coalesce(pb.photo_verified, false) and not coalesce(pb.profile_hidden, false)
         and ((public.is_dating_discoverable(pa.onboarding_motivations) and public.is_dating_discoverable(pb.onboarding_motivations))
              or (coalesce(pa.open_to_friend_discovery, false) and coalesce(pb.open_to_friend_discovery, false))));
$function$;
revoke all on function private.crossed_paths_pair_allowed(uuid, uuid) from public, anon, authenticated;

create or replace function public.get_my_crossed_paths_sharing()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select auth.uid() is not null and exists (select 1 from private.crossed_paths_consent where user_id = auth.uid());
$function$;
revoke all on function public.get_my_crossed_paths_sharing() from public, anon;
grant execute on function public.get_my_crossed_paths_sharing() to authenticated;

create or replace function public.set_crossed_paths_sharing(enabled boolean)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v uuid := auth.uid();
  v_was boolean;
begin
  if v is null then raise exception 'Not signed in' using errcode = '42501'; end if;
  if enabled is null then raise exception 'enabled is required' using errcode = '22004'; end if;
  perform 1 from profiles where id = v for no key update; -- one change at a time per person (never blocks a crossing's FK check)
  v_was := exists (select 1 from private.crossed_paths_consent where user_id = v);
  if enabled then
    insert into private.crossed_paths_consent (user_id) values (v) on conflict (user_id) do nothing;
  else
    delete from private.crossed_paths_consent where user_id = v;
    -- the cell goes at once; the rate counters stay (no location in them) so off -> on can't reset the 30 s / 20 an hour
    -- limits; the purge deletes the row after an hour idle
    update private.crossed_paths_probe set eligible_area = null, eligible_at = null where user_id = v;
    delete from sightings where user_a = v or user_b = v;
    -- private.crossed_paths_encounters is kept on purpose (ids + expiry, no location): switching back on must not create
    -- a fresh encounter with the same person before the original one would have expired
  end if;
  if v_was is distinct from enabled then
    insert into private.crossed_paths_consent_log (user_id, enabled) values (v, enabled);
  end if;
  return enabled;
end;
$function$;
revoke all on function public.set_crossed_paths_sharing(boolean) from public, anon;
grant execute on function public.set_crossed_paths_sharing(boolean) to authenticated;

-- 3a. Probe record: written by every presence report of a person with Crossed Paths on (presence itself is unchanged).
create or replace function private.cells_within_one_tile(x text, y text)
returns boolean
language plpgsql
immutable
set search_path to 'public'
as $function$
declare
  xa numeric; xo numeric; ya numeric; yo numeric;
begin
  if x !~ '^-?\d{1,3}(\.\d{1,4})?,-?\d{1,3}(\.\d{1,4})?$' or y !~ '^-?\d{1,3}(\.\d{1,4})?,-?\d{1,3}(\.\d{1,4})?$' then
    return false;
  end if;
  xa := split_part(x, ',', 1)::numeric; xo := split_part(x, ',', 2)::numeric;
  ya := split_part(y, ',', 1)::numeric; yo := split_part(y, ',', 2)::numeric;
  return abs(xa - ya) <= 0.0001 and abs(xo - yo) <= 0.0001;
end;
$function$;
revoke all on function private.cells_within_one_tile(text, text) from public, anon, authenticated;

create or replace function private.presence_probe_record()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  l jsonb := private.crossed_paths_probe_limits();
  p private.crossed_paths_probe;
  v_now timestamptz := clock_timestamp();
begin
  begin
    -- share lock: a concurrent "off" (deletes consent, then clears this record's cell) can't leave a cell behind
    perform 1 from private.crossed_paths_consent where user_id = new.user_id for share;
    if not found then return new; end if;
    if not private.cells_within_one_tile(new.area, new.area) then return new; end if; -- unparseable: never eligible
    insert into private.crossed_paths_probe (user_id) values (new.user_id) on conflict (user_id) do nothing;
    select * into p from private.crossed_paths_probe where user_id = new.user_id for update;
    if p.eligible_area = new.area and p.eligible_at > v_now - make_interval(mins => (l->>'eligible_minutes')::int) then
      update private.crossed_paths_probe set eligible_at = v_now where user_id = new.user_id; -- same cell: refresh only
    elsif (p.last_new_cell_at is null or p.last_new_cell_at <= v_now - make_interval(secs => (l->>'new_cell_gap_seconds')::int))
          and (p.window_start is null or p.window_start <= v_now - interval '1 hour' or p.window_count < (l->>'new_cells_per_hour')::int) then
      update private.crossed_paths_probe
         set eligible_area = new.area, eligible_at = v_now, last_new_cell_at = v_now,
             window_start = case when p.window_start is null or p.window_start <= v_now - interval '1 hour' then v_now else p.window_start end,
             window_count = case when p.window_start is null or p.window_start <= v_now - interval '1 hour' then 1 else p.window_count + 1 end
       where user_id = new.user_id;
    else
      update private.crossed_paths_probe set eligible_area = null, eligible_at = null where user_id = new.user_id; -- over the limit
    end if;
  exception when others then
    null; -- a presence report never fails because of this record (it then simply isn't eligible)
  end;
  return new;
end;
$function$;
revoke all on function private.presence_probe_record() from public, anon, authenticated;
drop trigger if exists zz_presence_probe_record on public.presence_reports;
create trigger zz_presence_probe_record after insert or update on public.presence_reports
  for each row execute function private.presence_probe_record();

-- 3b. Write guard (0383's trigger keeps its name and order: before sighting_area_to_pin turns the cell into a pin).
create or replace function private.sighting_consent_guard()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  l jsonb := private.crossed_paths_probe_limits();
  pa private.crossed_paths_probe;
  pb private.crossed_paths_probe;
  v_fresh timestamptz := clock_timestamp() - make_interval(mins => (l->>'eligible_minutes')::int);
begin
  -- Both switches, read under a share lock: a concurrent "off" (which deletes the consent row, then the person's crossings)
  -- either waits for this record to commit and then deletes it, or has already committed and this record is refused.
  if (select count(*) from (select 1 from private.crossed_paths_consent c
                             where c.user_id in (new.user_a, new.user_b) for share) x) <> 2 then
    return null;
  end if;
  if not private.crossed_paths_pair_allowed(new.user_a, new.user_b) then
    return null;
  end if;
  -- an UPDATE that doesn't move last_seen_at is not a crossing (report-presence always sets it): maintenance by a trusted
  -- writer, kept as is (clients can't write sightings at all)
  if tg_op = 'UPDATE' and new.last_seen_at is not distinct from old.last_seen_at then
    return new;
  end if;
  -- 4. one encounter per pair: a live encounter (even one whose row was deleted by an off / pool change / block) means
  -- nothing new and nothing refreshed
  if exists (select 1 from private.crossed_paths_encounters e
              where e.user_a = least(new.user_a, new.user_b) and e.user_b = greatest(new.user_a, new.user_b)
                and e.expires_at > now()) then
    return null;
  end if;
  if tg_op = 'UPDATE' and old.expires_at > now() then
    return null; -- a live row is never refreshed
  end if;
  select * into pa from private.crossed_paths_probe where user_id = new.user_a;
  select * into pb from private.crossed_paths_probe where user_id = new.user_b;
  if pa.eligible_area is null or pb.eligible_area is null or pa.eligible_at <= v_fresh or pb.eligible_at <= v_fresh
     or not private.cells_within_one_tile(pa.eligible_area, pb.eligible_area) then
    return null;
  end if;
  -- a new record's cell must be one of the two eligible cells. Not on UPDATE: in report-presence's upsert the BEFORE INSERT
  -- pass has already turned excluded.approx_area into the pin (sighting_area_to_pin), so the update sees the pin; the
  -- two fresh eligible cells one tile apart are what prove the re-crossing.
  if tg_op = 'INSERT' and (new.approx_area is null or new.approx_area not in (pa.eligible_area, pb.eligible_area)) then
    return null;
  end if;
  if tg_op = 'UPDATE' then
    new.first_seen_at := now(); -- an expired row re-used for a NEW encounter (zz_sighting_new_encounter_push tells both)
  end if;
  return new;
end;
$function$;
revoke all on function private.sighting_consent_guard() from public, anon, authenticated;

-- 4. the encounter memory, written with every new crossing (AFTER: an upsert's insert attempt that turns into an update
-- must not see its own memory). Never swallowed: no crossing without its memory.
create or replace function private.sighting_encounter_memory()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if tg_op = 'INSERT' or new.expires_at is distinct from old.expires_at then
    insert into private.crossed_paths_encounters (user_a, user_b, expires_at)
    values (least(new.user_a, new.user_b), greatest(new.user_a, new.user_b), new.expires_at)
    on conflict (user_a, user_b) do update set expires_at = excluded.expires_at;
  end if;
  return null;
end;
$function$;
revoke all on function private.sighting_encounter_memory() from public, anon, authenticated;
drop trigger if exists zz_sighting_encounter_memory on public.sightings;
create trigger zz_sighting_encounter_memory after insert or update on public.sightings
  for each row execute function private.sighting_encounter_memory();
-- an expired row turned into a new encounter sends the same "You crossed paths!" push as a new row (consent rules inside)
drop trigger if exists zz_sighting_new_encounter_push on public.sightings;
create trigger zz_sighting_new_encounter_push after update on public.sightings
  for each row when (old.first_seen_at is distinct from new.first_seen_at)
  execute function public.notify_sighting_crossed_paths();

-- 1. Read: a sighting grants a profile read only while live and allowed (0382's function, only that clause changed).
CREATE OR REPLACE FUNCTION public.viewer_may_read_profile(target uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v uuid := auth.uid();
  v_partner uuid;
begin
  if v is null or target is null then return false; end if;
  if target = v then return true; end if;
  if check_is_admin(v) then return true; end if;
  -- your own block list shows the person you blocked; otherwise a block hides both ways
  if exists (select 1 from blocks b where b.blocker_id = v and b.blocked_id = target) then return true; end if;
  if viewer_blocked_either_way(target) then return false; end if;

  -- shown to you by a capped discovery function recently
  if exists (select 1 from private.profile_served s
              where s.viewer_id = v and s.target_id = target
                and s.last_served_at > now() - make_interval(days => (select l.grant_days from private.profile_read_limits l where l.id))) then
    return true;
  end if;
  -- people you are connected with, or who reached out to you / you to them
  if exists (select 1 from friendships f where (f.user_a = v and f.user_b = target) or (f.user_a = target and f.user_b = v))
     or exists (select 1 from matches m where (m.user_a = v and m.user_b = target) or (m.user_a = target and m.user_b = v))
     or exists (select 1 from notices n where (n.from_user = v and n.to_user = target) or (n.from_user = target and n.to_user = v))
     or exists (select 1 from social_invites i where (i.inviter_id = v and i.invitee_id = target) or (i.inviter_id = target and i.invitee_id = v))
     -- 20270384: a crossing grants a read only while it is live and its pair still passes the crossed-paths rule
     or (exists (select 1 from sightings s where ((s.user_a = v and s.user_b = target) or (s.user_a = target and s.user_b = v))
                   and s.expires_at > now())
         and private.crossed_paths_pair_allowed(v, target))
     or exists (select 1 from referral_redemptions r where (r.referrer_id = v and r.referred_id = target) or (r.referrer_id = target and r.referred_id = v))
     or exists (select 1 from preference_polls pp where (pp.asker_id = v and pp.target_id = target) or (pp.asker_id = target and pp.target_id = v))
     or exists (select 1 from photo_comments pc where (pc.photo_owner_id = v and pc.commenter_id = target) or (pc.photo_owner_id = target and pc.commenter_id = v)) then
    return true;
  end if;
  -- gatherings: fellow approved attendees; the host and anyone in their gathering (any request state); the host of a
  -- current gathering you can see; someone who asked a question on a current gathering you can see
  if exists (select 1 from gathering_interest a join gathering_interest b on b.gathering_id = a.gathering_id
              where a.user_id = v and b.user_id = target and a.status = 'approved' and b.status = 'approved')
     or exists (select 1 from gatherings g join gathering_interest gi on gi.gathering_id = g.id
                 where (g.host_id = v and gi.user_id = target) or (g.host_id = target and gi.user_id = v))
     or exists (select 1 from gatherings g
                 where g.host_id = target and g.scheduled_at > now() - interval '1 day'
                   and _gathering_row_visible(g.id, g.host_id, g.visibility, g.women_only, g.community_id, g.hosting_partner_id))
     or exists (select 1 from gathering_questions q join gatherings g on g.id = q.gathering_id
                 where q.asker_id = target and g.scheduled_at > now() - interval '1 day'
                   and _gathering_row_visible(g.id, g.host_id, g.visibility, g.women_only, g.community_id, g.hosting_partner_id)) then
    return true;
  end if;
  -- communities, group plans, plans you share
  if exists (select 1 from community_members a join community_members b on b.community_id = a.community_id
              where a.user_id = v and b.user_id = target)
     or exists (select 1 from group_plan_participants a join group_plan_participants b on b.proposal_id = a.proposal_id
                 where a.user_id = v and b.user_id = target)
     or exists (select 1 from group_plan_proposals gp join group_plan_participants pa on pa.proposal_id = gp.id
                 where (gp.initiator_id = v and pa.user_id = target) or (gp.initiator_id = target and pa.user_id = v))
     or exists (select 1 from occasion_group_plan_participants a join occasion_group_plan_participants b on b.group_plan_id = a.group_plan_id
                 where a.user_id = v and b.user_id = target)
     or exists (select 1 from occasion_group_plans op join occasion_group_plan_participants pa on pa.group_plan_id = op.id
                 where (op.host_id = v and pa.user_id = target) or (op.host_id = target and pa.user_id = v))
     or exists (select 1 from plans pl
                 where (pl.created_by = v and (exists (select 1 from plan_organizers o where o.plan_id = pl.id and o.user_id = target)
                                               or exists (select 1 from plan_shares sh where sh.plan_id = pl.id and sh.user_id = target)))
                    or (pl.created_by = target and (exists (select 1 from plan_organizers o where o.plan_id = pl.id and o.user_id = v)
                                                    or exists (select 1 from plan_shares sh where sh.plan_id = pl.id and sh.user_id = v))))
     or exists (select 1 from plan_organizers a join plan_organizers b on b.plan_id = a.plan_id where a.user_id = v and b.user_id = target) then
    return true;
  end if;
  -- stories: a current public story of theirs; someone who viewed your story
  if exists (select 1 from stories st where st.user_id = target and st.is_public and st.expires_at > now())
     or exists (select 1 from story_views sv join stories st on st.id = sv.story_id where st.user_id = v and sv.viewer_id = target) then
    return true;
  end if;
  -- business: the business you manage talking with this person or asked by them; the owner of a business talking with you
  v_partner := my_managed_partner_id();
  if v_partner is not null and (
       exists (select 1 from business_partnership_requests r where r.partner_id = v_partner and r.requester_id = target)
       or exists (select 1 from business_messages bm where bm.partner_id = v_partner and bm.conversation_with_id = target)) then
    return true;
  end if;
  if exists (select 1 from business_messages bm where bm.conversation_with_id = v and bm.sender_id = target and bm.from_business) then
    return true;
  end if;
  return false;
end;
$function$;
revoke all on function public.viewer_may_read_profile(uuid) from public, anon;
grant execute on function public.viewer_may_read_profile(uuid) to authenticated, service_role;

-- Retention: probe cells after 10 minutes, probe rows after an hour (plus 0383's sighting purge).
create or replace function public.purge_expired_sightings()
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  delete from sightings where expires_at <= now() or not private.crossed_paths_pair_allowed(user_a, user_b);
  update private.crossed_paths_probe set eligible_area = null, eligible_at = null
   where eligible_at is not null and eligible_at <= now() - interval '10 minutes';
  delete from private.crossed_paths_probe
   where (eligible_at is null or eligible_at <= now() - interval '1 hour')
     and (window_start is null or window_start <= now() - interval '1 hour');
  delete from private.crossed_paths_encounters where expires_at <= now();
end;
$function$;
revoke execute on function public.purge_expired_sightings() from public, anon, authenticated;

-- Nobody has turned Crossed Paths on yet, so this removes every existing sighting (they expire within 48 h anyway).
select public.purge_expired_sightings();

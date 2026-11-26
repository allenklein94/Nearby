-- Crossed paths only between people who both chose it (owner idea 10 follow-up, 2026-11-01; staged, never deployed with
-- build 87). Found 2026-11-01 (code reading; prod behaviour, not only staged): the live report-presence edge function
-- records a sighting for ANY two people whose phones report the same ~11 m cell (premium: the 3 x 3 neighbours, ~33 m)
-- within 10 minutes, whether or not either opted into Dating or Friends discovery; its block check is a no-op (is_blocked
-- returns false whenever auth.uid() is not one of the pair, and the function runs as the service role); background
-- reporting starts for every signed-in user who grants background location. Each person could then read their own
-- sighting rows through the API (the other person's id + last_seen_at) even though the app only SHOWS a crossing inside
-- an opted-in pool. Since the reported cell is client-supplied (only a 700 mph check), that let someone confirm another
-- person's presence at a claimed place, to ~11 m, within 10 minutes, without that person's consent. 20270353 (staged)
-- fixed only the push; with 20270382 a sighting would also have granted a profile read.
-- Now ONE pair rule, private.crossed_paths_pair_allowed(a, b), the push rule of 20270353 minus the recipient's own
-- notification switch (that switch stays on the push only):
--   both discoverable (person_discoverable: not suspended, verified phone; 20270352), both profiles visible to others
--   (screened photo, not hidden), no block either way, both in the SAME opted-in pool (both Dating, or both open to
--   friend discovery).
--   1. Write: a BEFORE INSERT OR UPDATE trigger drops a sighting the rule refuses (no row, no push, no error; the edge
--      function and the app need no change).
--   2. Read: the policy also needs the rule, so a later opt-out, hide, suspension or block hides existing rows at once.
--   3. Retention: purge_expired_sightings (cron every 10 min) also deletes rows the rule now refuses; run once here.
-- Not changed: what is stored (an approximate pin, item 148), 48 h expiry, the push rule (20270353), presence reports
-- (also used for push targeting and online status), the app. Remaining by design, for a pair who BOTH opted in: a crossing
-- still means "within ~11-33 m within 10 minutes" and the cell is client-supplied, so one opted-in person can confirm
-- another opted-in person's presence at a claimed place (owner decision on coarsening/delay recorded separately).
-- Requires 20270352 (person_discoverable), 20270339 (policy + purge), 20270353 (push rule). Deploy after 20270382.

create or replace function private.crossed_paths_pair_allowed(a uuid, b uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select a is not null and b is not null and a <> b
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

-- For the read policy: answers only for a pair that includes the caller (never an oracle about two other people).
create or replace function public.sighting_pair_visible(a uuid, b uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select auth.uid() is not null and auth.uid() in (a, b) and private.crossed_paths_pair_allowed(a, b);
$function$;
revoke all on function public.sighting_pair_visible(uuid, uuid) from public, anon;
grant execute on function public.sighting_pair_visible(uuid, uuid) to authenticated;

-- 1. Write guard (named to run before sighting_area_to_pin).
create or replace function private.sighting_consent_guard()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not private.crossed_paths_pair_allowed(new.user_a, new.user_b) then
    return null;
  end if;
  return new;
end;
$function$;
revoke all on function private.sighting_consent_guard() from public, anon, authenticated;
drop trigger if exists aa_sighting_consent_guard on public.sightings;
create trigger aa_sighting_consent_guard before insert or update on public.sightings
  for each row execute function private.sighting_consent_guard();

-- 2. Read.
drop policy if exists "Users can view their own sightings only" on public.sightings;
create policy "Users can view their own sightings only" on public.sightings
  for select
  using (((auth.uid() = user_a) or (auth.uid() = user_b)) and expires_at > now() and public.sighting_pair_visible(user_a, user_b));

-- 3. Retention.
create or replace function public.purge_expired_sightings()
 returns void
 language sql
 security definer
 set search_path to 'public'
as $function$
  delete from sightings where expires_at <= now() or not private.crossed_paths_pair_allowed(user_a, user_b);
$function$;
revoke execute on function public.purge_expired_sightings() from public, anon, authenticated;

select public.purge_expired_sightings();

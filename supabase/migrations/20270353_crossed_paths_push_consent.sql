-- Privacy launch blocker (owner, 2026-10-27): the crossed-paths push named the other person to anyone they crossed,
-- even someone who never opted into people discovery. The app itself only shows a crossing to a person who could see
-- the other in a discovery surface (Dating: the other's Dating opt-in; Friends: both open to friend discovery); the push
-- skipped all of that, and also ignored blocks (is_blocked reads auth.uid(), which is empty in this trigger: the
-- sighting is written by the report-presence service).
-- Now one rule, _crossed_paths_may_tell(recipient, other), decides each direction of the push; anything else = no push
-- at all (never a nameless "someone nearby" push: the push's data carries the other person's id).
--   both people discoverable (person_discoverable: not suspended, verified phone; 20270352)
--   the other's profile is visible to others (screened photo, not hidden: the profiles read policy's rule)
--   no block either way (read here directly, in this server-only function)
--   both opted into the SAME pool: both Dating ('Go on dates') or both open to friend discovery
--   the recipient's own proximity notifications on (unchanged)
-- Sightings themselves, their 48 h expiry, the app's Crossed Paths lists and the push wording are unchanged.
-- Requires 20270352 (person_discoverable).

create or replace function public._crossed_paths_may_tell(recipient uuid, other uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select recipient is not null and other is not null and recipient <> other
    and public.person_discoverable(recipient) and public.person_discoverable(other)
    and not exists (select 1 from blocks b where (b.blocker_id = recipient and b.blocked_id = other)
                                              or (b.blocker_id = other and b.blocked_id = recipient))
    and exists (
      select 1 from profiles r, profiles o
      where r.id = recipient and o.id = other
        and coalesce(o.photo_verified, false) and not coalesce(o.profile_hidden, false)
        and coalesce(r.notify_proximity, true)
        and (
          (is_dating_discoverable(r.onboarding_motivations) and is_dating_discoverable(o.onboarding_motivations))
          or (coalesce(r.open_to_friend_discovery, false) and coalesce(o.open_to_friend_discovery, false))
        )
    );
$function$;
revoke all on function public._crossed_paths_may_tell(uuid, uuid) from public, anon, authenticated;

create or replace function public.notify_sighting_crossed_paths()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  name_a text;
  name_b text;
begin
  select display_name into name_a from profiles where id = new.user_a;
  select display_name into name_b from profiles where id = new.user_b;

  if public._crossed_paths_may_tell(new.user_a, new.user_b) then
    perform public._send_push(new.user_a, 'You crossed paths! 👋', 'You and ' || coalesce(name_b, 'someone nearby') || ' were near each other just now.', jsonb_build_object('type', 'crossed_paths_sighting', 'other_user_id', new.user_b));
  end if;

  if public._crossed_paths_may_tell(new.user_b, new.user_a) then
    perform public._send_push(new.user_b, 'You crossed paths! 👋', 'You and ' || coalesce(name_a, 'someone nearby') || ' were near each other just now.', jsonb_build_object('type', 'crossed_paths_sighting', 'other_user_id', new.user_a));
  end if;

  return new;
end;
$function$;

-- ---------------------------------------------------------------------------------------------------------------------
-- Sighting consent, moved forward from 20270383 (owner, 2026-11-28: resolve Crossed Paths consent in Phase A, not after
-- build 88). The statements below are copied VERBATIM from 20270383, which stays byte-identical and re-states them when its
-- turn comes (CREATE OR REPLACE / DROP ... IF EXISTS: a no-op then). Nothing between 20270354 and 20270382 redefines the
-- sightings read policy, purge_expired_sightings or these functions (checked 2026-11-28), so the protection holds from here.
-- What it adds to the push rule above: a sighting is recorded, readable and kept ONLY for a pair who both chose the same
-- pool (Dating or friend discovery), both discoverable, both visible, no block either way:
--   1. Write: BEFORE INSERT OR UPDATE trigger drops a refused sighting (no row, no push, no error; report-presence unchanged).
--   2. Read: the policy also needs the rule, so a later opt-out, hide, suspension or block hides existing rows at once.
--   3. Retention: purge_expired_sightings (cron every 10 min) also deletes refused rows; run once here.
-- Requires 20270352 (person_discoverable), 20270339 (policy + purge) and the push rule above.

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

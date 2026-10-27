-- Privacy launch blocker (owner, 2026-10-27): the crossed-paths push named the other person to anyone they crossed,
-- even someone who never opted into people discovery. The app itself only shows a crossing to a person who could see
-- the other in a discovery surface (Dating: the other's Dating opt-in; Friends: both open to friend discovery); the push
-- skipped all of that, and also ignored blocks (is_blocked reads auth.uid(), which is empty in this trigger: the
-- sighting is written by the report-presence service).
-- Now one rule, _crossed_paths_may_tell(recipient, other), decides each direction of the push; anything else = no push
-- at all (never a nameless "someone nearby" push: the push's data carries the other person's id).
--   both people discoverable (person_discoverable: not suspended, verified phone; 20270350)
--   the other's profile is visible to others (screened photo, not hidden: the profiles read policy's rule)
--   no block either way (read here directly, in this server-only function)
--   both opted into the SAME pool: both Dating ('Go on dates') or both open to friend discovery
--   the recipient's own proximity notifications on (unchanged)
-- Sightings themselves, their 48 h expiry, the app's Crossed Paths lists and the push wording are unchanged.
-- Requires 20270350 (person_discoverable).

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

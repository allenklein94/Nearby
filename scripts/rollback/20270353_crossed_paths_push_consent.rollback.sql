-- Rollback for migration 20270353 (crossed-paths push consent): restores the production definitions read 2026-10-27 before it was applied.
-- Run the rollbacks newest first (20270354 -> 20270347); each assumes the later ones were already rolled back.
CREATE OR REPLACE FUNCTION public.notify_sighting_crossed_paths()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  name_a text;
  name_b text;
  a_wants_notif boolean;
  b_wants_notif boolean;
begin
  select display_name into name_a from profiles where id = new.user_a;
  select display_name into name_b from profiles where id = new.user_b;

  select coalesce(notify_proximity, true) into a_wants_notif from profiles where id = new.user_a;
  select coalesce(notify_proximity, true) into b_wants_notif from profiles where id = new.user_b;

  if a_wants_notif then
    perform public._send_push(new.user_a, 'You crossed paths! 👋', 'You and ' || coalesce(name_b, 'someone nearby') || ' were near each other just now.', jsonb_build_object('type', 'crossed_paths_sighting', 'other_user_id', new.user_b));
  end if;

  if b_wants_notif then
    perform public._send_push(new.user_b, 'You crossed paths! 👋', 'You and ' || coalesce(name_a, 'someone nearby') || ' were near each other just now.', jsonb_build_object('type', 'crossed_paths_sighting', 'other_user_id', new.user_a));
  end if;

  return new;
end;
$function$;
drop function if exists public._crossed_paths_may_tell(uuid, uuid);

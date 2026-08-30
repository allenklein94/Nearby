-- Aug 30 2026 (CLAUDE.md) -- "I clicked the option for 'im on my way' after
-- accepting a gathering but I don't see a way to undo that action?" --
-- confirmed real: set_gathering_on_my_way() has no counterpart, and
-- GatheringHubScreen.js's own button was disabled once tapped, with no
-- path back. Mirrors set_gathering_on_my_way()'s exact shape (pulled fresh
-- from the live baseline before writing this, not reconstructed from
-- memory) -- same owner-scoped update, same approved-only guard, just
-- clearing the timestamp back to null instead of setting it.
CREATE OR REPLACE FUNCTION public.unset_gathering_on_my_way(gathering_id_param uuid)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  update gathering_interest
  set on_my_way_at = null
  where gathering_id = gathering_id_param
    and user_id = auth.uid()
    and status = 'approved';
$function$
;

revoke all on function public.unset_gathering_on_my_way(uuid) from public, anon;
grant execute on function public.unset_gathering_on_my_way(uuid) to authenticated, service_role;

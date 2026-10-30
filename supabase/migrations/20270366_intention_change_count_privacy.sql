-- Final gap audit (owner, 2026-10-30): get_intention_change_count(user) returned another person's 30-day count of "what
-- are you looking for" changes to ANY signed-in caller, for any id: also for hidden, unverified or suspended profiles and
-- across a block either way. Now it answers only for the caller themself or a profile the caller can already open, by the
-- SAME rule as people_visible_to_me (the profile read ViewProfile uses; 20270348): signed in, and verified + not hidden
-- (or the caller is an admin), and no block either way. Anything else = null (the app shows nothing, as for 0 changes).
-- Signature, grants and the client are unchanged. Staged after 20270365; deploy with its own approval.
create or replace function public.get_intention_change_count(target_user_id uuid)
returns integer
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  change_count integer;
begin
  if auth.uid() is null or target_user_id is null
     or not exists (select 1 from people_visible_to_me v where v.id = target_user_id) then
    return null;
  end if;
  select count(*) into change_count
  from intention_history
  where user_id = target_user_id
    and changed_at >= now() - interval '30 days';
  return change_count;
end;
$function$;

-- Rollback for migration 20270366: the earlier (unrestricted) count, verbatim from production. Run before rolling back 20270365.
CREATE OR REPLACE FUNCTION public.get_intention_change_count(target_user_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  change_count integer;
begin
  select count(*) into change_count
  from intention_history
  where user_id = target_user_id
    and changed_at >= now() - interval '30 days';
  return change_count;
end;
$function$;

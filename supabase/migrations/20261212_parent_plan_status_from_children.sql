-- State-machine audit gap 5: a child plan (the gathering / business request that resulted from an occasion plan) being
-- cancelled, confirmed or completed left the parent occasion plan stuck at 'draft'. The parent's status is now recomputed
-- from its children, so it is a stored fact everything reads consistently, not something only children[] revealed.
--
-- Scope: parent plan_type = 'occasion' only. Match plans (dating_match / friend_match) are long-lived relationship
-- containers -- one cancelled date must never cancel the relationship's plan -- and group_occasion parents already follow
-- their group plan via sync_plan_from_group_plan.
--   any live child (draft/confirmed)      -> parent confirmed if any child is confirmed, else draft (so re-planning after a
--                                            cancellation revives a cancelled parent)
--   no live child, some completed         -> completed
--   every child cancelled (>=1 child)     -> cancelled

create or replace function public.sync_parent_plan_status_from_children()
returns trigger language plpgsql security definer set search_path to 'public' as $function$
declare
  v_parent_id uuid;
  v_type text;
  v_current text;
  v_next text;
  v_live int;
  v_confirmed int;
  v_completed int;
  v_total int;
begin
  v_parent_id := new.parent_plan_id;
  if v_parent_id is null then return null; end if;
  select plan_type, status into v_type, v_current from plans where id = v_parent_id;
  if v_type is distinct from 'occasion' then return null; end if;

  select count(*) filter (where status in ('draft', 'confirmed')),
         count(*) filter (where status = 'confirmed'),
         count(*) filter (where status = 'completed'),
         count(*)
    into v_live, v_confirmed, v_completed, v_total
  from plans where parent_plan_id = v_parent_id;

  v_next := case
    when v_total = 0 then v_current
    when v_live > 0 then case when v_confirmed > 0 then 'confirmed' else 'draft' end
    when v_completed > 0 then 'completed'
    else 'cancelled'
  end;

  if v_next is distinct from v_current then
    update plans set status = v_next where id = v_parent_id;
  end if;
  return null;
end;
$function$;

revoke all on function public.sync_parent_plan_status_from_children() from public, anon;

drop trigger if exists on_child_plan_sync_parent_status on public.plans;
create trigger on_child_plan_sync_parent_status
  after insert or update of status, parent_plan_id on public.plans
  for each row when (new.parent_plan_id is not null)
  execute function public.sync_parent_plan_status_from_children();

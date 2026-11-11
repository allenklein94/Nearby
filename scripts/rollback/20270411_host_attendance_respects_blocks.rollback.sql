-- Rollback for 20270411: restores the host read branch, the two business functions and waitlist promotion exactly as
-- before (the host again reads every row on their own gathering, a blocked person's too). No row was changed by 0411, so
-- nothing else to undo.
alter policy "Users see own interest or gatherings they host" on public.gathering_interest
  using ((auth.uid() = user_id) or (auth.uid() = (select gatherings.host_id from gatherings where gatherings.id = gathering_interest.gathering_id)));

create or replace function public.get_business_top_members(partner_id_param uuid)
 returns table(user_id uuid, display_name text, gatherings_attended bigint)
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
begin
  if not exists (select 1 from profiles where id = auth.uid() and managed_partner_id = partner_id_param) then
    return;
  end if;

  return query
  select p.id, p.display_name, count(*) as gatherings_attended
  from gathering_interest gi
  join gatherings g on g.id = gi.gathering_id
  join profiles p on p.id = gi.user_id
  where g.hosting_partner_id = partner_id_param
  and gi.status = 'approved'
  group by p.id, p.display_name
  order by gatherings_attended desc
  limit 5;
end;
$function$;

create or replace function public.get_business_member_gathering_history(partner_id_param uuid, member_id_param uuid)
 returns table(gathering_id uuid, title text, scheduled_at timestamp with time zone)
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
begin
  if not exists (select 1 from profiles where id = auth.uid() and managed_partner_id = partner_id_param) then
    return;
  end if;

  return query
  select g.id, g.title, g.scheduled_at
  from gathering_interest gi
  join gatherings g on g.id = gi.gathering_id
  where g.hosting_partner_id = partner_id_param
  and gi.status = 'approved'
  and gi.user_id = member_id_param
  order by g.scheduled_at desc;
end;
$function$;

-- _promote_from_waitlist as before 20270411 (promotes the earliest waitlisted person, blocked or not)
create or replace function public._promote_from_waitlist(gathering_id_param uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_host uuid; v_capacity integer; v_needs_approval boolean;
  v_approved integer; v_pending integer;
  v_next uuid; v_next_user uuid;
begin
  select host_id, capacity, (not coalesce(is_public, true)) or coalesce(requires_approval, false)
    into v_host, v_capacity, v_needs_approval
    from gatherings where id = gathering_id_param;
  if v_host is null or v_capacity is null then return null; end if;

  select count(*) filter (where status = 'approved'), count(*) filter (where status = 'pending')
    into v_approved, v_pending
    from gathering_interest where gathering_id = gathering_id_param;
  if v_approved >= public._gathering_guest_limit(v_capacity) then return null; end if;
  if v_needs_approval and v_approved + v_pending >= public._gathering_guest_limit(v_capacity) then return null; end if;

  select id into v_next from gathering_interest
   where gathering_id = gathering_id_param and status = 'waitlisted'
   order by created_at asc limit 1 for update;
  if v_next is null then return null; end if;

  if v_needs_approval then
    update gathering_interest set status = 'pending' where id = v_next returning user_id into v_next_user;
    return jsonb_build_object('user_id', v_next_user, 'status', 'pending');
  end if;

  update gathering_interest set status = 'approved' where id = v_next returning user_id into v_next_user;
  insert into matches (user_a, user_b, source_gathering_id)
  values (least(v_host, v_next_user), greatest(v_host, v_next_user), gathering_id_param)
  on conflict (user_a, user_b) do update set source_gathering_id = gathering_id_param
    where matches.source_gathering_id is null;
  return jsonb_build_object('user_id', v_next_user, 'status', 'approved');
end;
$function$

;

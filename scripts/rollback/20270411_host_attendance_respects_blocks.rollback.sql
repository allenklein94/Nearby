-- Rollback for 20270411: restores the host read branch and the two business functions exactly as
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

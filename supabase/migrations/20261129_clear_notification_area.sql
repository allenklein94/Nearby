-- Clear-my-area control for the notification area (20261128). Turning "Discovery" notifications off (the
-- master switch, profiles.notify_discovery) now also means the server stops holding an area: the setter
-- deletes instead of writing while it's off, and clear_my_notification_area() lets the user remove the row
-- on demand. Same signature as before -> replaces in place, no second overload.
create or replace function public.set_my_notification_area(lat_param double precision, lng_param double precision)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if lat_param is null or lng_param is null or lat_param not between -90 and 90 or lng_param not between -180 and 180 then
    raise exception 'invalid coordinates';
  end if;
  if not coalesce((select notify_discovery from profiles where id = auth.uid()), true) then
    delete from notification_areas where user_id = auth.uid();
    return;
  end if;
  insert into notification_areas (user_id, area, updated_at)
  values (auth.uid(), round(lat_param::numeric, 2)::text || ',' || round(lng_param::numeric, 2)::text, now())
  on conflict (user_id) do update set area = excluded.area, updated_at = now();
end;
$function$;

create or replace function public.clear_my_notification_area()
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  delete from notification_areas where user_id = auth.uid();
end;
$function$;
revoke all on function public.clear_my_notification_area() from public, anon;
grant execute on function public.clear_my_notification_area() to authenticated;

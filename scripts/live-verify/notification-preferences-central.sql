-- Item 142: central notification preferences. Runs against prod inside a transaction that always rolls back.
-- Usage: prepend `begin;` + (when the migration is not yet applied) the migration file, append `rollback;`.
do $$
declare
  a uuid; b uuid; r text; n int; m text[];
begin
  select id into a from profiles order by id limit 1;
  select id into b from profiles where id <> a order by id limit 1;
  perform set_config('app.push_handoff_test_failure', 'true', true);  -- never call send-push for real

  -- 1. a muted group's push is never queued; the sender says why
  update profiles set notification_mutes = '{dating}' where id = a;
  select count(*) into n from push_outbox;
  r := public._send_push(a, 't', 'b', jsonb_build_object('type', 'message'));
  if r <> 'muted' then raise exception '1 expected muted, got %', r; end if;
  if (select count(*) from push_outbox) <> n then raise exception '1 a muted push was queued'; end if;

  -- 2. another group still goes out; an unknown type is never muted; business-owner types are never muted here
  if public._send_push(a, 't', 'b', jsonb_build_object('type', 'friend_request')) = 'muted' then raise exception '2 friend_request muted'; end if;
  if public._push_muted(a, 'brand_new_type') then raise exception '2 unknown type muted'; end if;
  if public._push_muted(a, 'business_opportunity_received') then raise exception '2 owner type muted'; end if;
  if public._push_muted(b, 'message') then raise exception '2 other person muted'; end if;

  -- 3. older columns are derived: off only when the whole area is off, and a direct write cannot override
  if (select notify_dating from profiles where id = a) then raise exception '3 notify_dating should be false'; end if;
  update profiles set notification_mutes = '{plans_changes}' where id = a;
  if not (select notify_planning from profiles where id = a) then raise exception '3 one plans group turned off all of Plans'; end if;
  update profiles set notification_mutes = '{plans_invitations,plans_changes,plans_reminders}' where id = a;
  if (select notify_planning from profiles where id = a) then raise exception '3 all plans groups off but notify_planning true'; end if;
  update profiles set notify_planning = true where id = a;
  if (select notify_planning from profiles where id = a) then raise exception '3 direct write overrode the store'; end if;
  if not (select notify_dating from profiles where id = a) then raise exception '3 notify_dating should be back on'; end if;

  -- 4. unknown group refused by the CHECK
  begin
    update profiles set notification_mutes = '{nonsense}' where id = a;
    raise exception '4 CHECK accepted an unknown group';
  exception when check_violation then null;
  end;

  -- 5. the setter: only the signed-in person, only real groups, idempotent
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  m := public.set_my_notification_group('communities', false);
  m := public.set_my_notification_group('communities', false);
  if m <> '{communities}' then raise exception '5 setter result %', m; end if;
  if (select notify_community from profiles where id = b) then raise exception '5 notify_community not derived'; end if;
  m := public.set_my_notification_group('communities', true);
  if m <> '{}' then raise exception '5 re-enable result %', m; end if;
  begin
    perform public.set_my_notification_group('nonsense', false);
    raise exception '5 unknown group accepted';
  exception when raise_exception then
    if sqlerrm not like 'Unknown notification type%' then raise; end if;
  end;
  perform set_config('request.jwt.claims', '', true);
  begin
    perform public.set_my_notification_group('dating', false);
    raise exception '5 signed-out call accepted';
  exception when raise_exception then
    if sqlerrm not like 'Not signed in%' then raise; end if;
  end;

  -- 6. grants and single overloads
  if has_function_privilege('anon', 'public.set_my_notification_group(text, boolean)', 'execute') then raise exception '6 anon can set'; end if;
  if has_function_privilege('authenticated', 'public._push_muted(uuid, text)', 'execute') then raise exception '6 client can read mutes helper'; end if;
  if has_table_privilege('authenticated', 'public.notification_type_groups', 'select') then raise exception '6 client can read table'; end if;
  if (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname in ('_send_push', '_notify_event_recipient', 'set_my_notification_group', '_push_muted', 'notify_interested_friend_joined')) <> 5 then
    raise exception '6 overloads';
  end if;
  if (select count(*) from notification_type_groups) <> 75 then raise exception '6 seed count %', (select count(*) from notification_type_groups); end if;
end $$;
select 'ALL OK' as result;

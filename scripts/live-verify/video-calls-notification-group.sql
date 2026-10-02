-- Video calls split from Dating (20270261). Runs against prod inside a transaction that always rolls back.
-- Usage: prepend `begin;` + (when the migration is not yet applied) the migration file, append `rollback;`.
-- Calls go through the REAL, unchanged sender notify_video_call_started, from a friend match and from a dating match.
do $$
declare
  a uuid; b uuid; c uuid; f uuid; m_friend uuid; m_date uuid; n int;
begin
  select id into a from profiles order by id limit 1;
  select id into b from profiles where id <> a order by id limit 1;
  select id into c from profiles where id not in (a, b) order by id limit 1;
  perform set_config('app.push_handoff_test_failure', 'true', true);  -- never call send-push for real

  -- fixtures: a friend match (a, b) from an accepted friendship, and a dating match (a, c) with no friendship/gathering
  delete from matches where (user_a, user_b) in ((a, b), (b, a), (a, c), (c, a));
  delete from friendships where (user_a, user_b) in ((a, b), (b, a));
  insert into friendships (user_a, user_b, status, requested_by) values (a, b, 'accepted', b) returning id into f;
  insert into matches (user_a, user_b, source_friendship_id) values (a, b, f) returning id into m_friend;
  insert into matches (user_a, user_b) values (a, c) returning id into m_date;

  -- 0. mapping
  if (select group_key from notification_type_groups where type = 'video_call') <> 'video_calls' then raise exception '0 seed'; end if;
  if (select group_key from notification_type_groups where type = 'message') <> 'messages' then raise exception '0 messages seed'; end if;

  -- 1. Dating off, Messages on, Video calls on: messages and calls allowed (legacy flag stays on)
  update profiles set notification_mutes = '{dating}' where id = a;
  if public._push_muted(a, 'message') or public._push_muted(a, 'video_call') then raise exception '1 dating muted chats/calls'; end if;
  if not public._push_muted(a, 'new_match') then raise exception '1 dating did not mute new_match'; end if;
  if not (select notify_dating from profiles where id = a) then raise exception '1 notify_dating off'; end if;
  -- 9. the older flag cannot block a call left on: both callers reach the outbox through the real sender
  select count(*) into n from push_outbox where recipient_id = a and data->>'type' = 'video_call';
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  perform public.notify_video_call_started(m_friend, 'video');
  perform set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated')::text, true);
  perform public.notify_video_call_started(m_date, 'voice');
  if (select count(*) from push_outbox where recipient_id = a and data->>'type' = 'video_call') <> n + 2 then
    raise exception '1/4/5 calls with Dating off did not both queue'; end if;

  -- 2. Dating on, Messages off, Video calls on: calls allowed, messages suppressed
  update profiles set notification_mutes = '{messages}' where id = a;
  if public._push_muted(a, 'video_call') then raise exception '2 call muted'; end if;
  if not public._push_muted(a, 'message') then raise exception '2 message allowed'; end if;

  -- 3. Dating on, Messages on, Video calls off: messages allowed, calls suppressed, for BOTH kinds of match (4, 5)
  update profiles set notification_mutes = '{video_calls}' where id = a;
  if public._push_muted(a, 'message') or public._push_muted(a, 'new_match') then raise exception '3 other type muted'; end if;
  if not (select notify_dating from profiles where id = a) then raise exception '3 notify_dating off'; end if;
  select count(*) into n from push_outbox where recipient_id = a and data->>'type' = 'video_call';
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  perform public.notify_video_call_started(m_friend, 'video');
  perform set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated')::text, true);
  perform public.notify_video_call_started(m_date, 'video');
  if (select count(*) from push_outbox where recipient_id = a and data->>'type' = 'video_call') <> n then
    raise exception '3/4/5 a call was queued with Video calls off'; end if;

  -- legacy flag off only when all three are off; then the unchanged sender still sends nothing
  update profiles set notification_mutes = '{dating,messages,video_calls}' where id = a;
  if (select notify_dating from profiles where id = a) then raise exception 'legacy flag on with all three off'; end if;
  update profiles set notification_mutes = '{dating,messages}' where id = a;
  if not (select notify_dating from profiles where id = a) then raise exception 'legacy flag off with Video calls on'; end if;

  -- 7. the one setter writes exactly the asked group, in canonical order
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  update profiles set notification_mutes = '{}' where id = a;
  if public.set_my_notification_group('video_calls', false) <> '{video_calls}' then raise exception '7 setter'; end if;
  if public.set_my_notification_group('dating', false) <> '{dating,video_calls}' then raise exception '7 order'; end if;
  if public.set_my_notification_group('video_calls', true) <> '{dating}' then raise exception '7 back on'; end if;

  -- 8. every type is mapped once; the three account notices are not mapped
  if (select count(*) from notification_type_groups) <> 85 then raise exception '8 seed count'; end if;
  if exists (select 1 from notification_type_groups where type in ('business_partner_approved', 'business_partner_denied', 'business_partner_needs_info')) then raise exception '8 account notice mapped'; end if;
  if (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname in
      ('set_my_notification_group', '_canonical_notification_mutes', '_derive_legacy_notify_columns', 'notify_video_call_started')) <> 4 then
    raise exception 'overloads'; end if;

  begin
    update profiles set notification_mutes = '{nonsense}' where id = a;
    raise exception 'CHECK accepted an unknown group';
  exception when check_violation then null;
  end;
  raise notice 'ok';
end $$;
select 'ALL OK' as result;

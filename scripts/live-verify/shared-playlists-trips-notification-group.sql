-- Shared playlists and trips split from Dating (20270262). Runs against prod inside a transaction that always rolls back.
-- Usage: prepend `begin;` + (when the migration is not yet applied) the migration file, append `rollback;`.
-- Pushes go through the REAL, unchanged senders: the triggers on shared_playlist_items and trip_ideas, fired by inserting
-- a song / a trip idea from a friend match and from a dating match.
do $$
declare
  a uuid; b uuid; c uuid; f uuid; m_friend uuid; m_date uuid; n int; v text[];
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

  -- 0. mapping: exactly the two types moved, each mapped once; the romantic-only "add together" types stay in Dating
  if (select group_key from notification_type_groups where type = 'playlist_addition') <> 'shared_playlists_trips' then raise exception '0 playlist seed'; end if;
  if (select group_key from notification_type_groups where type = 'trip_idea_addition') <> 'shared_playlists_trips' then raise exception '0 trip seed'; end if;
  if (select count(*) from notification_type_groups where group_key = 'shared_playlists_trips') <> 2 then raise exception '0 group holds other types'; end if;
  if exists (select 1 from notification_type_groups where group_key <> 'dating' and type in
      ('shared_decision_addition', 'constitution_addition', 'memory_addition', 'stress_test_addition', 'timeline_addition', 'new_match', 'wave'))
    then raise exception '0 a romantic-only type moved'; end if;
  if (select group_key from notification_type_groups where type = 'message') <> 'messages'
     or (select group_key from notification_type_groups where type = 'video_call') <> 'video_calls' then raise exception '0 messages/calls moved'; end if;

  -- 1. Dating off, Shared playlists & trips on: both pushes still queue, from a friend match AND a dating match,
  --    through the real senders (whose older notify_dating check stays true because this group is on)
  update profiles set notification_mutes = '{dating}' where id = a;
  if not (select notify_dating from profiles where id = a) then raise exception '1 notify_dating off'; end if;
  if not public._push_muted(a, 'new_match') then raise exception '1 dating did not mute new_match'; end if;
  select count(*) into n from push_outbox where recipient_id = a and data->>'type' in ('playlist_addition', 'trip_idea_addition');
  insert into shared_playlist_items (match_id, added_by, song_title) values (m_friend, b, 'Test song');
  insert into trip_ideas (match_id, added_by, category, idea_text) values (m_friend, b, 'activity', 'Test idea');
  insert into shared_playlist_items (match_id, added_by, song_title) values (m_date, c, 'Test song 2');
  insert into trip_ideas (match_id, added_by, category, idea_text) values (m_date, c, 'activity', 'Test idea 2');
  if (select count(*) from push_outbox where recipient_id = a and data->>'type' in ('playlist_addition', 'trip_idea_addition')) <> n + 4 then
    raise exception '1 with Dating off, playlist/trip pushes did not all queue'; end if;
  -- 9. even with Dating, Messages AND Video calls all off, the legacy flag stays on while this switch is on
  update profiles set notification_mutes = '{dating,messages,video_calls}' where id = a;
  if not (select notify_dating from profiles where id = a) then raise exception '9 legacy flag off with Shared playlists & trips on'; end if;
  select count(*) into n from push_outbox where recipient_id = a and data->>'type' in ('playlist_addition', 'trip_idea_addition');
  insert into shared_playlist_items (match_id, added_by, song_title) values (m_friend, b, 'Test song 3');
  insert into trip_ideas (match_id, added_by, category, idea_text) values (m_date, c, 'activity', 'Test idea 3');
  if (select count(*) from push_outbox where recipient_id = a and data->>'type' in ('playlist_addition', 'trip_idea_addition')) <> n + 2 then
    raise exception '9 the older Dating flag blocked a push left on'; end if;

  -- 2. Shared playlists & trips off: both suppressed, for both kinds of match; Dating, Messages, Video calls unaffected
  update profiles set notification_mutes = '{shared_playlists_trips}' where id = a;
  if public._push_muted(a, 'new_match') or public._push_muted(a, 'message') or public._push_muted(a, 'video_call') then raise exception '2 other type muted'; end if;
  if not (select notify_dating from profiles where id = a) then raise exception '2 notify_dating off'; end if;
  select count(*) into n from push_outbox where recipient_id = a and data->>'type' in ('playlist_addition', 'trip_idea_addition');
  insert into shared_playlist_items (match_id, added_by, song_title) values (m_friend, b, 'Test song 4');
  insert into trip_ideas (match_id, added_by, category, idea_text) values (m_friend, b, 'activity', 'Test idea 4');
  insert into shared_playlist_items (match_id, added_by, song_title) values (m_date, c, 'Test song 5');
  insert into trip_ideas (match_id, added_by, category, idea_text) values (m_date, c, 'activity', 'Test idea 5');
  if (select count(*) from push_outbox where recipient_id = a and data->>'type' in ('playlist_addition', 'trip_idea_addition')) <> n then
    raise exception '2 a playlist/trip push queued with its switch off'; end if;

  -- 3. Messages and Video calls stay independently configurable
  update profiles set notification_mutes = '{messages}' where id = a;
  if not public._push_muted(a, 'message') or public._push_muted(a, 'video_call') or public._push_muted(a, 'playlist_addition') then raise exception '3 messages'; end if;
  update profiles set notification_mutes = '{video_calls}' where id = a;
  if public._push_muted(a, 'message') or not public._push_muted(a, 'video_call') or public._push_muted(a, 'trip_idea_addition') then raise exception '3 calls'; end if;

  -- 4. legacy flag off only when all four are off
  update profiles set notification_mutes = '{dating,messages,video_calls,shared_playlists_trips}' where id = a;
  if (select notify_dating from profiles where id = a) then raise exception '4 legacy flag on with all four off'; end if;

  -- 5. opt-out conversion (the migration's own statement, on a fixture): Dating off gains this switch off, nothing removed
  update profiles set notification_mutes = '{dating,messages}' where id = a;
  update profiles set notification_mutes = public._canonical_notification_mutes(notification_mutes || array['shared_playlists_trips'])
   where id = a and 'dating' = any (notification_mutes);
  if (select notification_mutes from profiles where id = a) <> '{dating,messages,shared_playlists_trips}' then raise exception '5 opt-out conversion'; end if;
  update profiles set notification_mutes = '{video_calls}' where id = b;
  update profiles set notification_mutes = public._canonical_notification_mutes(notification_mutes || array['shared_playlists_trips'])
   where id = b and 'dating' = any (notification_mutes);
  if (select notification_mutes from profiles where id = b) <> '{video_calls}' then raise exception '5 a non-opt-out changed'; end if;

  -- 7. the one setter writes exactly the asked group, in canonical order
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  update profiles set notification_mutes = '{}' where id = a;
  if public.set_my_notification_group('shared_playlists_trips', false) <> '{shared_playlists_trips}' then raise exception '7 setter'; end if;
  v := public.set_my_notification_group('dating', false);
  if v <> '{dating,shared_playlists_trips}' then raise exception '7 order %', v; end if;
  if public.set_my_notification_group('shared_playlists_trips', true) <> '{dating}' then raise exception '7 back on'; end if;

  -- 8. every type mapped once; single overloads; senders unchanged and still reading only notify_dating
  if (select count(*) from notification_type_groups) <> 85 then raise exception '8 seed count'; end if;
  if (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname in
      ('set_my_notification_group', '_canonical_notification_mutes', '_derive_legacy_notify_columns', 'notify_playlist_addition', 'notify_trip_idea_addition')) <> 5 then
    raise exception '8 overloads'; end if;
  begin
    update profiles set notification_mutes = '{nonsense}' where id = a;
    raise exception 'CHECK accepted an unknown group';
  exception when check_violation then null;
  end;
  raise notice 'ok';
end $$;
select 'ALL OK' as result;

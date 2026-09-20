-- Item 77 follow-ups. Rolled back: free-tonight is mutual-only and consent-gated; match distance only for a match.
begin;
do $$
declare a uuid; b uuid; c uuid; r int; ids uuid[]; ok boolean;
begin
  select id into a from profiles order by created_at limit 1;
  select id into b from profiles where id <> a order by created_at limit 1;
  select id into c from profiles where id not in (a, b) order by created_at limit 1;

  -- a has NOT opted in: sees nothing even if b has
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role','authenticated')::text, true);
  perform public.set_free_tonight(now() + interval '5 hours');
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role','authenticated')::text, true);
  select array_agg(user_id) into ids from public.get_mutual_free_tonight(array[b, c]);
  assert ids is null, 'caller not opted in gets nothing';
  assert public.get_my_free_tonight() is null, 'not set';

  -- both opted in: b visible, c (not opted in) not
  perform public.set_free_tonight(now() + interval '20 hours');
  assert public.get_my_free_tonight() <= now() + interval '14 hours 1 minute', 'clamped to 14h';
  select array_agg(user_id) into ids from public.get_mutual_free_tonight(array[b, c, a]);
  assert ids = array[b], 'only the opted-in other, never self or non-opted';

  -- past time refused; clearing works
  begin perform public.set_free_tonight(now() - interval '1 hour'); ok := false; exception when others then ok := true; end;
  assert ok, 'past refused';
  perform public.set_free_tonight(null);
  select array_agg(user_id) into ids from public.get_mutual_free_tonight(array[b]);
  assert ids is null, 'cleared = nothing';

  -- direct table read is closed
  begin
    set local role authenticated;
    perform 1 from free_tonight; ok := false;
  exception when insufficient_privilege then ok := true; end;
  reset role;
  assert ok, 'table not readable by clients';

  -- match distance: only for a match participant, only with both areas
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role','authenticated')::text, true);
  declare m uuid; begin
    insert into matches (user_a, user_b) values (a, b) returning id into m;
    insert into notification_areas (user_id, area) values (a, '40.00,-75.00') on conflict (user_id) do update set area = '40.00,-75.00', updated_at = now();
    assert public.get_match_distance(m) is null, 'other has no area = unknown, not 0';
    insert into notification_areas (user_id, area) values (b, '40.00,-75.05') on conflict (user_id) do update set area = '40.00,-75.05', updated_at = now();
    r := public.get_match_distance(m);
    assert r between 2 and 4, 'about 2.6 mi apart, whole miles: ' || r;
    update notification_areas set area = '40.00,-75.00' where user_id = b;
    assert public.get_match_distance(m) = 0, 'same cell = within about a mile';
    -- a non-participant gets nothing
    perform set_config('request.jwt.claims', json_build_object('sub', c, 'role','authenticated')::text, true);
    assert public.get_match_distance(m) is null, 'stranger to the match gets null';
    -- no match, no distance
    perform set_config('request.jwt.claims', json_build_object('sub', a, 'role','authenticated')::text, true);
    assert public.get_match_distance(gen_random_uuid()) is null, 'unknown match null';
  end;
  raise notice 'ALL OK';
end $$;
rollback;

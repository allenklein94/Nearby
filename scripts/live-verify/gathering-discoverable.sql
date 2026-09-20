-- Item 74. Rolled back: a Link-only gathering (discoverable=false) is absent from the server discovery paths but
-- still reachable and joinable under every existing join rule (approval, capacity, blocks).
begin;
do $$
declare
  h uuid; a uuid; f uuid; b uuid; g1 uuid; g2 uuid; g3 uuid; r jsonb; ok boolean; ids uuid[];
begin
  select id into h from profiles order by created_at limit 1;
  select id into a from profiles where id <> h order by created_at limit 1;
  select id into f from profiles where id not in (h, a) order by created_at limit 1;
  select id into b from profiles where id not in (h, a, f) order by created_at limit 1;
  insert into gatherings (host_id, title, area, wide_area, interest_tag, scheduled_at, visibility, is_public, discoverable)
  values (h, 'listed', 'x', 'zz', 'Coffee', now() + interval '2 days', 'everyone', true, true) returning id into g1;
  insert into gatherings (host_id, title, area, wide_area, interest_tag, scheduled_at, visibility, is_public, discoverable)
  values (h, 'link only', 'x', 'zz', 'Coffee', now() + interval '2 days', 'everyone', true, false) returning id into g2;
  -- default keeps existing behavior
  assert (select discoverable from gatherings where id = g1), 'default/explicit true';
  -- DB CHECK: friends visibility cannot be link-only
  begin update gatherings set visibility = 'friends' where id = g2; ok := false; exception when check_violation then ok := true; end;
  assert ok, 'link-only requires Everyone visibility';

  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role','authenticated')::text, true);
  select array_agg(id) into ids from public.get_bounded_nearby_gathering_ids(0, 0, 100, 500);
  assert g1 = any(ids), 'discoverable listed in nearby ids';
  assert not (g2 = any(ids)), 'link-only absent from nearby ids';

  insert into gathering_interest (gathering_id, user_id, status) values (g1, f, 'approved'), (g2, f, 'approved');
  select array_agg(id) into ids from public.get_trending_gathering_ids('zz');
  assert g1 = any(ids), 'discoverable can trend';
  assert not (g2 = any(ids)), 'link-only never trends';

  assert pg_get_functiondef('public.notify_matching_things_to_do()'::regprocedure) like '%discoverable%', 'new-gathering push skips link-only';
  assert pg_get_functiondef('public.notify_gathering_interest_threshold()'::regprocedure) like '%discoverable%', 'threshold push skips link-only';
  assert (select prosrc from pg_proc where proname = 'get_partner_demand_signals') like '%g.discoverable = true%', 'demand aggregate skips link-only';

  -- reachable by link (direct read) and joinable
  assert exists (select 1 from gatherings where id = g2), 'link-only readable by id';
  r := public.join_gathering(g2);
  assert (select status from gathering_interest where gathering_id = g2 and user_id = a) = 'approved', 'joins by link';

  -- approval still applies
  update gatherings set requires_approval = true where id = g2;
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role','authenticated')::text, true);
  r := public.join_gathering(g2);
  assert (select status from gathering_interest where gathering_id = g2 and user_id = b) = 'pending', 'approval still required';
  delete from gathering_interest where gathering_id = g2 and user_id = b;

  -- capacity still applies
  update gatherings set requires_approval = false, capacity = 1 where id = g2;
  delete from gathering_interest where gathering_id = g2 and user_id = f;
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role','authenticated')::text, true);
  r := public.join_gathering(g2);
  assert (select status from gathering_interest where gathering_id = g2 and user_id = b) = 'waitlisted', 'capacity still waitlists';
  delete from gathering_interest where gathering_id = g2 and user_id = b;

  -- blocks still apply
  insert into blocks (blocker_id, blocked_id) values (h, b);
  begin perform public.join_gathering(g2); ok := false; exception when others then ok := true; end;
  assert ok, 'blocked user still refused';
  raise notice 'gathering-discoverable ok';
end $$;
rollback;

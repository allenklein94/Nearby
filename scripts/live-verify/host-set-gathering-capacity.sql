-- Item 71. Rolled back: raising capacity seats the waitlist in order; lowering below attendance is refused;
-- removing the limit seats everyone; non-host refused; past gathering refused.
begin;
do $$
declare
  h uuid; a uuid; b uuid; c uuid; g uuid; r jsonb; ok boolean;
begin
  select id into h from profiles order by created_at limit 1;
  select id into a from profiles where id <> h order by created_at limit 1;
  select id into b from profiles where id not in (h, a) order by created_at limit 1;
  select id into c from profiles where id not in (h, a, b) order by created_at limit 1;
  insert into gatherings (host_id, title, area, interest_tag, scheduled_at, visibility, capacity, is_public)
  values (h, 'cap test', 'x', 'Coffee', now() + interval '3 days', 'everyone', 1, true) returning id into g;
  insert into gathering_interest (gathering_id, user_id, status, created_at) values
    (g, a, 'approved', now() - interval '3 hours'),
    (g, b, 'waitlisted', now() - interval '2 hours'), (g, c, 'waitlisted', now() - interval '1 hour');
  -- non-host refused
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role','authenticated')::text, true);
  begin perform public.set_gathering_capacity(g, 5); ok := false; exception when others then ok := sqlerrm like '%Only the host%'; end;
  assert ok, 'non-host refused';
  perform set_config('request.jwt.claims', json_build_object('sub', h, 'role','authenticated')::text, true);
  begin perform public.set_gathering_capacity(g, 0); ok := false; exception when others then ok := true; end;
  assert ok, 'zero refused';
  -- raise by one: earliest waitlisted (b) is seated, c stays waiting
  r := public.set_gathering_capacity(g, 2);
  assert (r->>'promoted')::int = 1, 'one seat opened, one promoted: ' || r::text;
  assert (select status from gathering_interest where gathering_id = g and user_id = b) = 'approved';
  assert (select status from gathering_interest where gathering_id = g and user_id = c) = 'waitlisted';
  -- lower below the 2 attending refused (raises with the count)
  begin perform public.set_gathering_capacity(g, 1); ok := false; exception when others then ok := sqlerrm like '%already attending%'; end;
  assert ok, 'lowering below attendance refused';
  -- remove the limit: everyone waiting is seated and capacity is null
  r := public.set_gathering_capacity(g, null);
  assert (select status from gathering_interest where gathering_id = g and user_id = c) = 'approved';
  assert (select capacity from gatherings where id = g) is null;
  -- past gathering refused
  update gatherings set scheduled_at = now() - interval '1 hour' where id = g;
  begin perform public.set_gathering_capacity(g, 10); ok := false; exception when others then ok := sqlerrm like '%already happened%'; end;
  assert ok, 'past refused';
  raise notice 'host-set-gathering-capacity ok';
end $$;
rollback;

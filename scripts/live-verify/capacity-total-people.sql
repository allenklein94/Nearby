-- Capacity = total people including the host (migration 20270209). Rolled back. Four real profiles play host + three guests.
begin;
do $$
declare
  u uuid[]; g uuid; r jsonb; s text; n int; ok boolean;
  procedure_as text;
begin
  select array_agg(id) into u from (select id from profiles order by created_at limit 4) x;
  if array_length(u, 1) < 4 then raise exception 'FAIL: need 4 profiles'; end if;
  delete from blocks where blocker_id = any(u) and blocked_id = any(u);

  -- helper: capacity -> guest limit
  if public._gathering_guest_limit(1) <> 0 or public._gathering_guest_limit(2) <> 1 or public._gathering_guest_limit(4) <> 3
     or public._gathering_guest_limit(null) is not null then raise exception 'FAIL: guest limit'; end if;

  -- capacity 1 = the host alone: the first guest is waitlisted
  insert into gatherings (host_id, title, scheduled_at, precise_lat, precise_lng, interest_tag, area, capacity, visibility, is_public)
    values (u[1], 'cap1', now() + interval '2 days', 40, -75, 'Coffee', 'verify', 1, 'everyone', true) returning id into g;
  perform set_config('request.jwt.claims', json_build_object('sub', u[2], 'role', 'authenticated')::text, true);
  perform join_gathering(g);
  select status into s from gathering_interest where gathering_id = g and user_id = u[2];
  if s <> 'waitlisted' then raise exception 'FAIL: capacity 1 let a guest in (%)', s; end if;

  -- capacity 2 = host + 1 guest: second guest waitlisted
  insert into gatherings (host_id, title, scheduled_at, precise_lat, precise_lng, interest_tag, area, capacity, visibility, is_public)
    values (u[1], 'cap2', now() + interval '2 days', 40, -75, 'Coffee', 'verify', 2, 'everyone', true) returning id into g;
  perform set_config('request.jwt.claims', json_build_object('sub', u[2], 'role', 'authenticated')::text, true); perform join_gathering(g);
  perform set_config('request.jwt.claims', json_build_object('sub', u[3], 'role', 'authenticated')::text, true); perform join_gathering(g);
  select count(*) filter (where status = 'approved') into n from gathering_interest where gathering_id = g;
  select status into s from gathering_interest where gathering_id = g and user_id = u[3];
  if n <> 1 or s <> 'waitlisted' then raise exception 'FAIL: capacity 2 (approved %, third %)', n, s; end if;
  if public._gathering_party_size(g) <> 2 then raise exception 'FAIL: party size for capacity 2 = %', public._gathering_party_size(g); end if;

  -- host cannot set capacity below the people already going (1 guest + host = 2)
  perform set_config('request.jwt.claims', json_build_object('sub', u[1], 'role', 'authenticated')::text, true);
  ok := false; begin perform set_gathering_capacity(g, 1); exception when others then ok := sqlerrm like '2 people are already going%'; end;
  if not ok then raise exception 'FAIL: capacity below host+guests accepted'; end if;
  -- raising to 3 seats the waitlisted guest (host + 2 guests)
  r := set_gathering_capacity(g, 3);
  select status into s from gathering_interest where gathering_id = g and user_id = u[3];
  if (r->>'promoted')::int <> 1 or s <> 'approved' then raise exception 'FAIL: raise to 3 (%, %)', r, s; end if;

  -- capacity 4 = host + 3 guests; party size 4 with only the host; never capacity + 1
  insert into gatherings (host_id, title, scheduled_at, precise_lat, precise_lng, interest_tag, area, capacity, visibility, is_public)
    values (u[1], 'cap4', now() + interval '2 days', 40, -75, 'Coffee', 'verify', 4, 'everyone', true) returning id into g;
  if public._gathering_party_size(g) <> 4 then raise exception 'FAIL: party size for capacity 4 = %', public._gathering_party_size(g); end if;
  for i in 2..4 loop
    perform set_config('request.jwt.claims', json_build_object('sub', u[i], 'role', 'authenticated')::text, true); perform join_gathering(g);
  end loop;
  select count(*) filter (where status = 'approved') into n from gathering_interest where gathering_id = g;
  if n <> 3 then raise exception 'FAIL: capacity 4 approved % guests', n; end if;
  if public._gathering_party_size(g) <> 4 then raise exception 'FAIL: full capacity-4 party size = %', public._gathering_party_size(g); end if;
  -- the host is never a row (no path adds them twice)
  if exists (select 1 from gathering_interest gi join gatherings x on x.id = gi.gathering_id where gi.user_id = x.host_id) then
    raise exception 'FAIL: a host has an attendee row'; end if;

  -- approval path: capacity 2, require approval, the host approves one; approving a second waitlists them
  insert into gatherings (host_id, title, scheduled_at, precise_lat, precise_lng, interest_tag, area, capacity, visibility, is_public, requires_approval)
    values (u[1], 'cap2a', now() + interval '2 days', 40, -75, 'Coffee', 'verify', 2, 'everyone', true, true) returning id into g;
  perform set_config('request.jwt.claims', json_build_object('sub', u[2], 'role', 'authenticated')::text, true); perform join_gathering(g);
  perform set_config('request.jwt.claims', json_build_object('sub', u[3], 'role', 'authenticated')::text, true); perform join_gathering(g);
  perform set_config('request.jwt.claims', json_build_object('sub', u[1], 'role', 'authenticated')::text, true);
  perform approve_gathering_interest((select id from gathering_interest where gathering_id = g and user_id = u[2]));
  r := approve_gathering_interest((select id from gathering_interest where gathering_id = g and user_id = u[3]));
  if r->>'status' <> 'waitlisted' then raise exception 'FAIL: approval over capacity 2 gave %', r; end if;

  -- the helper is internal
  if has_function_privilege('authenticated', 'public._gathering_guest_limit(integer)', 'execute') then raise exception 'FAIL: helper executable'; end if;
end $$;
select 'ok' as result;
rollback;

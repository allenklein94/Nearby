-- Verifies migration 20270220 (item 85). Rolled back; the result is reported through the exception text.
--  * a matched pair's date request stores the qualities it picked (romantic, quiet, cozy), party size 2, no category needed
--  * an unknown quality is refused; a stranger to the match is refused; one overload; anon cannot execute
begin;
do $v$
declare out text := ''; a uuid; b uuid; c uuid; m uuid; res jsonb; req record;
begin
  select id into a from profiles order by id limit 1;
  select id into b from profiles where id <> a order by id limit 1;
  select id into c from profiles where id not in (a, b) order by id limit 1;
  update brand_partners set active = false;  -- keep the fan-out quiet
  insert into matches (user_a, user_b) values (a, b) returning id into m;
  insert into date_proposals (match_id, proposed_by, plan_text, status, responded_at) values (m, a, 'live-verify: a quiet date', 'accepted', now());
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  res := create_business_request_for_match(m, 'live-verify: somewhere romantic and quiet', 33.0, -117.0, null, null, null, null, null, 15, 'date_night', null, array['romantic','quiet','cozy','quiet']);
  select attributes, party_size, category into req from business_requests where id = (res->>'requestId')::uuid;
  out := out || 'stored: ' || array_to_string(array(select unnest(req.attributes) order by 1), ',') || ' party ' || req.party_size || ' category ' || coalesce(req.category, 'none') || E'\n';
  delete from business_requests where match_id = m;
  begin perform create_business_request_for_match(m, 'live-verify: moody place', 33.0, -117.0, null, null, null, null, null, 15, null, null, array['moody']);
    out := out || 'unknown quality: NOT REFUSED' || E'\n';
  exception when check_violation then out := out || 'unknown quality refused: ok' || E'\n'; end;
  perform set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated')::text, true);
  begin perform create_business_request_for_match(m, 'live-verify: x', 33.0, -117.0);
    out := out || 'stranger: NOT REFUSED' || E'\n';
  exception when others then out := out || 'stranger refused: ok' || E'\n'; end;
  out := out || 'overloads: ' || (select count(*) from pg_proc where proname = 'create_business_request_for_match') || E'\n';
  out := out || 'anon execute: ' || has_function_privilege('anon', 'public.create_business_request_for_match(uuid, text, double precision, double precision, text, integer, date, time, time, double precision, text, text[], text[])', 'execute')::text || E'\n';
  raise exception '%', out;
end $v$;
rollback;

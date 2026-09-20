-- Rolled back. Gathering join request approval refused when past; occasion group-plan invite
-- (member) accept refused / dismiss -> 'expired' when the plan date has passed; future + no-date still work.
begin;
do $$
declare out text := ''; host uuid; u2 uuid; g_past uuid; g_future uuid; gi1 uuid; gi2 uuid;
  p_past uuid; p_future uuid; p_nodate uuid; msg text; st text; ids uuid[]; r jsonb;
begin
  select array_agg(id) into ids from (select id from profiles order by created_at limit 2) s;
  -- gathering join requests: use any gathering's real host; u2 = a different profile
  select id, host_id into g_past, host from gatherings limit 1;
  if g_past is null then raise exception 'need a gathering'; end if;
  select id into u2 from profiles where id <> host limit 1;
  if u2 is null then raise exception 'need 2 profiles'; end if;
  update gatherings set scheduled_at = now() - interval '1 day' where id = g_past;
  insert into gathering_interest (gathering_id, user_id, status) values (g_past, u2, 'pending') returning id into gi1;
  perform set_config('request.jwt.claims', json_build_object('sub', host, 'role', 'authenticated')::text, true);
  begin perform approve_gathering_interest(gi1); msg := 'NO ERROR'; exception when others then msg := sqlerrm; end;
  out := out || 'approve past request -> ' || msg || E'\n';
  update gatherings set scheduled_at = now() + interval '2 days' where id = g_past;
  r := approve_gathering_interest(gi1);
  out := out || 'approve future request -> ' || (r->>'status') || E'\n';
  -- occasion group plans
  insert into occasion_group_plans (host_id, occasion_type, title, when_preset, scheduled_date)
    values (host, 'birthday', 'past', 'custom', current_date - 3) returning id into p_past;
  insert into occasion_group_plans (host_id, occasion_type, title, when_preset, scheduled_date)
    values (host, 'birthday', 'future', 'custom', current_date + 3) returning id into p_future;
  insert into occasion_group_plans (host_id, occasion_type, title, when_preset, scheduled_date)
    values (host, 'birthday', 'nodate', 'custom', null) returning id into p_nodate;
  insert into occasion_group_plan_participants (group_plan_id, user_id, status) values (p_past, u2, 'invited'), (p_future, u2, 'invited'), (p_nodate, u2, 'invited');
  perform set_config('request.jwt.claims', json_build_object('sub', u2, 'role', 'authenticated')::text, true);
  begin perform respond_to_occasion_group_plan(p_past, true); msg := 'NO ERROR'; exception when others then msg := sqlerrm; end;
  out := out || 'accept past plan -> ' || msg || E'\n';
  perform respond_to_occasion_group_plan(p_past, false);
  select status into st from occasion_group_plan_participants where group_plan_id = p_past and user_id = u2;
  out := out || 'dismiss past plan -> ' || st || E'\n';
  perform respond_to_occasion_group_plan(p_future, true);
  select status into st from occasion_group_plan_participants where group_plan_id = p_future and user_id = u2;
  out := out || 'accept future plan -> ' || st || E'\n';
  perform respond_to_occasion_group_plan(p_nodate, true);
  select status into st from occasion_group_plan_participants where group_plan_id = p_nodate and user_id = u2;
  out := out || 'accept no-date plan -> ' || st || E'\n';
  raise exception 'ROLLBACK_OK %', out;
end $$;
rollback;

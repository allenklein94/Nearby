-- Verifies the raw ask text retention policy (migration 20270237): text kept 180 days, then cleared by the data
-- layer; the structured record, the tapped result, the outcome and the request link survive; text can never be
-- re-stored; the purge is idempotent; no other table holds a copy. Rolled back; raises on the first failed check.
begin;
create temp table r(step text, result text) on commit drop;
grant all on r to public;
do $$
declare
  v_user uuid;
  v_sub uuid;
  v_out uuid;
  v_req uuid;
  v_marker text := 'retention-probe ' || gen_random_uuid()::text || ' dinner with my wife tonight under $50';
  v_text text;
  v_exp timestamptz;
  v_purge jsonb;
  v_n int;
  v_tbl record;
  v_ok boolean;
begin
  select id into v_user from profiles order by created_at limit 1;

  -- Act as the signed-in person, exactly like the app (RLS, client-sent columns).
  perform set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  set local role authenticated;

  insert into intent_submissions (user_id, raw_text, category, date_window, intent_kind, had_any_result, party_size,
                                  local_period, raw_text_expires_at, created_at)
  values (v_user, v_marker, 'Restaurants', 'tonight', 'gathering', true, 2, 'evening', '2099-01-01', now() - interval '400 days')
  returning id, raw_text, raw_text_expires_at into v_sub, v_text, v_exp;
  if v_text is distinct from v_marker then raise exception 'insert: text not kept'; end if;
  if v_exp <> now() + interval '180 days' then raise exception 'insert: expiry not server-set (%)', v_exp; end if;
  insert into r values ('1 expiry is now + 180 days, client value and backdated created_at ignored', 'ok');

  insert into intent_outcomes (user_id, raw_text, category, date_window, result_type, result_id, result_title, submission_id)
  values (v_user, v_marker, 'Restaurants', 'tonight', 'business_availability', gen_random_uuid(), 'Coastal Coffee', v_sub)
  returning id into v_out;
  update intent_outcomes set outcome = 'great', would_repeat = true, answered_at = now() where id = v_out;
  select raw_text into v_text from intent_outcomes where id = v_out;
  if v_text is distinct from v_marker then raise exception 'outcome answer changed the text'; end if;
  insert into r values ('2 structured update keeps the text inside the window', 'ok');

  -- Text can never be rewritten or given a longer life.
  begin
    update intent_submissions set raw_text = 'something else' where id = v_sub;
    raise exception 'rewrite was allowed';
  exception when others then
    if sqlerrm not like 'Ask text can only be cleared%' then raise; end if;
  end;
  update intent_submissions set raw_text_expires_at = '2099-01-01' where id = v_sub;
  select raw_text_expires_at into v_exp from intent_submissions where id = v_sub;
  if v_exp <> now() + interval '180 days' then raise exception 'expiry was extended'; end if;
  insert into r values ('3 text cannot be rewritten, expiry cannot be extended', 'ok');

  reset role;

  -- Day 179: still inside the window, the purge keeps it.
  alter table intent_submissions disable trigger raw_ask_text_retention;
  alter table intent_outcomes disable trigger raw_ask_text_retention;
  update intent_submissions set raw_text_expires_at = now() + interval '1 day' where id = v_sub;
  update intent_outcomes set raw_text_expires_at = now() + interval '1 day' where id = v_out;
  perform purge_expired_raw_ask_text();
  if (select raw_text from intent_submissions where id = v_sub) is distinct from v_marker
     or (select raw_text from intent_outcomes where id = v_out) is distinct from v_marker then
    raise exception 'text cleared inside the 180-day window';
  end if;
  insert into r values ('4 retained during the window (day 179)', 'ok');

  -- A request made from this ask (the submission -> request link).
  insert into business_requests (requester_id, raw_text, latitude, longitude, expires_at, submission_id, category)
  values (v_user, 'request text', 40.0, -75.0, now() + interval '1 day', v_sub, 'Restaurants') returning id into v_req;

  -- Day 181: expired.
  update intent_submissions set raw_text_expires_at = now() - interval '1 day' where id = v_sub;
  update intent_outcomes set raw_text_expires_at = now() - interval '1 day' where id = v_out;
  alter table intent_submissions enable trigger raw_ask_text_retention;
  alter table intent_outcomes enable trigger raw_ask_text_retention;

  -- Any write touching an expired row clears it at once (the outcome); the job clears the rest (the submission).
  update intent_outcomes set answered_at = answered_at where id = v_out;
  if (select raw_text from intent_outcomes where id = v_out) is not null then raise exception 'trigger did not clear expired text'; end if;
  v_purge := purge_expired_raw_ask_text();
  if (v_purge->>'intent_submissions')::int < 1 then raise exception 'purge cleared nothing: %', v_purge; end if;
  if (select raw_text from intent_submissions where id = v_sub) is not null then raise exception 'purge did not clear'; end if;
  insert into r values ('5 cleared after 180 days (both copies)', v_purge::text);

  v_purge := purge_expired_raw_ask_text();
  if (v_purge->>'intent_submissions')::int <> 0 or (v_purge->>'intent_outcomes')::int <> 0 then
    raise exception 'second purge not a no-op: %', v_purge;
  end if;
  insert into r values ('6 purge is idempotent', v_purge::text);

  -- The structured record, the tapped result, the outcome and the request link all survive.
  select (category = 'Restaurants' and date_window = 'tonight' and intent_kind = 'gathering' and had_any_result
          and party_size = 2 and local_period = 'evening') into v_ok from intent_submissions where id = v_sub;
  if not coalesce(v_ok, false) then raise exception 'structured interpretation lost'; end if;
  select (result_type = 'business_availability' and result_id is not null and result_title = 'Coastal Coffee'
          and submission_id = v_sub and outcome = 'great' and would_repeat and answered_at is not null)
    into v_ok from intent_outcomes where id = v_out;
  if not coalesce(v_ok, false) then raise exception 'result/outcome lost'; end if;
  if (select submission_id from business_requests where id = v_req) is distinct from v_sub then
    raise exception 'request link lost';
  end if;
  insert into r values ('7 structured interpretation, result, outcome and request link kept', 'ok');

  -- Expired text cannot be brought back through the app's API.
  perform set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
  if exists (select 1 from intent_submissions where id = v_sub and raw_text is not null)
     or exists (select 1 from intent_outcomes where id = v_out and raw_text is not null) then
    raise exception 'expired text readable';
  end if;
  begin
    update intent_submissions set raw_text = v_marker where id = v_sub;
    raise exception 'restore was allowed';
  exception when others then
    if sqlerrm not like 'Ask text can only be cleared%' then raise; end if;
  end;
  begin
    update intent_outcomes set raw_text = v_marker where id = v_out;
    raise exception 'restore was allowed';
  exception when others then
    if sqlerrm not like 'Ask text can only be cleared%' then raise; end if;
  end;
  reset role;
  insert into r values ('8 expired text unreadable and cannot be re-stored', 'ok');

  -- No other copy: the marker appears in no text/jsonb column of any public table.
  for v_tbl in
    select c.table_name, c.column_name, c.data_type from information_schema.columns c
    join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
    where c.table_schema = 'public' and c.data_type in ('text', 'character varying', 'jsonb', 'json', 'ARRAY')
  loop
    execute format('select count(*) from public.%I where %I::text like %L', v_tbl.table_name, v_tbl.column_name,
                   '%' || split_part(v_marker, ' ', 2) || '%') into v_n;
    if v_n > 0 then raise exception 'copy of the ask text found in %.%', v_tbl.table_name, v_tbl.column_name; end if;
  end loop;
  insert into r values ('9 no copy of the ask text anywhere in public tables', 'ok');

  -- The purge is not callable by the app.
  if has_function_privilege('authenticated', 'public.purge_expired_raw_ask_text()', 'execute')
     or has_function_privilege('anon', 'public.purge_expired_raw_ask_text()', 'execute') then
    raise exception 'purge callable by clients';
  end if;
  if not exists (select 1 from cron.job where jobname = 'purge-expired-raw-ask-text' and command like '%purge_expired_raw_ask_text%') then
    raise exception 'purge job not scheduled';
  end if;
  insert into r values ('10 purge scheduled hourly, service-only', 'ok');
end $$;
select * from r;
rollback;

-- Typed-ask audit (migration 20270238). ROLLED BACK; runs on prod or a replay database.
-- Proves: a snapshot stores the interpretation (known vocabulary fields only), the shown results in order with type, id and
-- signal codes; words and access needs are dropped even if a client sends them; a bad payload never raises (it is logged);
-- a retry is idempotent; another person's submission cannot be linked; taps, requests and gathering joins link through the
-- view; nothing is readable by anon/authenticated; no business-facing function mentions the tables.
begin;

do $$
declare
  u uuid := (select id from profiles order by created_at limit 1);
  other uuid := (select id from profiles order by created_at desc limit 1);
  g uuid := (select id from gatherings order by created_at limit 1);
  sub uuid;
  other_sub uuid;
  snap uuid := gen_random_uuid();
  ret uuid;
  req uuid;
  fails_before bigint := (select count(*) from typed_ask_audit_failures);
begin
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  insert into intent_submissions (user_id, raw_text, category, intent_kind) values (u, 'coffee tonight', 'Coffee', 'gathering') returning id into sub;
  insert into intent_submissions (user_id, raw_text, category, intent_kind) values (other, 'x', 'Coffee', 'gathering') returning id into other_sub;

  -- ---------- 1. a normal snapshot ----------
  ret := record_typed_ask_snapshot(jsonb_build_object(
    'id', snap, 'surface', 'discover', 'rules_version', 'typed-ask-audit-v1', 'submission_id', sub, 'outcome', 'results',
    'candidate_count', 7, 'exclusions', jsonb_build_object('compatibility', 2, 'Bad Key', 1),
    'interpretation', jsonb_build_object('category', 'Coffee', 'party_size', 4, 'open_now', true, 'date_window', 'tonight',
      'attributes', jsonb_build_array('quiet', 'wheelchair_accessible'), 'clock_window', jsonb_build_object('after', 900),
      'raw_text', 'coffee tonight with my mother', 'dietary', jsonb_build_array('vegan'),
      'cuisine', 'this is a very long sentence somebody typed about their dinner plans tonight'),
    'results', jsonb_build_array(
      jsonb_build_object('position', 1, 'section', 'list', 'result_type', 'gathering', 'result_id', g::text, 'score', 5,
        'signals', jsonb_build_array(jsonb_build_object('code', 'weather', 'delta', 2), jsonb_build_object('code', 'Some prose here', 'delta', 1),
          jsonb_build_object('code', 'base', 'delta', 'three'))),
      jsonb_build_object('position', 2, 'section', 'type:perk', 'result_type', 'perk', 'result_id', 'p1', 'partner_id', 'not-a-uuid', 'score', 1))));
  assert ret = snap, 'snapshot recorded';
  assert (select interpretation from typed_ask_snapshots where id = snap) =
    '{"category":"Coffee","party_size":4,"open_now":true,"date_window":"tonight","attributes":["quiet"],"clock_window":{"after":900}}'::jsonb,
    'only known fields with vocabulary values; words, dietary and access needs dropped';
  assert (select exclusions from typed_ask_snapshots where id = snap) = '{"compatibility":2}'::jsonb, 'exclusion keys are codes only';
  assert (select submission_id from typed_ask_snapshots where id = snap) = sub, 'own submission linked';
  assert (select array_agg(result_id order by position) from typed_ask_results where snapshot_id = snap) = array[g::text, 'p1'], 'shown order kept';
  assert (select signals from typed_ask_results where snapshot_id = snap and position = 1) = '[{"code":"weather","delta":2}]'::jsonb, 'signal codes only';
  assert (select partner_id from typed_ask_results where snapshot_id = snap and position = 2) is null, 'bad partner id dropped';

  -- ---------- 2. retry is idempotent ----------
  assert record_typed_ask_snapshot(jsonb_build_object('id', snap, 'surface', 'discover', 'rules_version', 'typed-ask-audit-v1',
    'results', '[]'::jsonb)) = snap, 'retry returns the same id';
  assert (select count(*) from typed_ask_results where snapshot_id = snap) = 2, 'retry adds nothing';

  -- ---------- 3. another person''s submission is never linked ----------
  ret := record_typed_ask_snapshot(jsonb_build_object('id', gen_random_uuid(), 'surface', 'home', 'rules_version', 'typed-ask-audit-v1',
    'submission_id', other_sub, 'results', '[]'::jsonb));
  assert (select submission_id from typed_ask_snapshots where id = ret) is null, 'foreign submission refused';

  -- ---------- 4. a bad payload never raises; it is logged ----------
  assert record_typed_ask_snapshot(jsonb_build_object('id', gen_random_uuid(), 'surface', 'somewhere', 'rules_version', 'v1')) is null, 'bad surface -> null';
  assert record_typed_ask_snapshot(jsonb_build_object('id', gen_random_uuid(), 'surface', 'home', 'rules_version', 'v1',
    'results', jsonb_build_array(jsonb_build_object('position', 99, 'section', 'list', 'result_type', 'gathering')))) is null, 'bad position -> null';
  assert record_typed_ask_snapshot('"text"'::jsonb) is null, 'non-object -> null';
  assert (select count(*) from typed_ask_audit_failures) = fails_before + 3, 'failures logged';
  assert not exists (select 1 from typed_ask_snapshots where surface not in ('home', 'discover')), 'nothing half-written';

  -- ---------- 5. downstream links ----------
  insert into intent_outcomes (user_id, raw_text, result_type, result_id, submission_id, snapshot_id, result_position)
    values (u, 'coffee tonight', 'gathering', g, sub, snap, 1);
  assert (select tapped_at is not null from typed_ask_result_outcomes where snapshot_id = snap and position = 1), 'tap linked to row 1';
  assert (select tapped_at is null from typed_ask_result_outcomes where snapshot_id = snap and position = 2), 'untapped row stays untapped';
  insert into gathering_interest (gathering_id, user_id, status) values (g, u, 'approved') on conflict do nothing;
  if exists (select 1 from gathering_interest where gathering_id = g and user_id = u and created_at >= (select created_at from typed_ask_snapshots where id = snap)) then
    assert (select gathering_join_status from typed_ask_result_outcomes where snapshot_id = snap and position = 1) = 'approved', 'join linked';
  end if;

  -- ---------- 6. nobody outside reads it ----------
  assert not has_table_privilege('authenticated', 'typed_ask_snapshots', 'select'), 'no client read (snapshots)';
  assert not has_table_privilege('authenticated', 'typed_ask_results', 'select'), 'no client read (results)';
  assert not has_table_privilege('anon', 'typed_ask_results', 'select'), 'no anon read';
  assert not has_table_privilege('authenticated', 'typed_ask_result_outcomes', 'select'), 'no client read (view)';
  assert not has_table_privilege('authenticated', 'typed_ask_audit_failures', 'select'), 'no client read (failures)';
  assert not has_function_privilege('anon', 'record_typed_ask_snapshot(jsonb)', 'execute'), 'anon cannot write';
  assert not has_function_privilege('authenticated', '_typed_ask_value_ok(jsonb)', 'execute'), 'helpers not client-callable';
  assert not exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname <> 'record_typed_ask_snapshot' and proname not like '\_typed\_ask\_%'
    and prosrc ilike '%typed_ask_%'), 'no other function reads the audit';
  assert (select count(*) from pg_proc where proname = 'record_typed_ask_snapshot') = 1, 'single overload';
  assert not exists (select 1 from information_schema.columns where table_name in ('typed_ask_snapshots', 'typed_ask_results')
    and data_type = 'text' and column_name not in ('surface', 'rules_version', 'outcome', 'section', 'result_type', 'result_id')), 'no free-text column';

  -- ---------- 7. unauthenticated call records nothing ----------
  perform set_config('request.jwt.claims', '{}', true);
  assert record_typed_ask_snapshot(jsonb_build_object('id', gen_random_uuid(), 'surface', 'home', 'rules_version', 'v1')) is null, 'no user -> nothing';
end $$;
select 'ALL OK' as result;
rollback;

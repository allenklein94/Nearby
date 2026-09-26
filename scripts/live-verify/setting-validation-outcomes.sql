-- Verifies the item 86 validation OUTCOME contract (migrations 20270226 + 20270227). Rolled back; results via the exception text.
--   valid -> saves; conflict -> saves nothing + exact lines + hint; invalid -> saves nothing, plain validation error (no hint);
--   check-only -> never writes; multi-write (want more) -> zero partial writes; retry after resolving -> saves;
--   bundle parts: Family Fun only with Family Gathering (an integrity rule, not a No-children trigger);
--   a request addressed to ONE business is never removed by compatibility filtering.
begin;
do $$
declare out text := ''; base jsonb; b uuid; owner_id uuid; v_hint text; v_detail text; v_state text; got text[]; r record;
begin
  select to_jsonb(bp) into base from brand_partners bp limit 1;
  b := gen_random_uuid();
  insert into brand_partners select (jsonb_populate_record(null::brand_partners, base || jsonb_build_object('id', b, 'name', 'T-Outcome', 'active', false,
    'attributes', '[]'::jsonb, 'priority_attributes', '[]'::jsonb, 'priority_occasions', '[]'::jsonb, 'priority_time_windows', '[]'::jsonb,
    'priority_time_start', null, 'priority_time_end', null, 'offered_occasions', '[]'::jsonb, 'accommodates_party_types', '[]'::jsonb,
    'not_accommodated', '[]'::jsonb, 'weather_setting', null, 'suited_age_min', null, 'suited_age_max', null, 'outdoor_capacity', null,
    'address', '1 Test St', 'latitude', 40.0, 'longitude', -75.0))).*;
  select id into owner_id from profiles limit 1;
  perform set_config('app.trusted_update', 'true', true);
  update profiles set managed_partner_id = b where id = owner_id;
  perform set_config('request.jwt.claims', json_build_object('sub', owner_id, 'role', 'authenticated')::text, true);

  -- VALID -> save
  perform set_business_not_accommodated(b, array['no_children']);
  out := out || (case when (select not_accommodated from brand_partners where id = b) = array['no_children'] then 'ok   ' else 'FAIL ' end) || 'valid: No children saved' || E'\n';

  -- CONFLICT -> nothing saved, exact line, hint
  begin
    perform set_business_offered_occasions(b, array['birthday', 'family_gathering']);
    out := out || 'FAIL conflict: offered Group/Family with No children ALLOWED' || E'\n';
  exception when others then
    get stacked diagnostics v_hint = pg_exception_hint, v_detail = pg_exception_detail;
    out := out || (case when v_hint = 'setting_conflict' and v_detail::jsonb = '["No children conflicts with Group/Family. Remove one of these settings to continue."]'::jsonb
      then 'ok   ' else 'FAIL ' end) || 'conflict: exact line + hint -- ' || coalesce(v_detail, '') || E'\n';
  end;
  out := out || (case when (select offered_occasions from brand_partners where id = b) = '{}' then 'ok   ' else 'FAIL ' end) || 'conflict: nothing saved (birthday not saved either)' || E'\n';

  -- MULTI-WRITE (want more) -> zero partial writes
  begin
    perform set_business_want_more(b, array['kid_friendly'], array['weekday'], '16:00', '19:00', array['birthday']);
    out := out || 'FAIL want-more with a conflicting part ALLOWED' || E'\n';
  exception when others then
    get stacked diagnostics v_hint = pg_exception_hint;
    out := out || (case when v_hint = 'setting_conflict' then 'ok   ' else 'FAIL ' end) || 'want-more conflict refused: ' || sqlerrm || E'\n';
  end;
  select into r priority_attributes, priority_time_windows, priority_time_start, priority_occasions from brand_partners where id = b;
  out := out || (case when r.priority_attributes = '{}' and r.priority_time_windows = '{}' and r.priority_time_start is null and r.priority_occasions = '{}'
    then 'ok   ' else 'FAIL ' end) || 'want-more conflict: zero partial writes (windows, time range, occasions untouched)' || E'\n';
  -- INVALID in the LAST part -> nothing from the first three either
  begin
    perform set_business_want_more(b, array['quiet'], array['weekday'], '16:00', '19:00', array['not_an_occasion']);
    out := out || 'FAIL want-more invalid ALLOWED' || E'\n';
  exception when others then
    get stacked diagnostics v_hint = pg_exception_hint;
    out := out || (case when v_hint is null or v_hint = '' then 'ok   ' else 'FAIL ' end) || 'invalid: plain validation error, no conflict hint -- ' || sqlerrm || E'\n';
  end;
  out := out || (case when (select priority_attributes from brand_partners where id = b) = '{}' and (select priority_time_windows from brand_partners where id = b) = '{}'
    then 'ok   ' else 'FAIL ' end) || 'invalid: zero partial writes' || E'\n';
  -- VALID want-more -> all four saved
  perform set_business_want_more(b, array['quiet'], array['weekday'], '16:00', '19:00', array['birthday']);
  select into r priority_attributes, priority_time_windows, priority_time_start, priority_occasions from brand_partners where id = b;
  out := out || (case when r.priority_attributes = array['quiet'] and r.priority_time_windows = array['weekday'] and r.priority_time_start = '16:00' and r.priority_occasions = array['birthday']
    then 'ok   ' else 'FAIL ' end) || 'want-more valid: all four saved' || E'\n';

  -- CHECK-ONLY never writes, either answer
  got := check_business_setting_conflicts(b, 'profile', '{"attributes": ["kid_friendly"]}');
  out := out || (case when got = array['No children conflicts with Family-friendly. Remove one of these settings to continue.']
    and (select attributes from brand_partners where id = b) = '{}' then 'ok   ' else 'FAIL ' end) || 'check-only conflict: answered, nothing written' || E'\n';
  got := check_business_setting_conflicts(b, 'profile', '{"attributes": ["quiet"]}');
  out := out || (case when got = '{}' and (select attributes from brand_partners where id = b) = '{}' then 'ok   ' else 'FAIL ' end) || 'check-only valid: allowed, nothing written' || E'\n';
  begin
    got := check_business_setting_conflicts(b, 'profile', '{"attributes": ["not_an_attribute"]}');
    out := out || 'FAIL check-only invalid returned an answer' || E'\n';
  exception when others then
    get stacked diagnostics v_hint = pg_exception_hint;
    out := out || (case when coalesce(v_hint, '') <> 'setting_conflict' and (select attributes from brand_partners where id = b) = '{}' then 'ok   ' else 'FAIL ' end) || 'check-only invalid: validation error (not a conflict), nothing written' || E'\n';
  end;

  -- RETRY after resolving -> saves normally
  perform set_business_not_accommodated(b, array[]::text[]);
  perform set_business_offered_occasions(b, array['family_gathering']);
  out := out || (case when (select offered_occasions from brand_partners where id = b) = array['family_gathering'] then 'ok   ' else 'FAIL ' end) || 'retry after resolving: saved' || E'\n';
  perform set_business_offered_occasions(b, array[]::text[]);
  perform set_business_not_accommodated(b, array['no_children']);

  -- BUNDLE PARTS (integrity, not No-children)
  begin
    perform post_business_availability(null, 'Crafted', null, null, null, null, now(), now() + interval '2 hours', 15, 'birthday', array['family_fun'], null);
    out := out || 'FAIL Birthday + Family Fun ALLOWED' || E'\n';
  exception when others then
    get stacked diagnostics v_hint = pg_exception_hint;
    out := out || (case when sqlerrm = 'Family Fun isn''t part of a Birthday bundle. Pick the parts listed for Birthday.' and coalesce(v_hint, '') = ''
      then 'ok   ' else 'FAIL ' end) || 'Birthday + Family Fun: invalid (no conflict hint) -- ' || sqlerrm || E'\n';
  end;
  begin
    perform post_business_availability(null, 'Crafted', null, null, null, null, now(), now() + interval '2 hours', 15, 'date_night', array['food'], null);
    out := out || 'FAIL Date Night + Food ALLOWED' || E'\n';
  exception when others then out := out || 'ok   Date Night + Food: invalid -- ' || sqlerrm || E'\n'; end;
  perform set_config('request.jwt.claims', '', true);
  begin
    insert into business_availability (partner_id, title, starts_at, ends_at, status, bundle_occasion, bundle_components)
      values (b, 'Direct', now(), now() + interval '2 hours', 'expired', 'celebration', array['family_fun']);
    out := out || 'FAIL direct insert Celebration + Family Fun ALLOWED' || E'\n';
  exception when check_violation then out := out || 'ok   direct insert Celebration + Family Fun: blocked by the table CHECK' || E'\n'; end;
  -- every part the app offers is accepted with its own occasion (No children cleared so only the parts rule speaks)
  perform set_config('request.jwt.claims', json_build_object('sub', owner_id, 'role', 'authenticated')::text, true);
  perform set_business_not_accommodated(b, array[]::text[]);
  begin
    perform post_business_availability(null, 'Fam', null, null, null, null, now(), now() + interval '2 hours', 15, 'family_gathering', array['food', 'family_fun'], null);
    perform post_business_availability(null, 'Bday', null, null, null, null, now(), now() + interval '2 hours', 15, 'birthday', array['dinner', 'something_fun', 'something_to_do', 'sweet_treat'], null);
    perform post_business_availability(null, 'Date', null, null, null, null, now(), now() + interval '2 hours', 15, 'date_night', array['dinner', 'something_to_do', 'finish_the_night'], null);
    perform post_business_availability(null, 'Anniv', null, null, null, null, now(), now() + interval '2 hours', 15, 'anniversary', array['dinner', 'something_to_do', 'finish_the_night'], null);
    perform post_business_availability(null, 'Celeb', null, null, null, null, now(), now() + interval '2 hours', 15, 'celebration', array['dinner', 'something_fun', 'sweet_treat'], null);
    perform post_business_availability(null, 'Plain', null, null, null, null, now(), now() + interval '2 hours', 15, 'birthday', array[]::text[], null);
    out := out || 'ok   every app-offered bundle (and an occasion with no parts) accepted' || E'\n';
  exception when others then out := out || 'FAIL a valid bundle was refused -- ' || sqlerrm || E'\n'; end;
  -- Family Fun is not its own No-children trigger: the only line is the Family Gathering one
  begin
    perform set_business_not_accommodated(b, array['no_children']);
    out := out || 'FAIL No children with live Family Gathering postings ALLOWED' || E'\n';
  exception when others then
    get stacked diagnostics v_detail = pg_exception_detail;
    out := out || (case when v_detail::jsonb = '["No children conflicts with Family Gathering. Remove one of these settings to continue."]'::jsonb
      then 'ok   ' else 'FAIL ' end) || 'No children vs Family Gathering + Family Fun: one Family Gathering line, no Family Fun line -- ' || v_detail || E'\n';
  end;

  -- a request addressed to ONE business is not removed by compatibility filtering
  out := out || (case when pg_get_functiondef('public._route_request_to_partner'::regproc) !~ '_business_declines' then 'ok   ' else 'FAIL ' end)
    || 'directed request: _route_request_to_partner does not call the compatibility rule' || E'\n';

  -- grants and single overloads
  out := out || (case when not has_function_privilege('anon', 'public.set_business_want_more(uuid,text[],text[],time,time,text[])', 'execute')
    and not has_function_privilege('authenticated', 'public._bundle_component_problem(text,text[])', 'execute') then 'ok   ' else 'FAIL ' end) || 'grants' || E'\n';
  out := out || (case when (select count(*) from pg_proc where proname in ('post_business_availability', 'set_business_want_more')) = 2 then 'ok   ' else 'FAIL ' end) || 'single overloads' || E'\n';
  perform set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
  begin
    perform set_business_want_more(b, array['quiet'], '{}', null, null, '{}');
    out := out || 'FAIL non-owner want-more ALLOWED' || E'\n';
  exception when others then out := out || 'ok   non-owner want-more refused' || E'\n'; end;
  perform set_config('request.jwt.claims', '', true);
  raise exception E'RESULT\n%', out;
end $$;
rollback;

-- Verifies migration 20270219 (item 83). Rolled back; the result is reported through the exception text.
--  * the six new vibe keys are accepted on brand_partners.attributes
--  * an unknown key is still refused
--  * the six validating functions each have one overload and carry the new keys
begin;
do $$
declare out text := ''; bp uuid; k text; n int;
begin
  select id into bp from brand_partners limit 1;
  foreach k in array array['lively','trendy','relaxed','social','cozy','professional'] loop
    begin update brand_partners set attributes = array[k] where id = bp; out := out || k || ': ok' || E'\n';
    exception when others then out := out || k || ': REFUSED ' || sqlerrm || E'\n'; end;
  end loop;
  begin update brand_partners set attributes = array['vibey'] where id = bp; out := out || 'unknown: NOT REFUSED' || E'\n';
  exception when check_violation then out := out || 'unknown refused: ok' || E'\n'; end;
  for k in select unnest(array['create_business_request','update_business_profile','answer_preference_poll','set_business_priority_attributes','create_business_experience','update_business_experience']) loop
    select count(*) into n from pg_proc where pronamespace = 'public'::regnamespace and proname = k;
    out := out || k || ' overloads=' || n || ' has_cozy=' || (select bool_and(pg_get_functiondef(oid) like '%''cozy''%') from pg_proc where pronamespace = 'public'::regnamespace and proname = k) || E'\n';
  end loop;
  raise exception E'RESULT\n%', out;
end $$;
rollback;

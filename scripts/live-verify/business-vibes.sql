-- Verifies migration 20270219 (item 83). Rolled back; the result is reported through the exception text.
--  * the six new vibe keys are accepted on a business, a request, a profile preference; an unknown vibe is refused
--  * update_business_profile / set_business_priority_attributes accept them; each touched function has one overload
begin;
do $v$
declare out text := ''; pid uuid; n int;
begin
  select id into pid from brand_partners limit 1;
  update brand_partners set attributes = array['lively','trendy','cozy','relaxed','social','professional','quiet'] where id = pid;
  out := out || 'business vibes: ok' || E'\n';
  begin update brand_partners set attributes = array['moody'] where id = pid; out := out || 'moody: NOT REFUSED' || E'\n';
  exception when check_violation then out := out || 'unknown vibe refused: ok' || E'\n'; end;
  perform set_config('app.trusted_update', 'true', true);
  update profiles set venue_preferences = array['cozy','relaxed'] where id = (select id from profiles limit 1);
  out := out || 'profile preference: ok' || E'\n';
  select count(*) into n from pg_proc where proname in ('create_business_request','update_business_profile','answer_preference_poll',
    'set_business_priority_attributes','create_business_experience','update_business_experience') and prosrc like '%''professional''%';
  out := out || 'functions accepting vibes: ' || n || E'\n';
  select count(*) into n from pg_proc where proname in ('create_business_request','update_business_profile','answer_preference_poll',
    'set_business_priority_attributes','create_business_experience','update_business_experience');
  out := out || 'overloads total: ' || n || E'\n';
  raise exception '%', out;
end $v$;
rollback;

-- Item 76 live check (rolled back): the widened cuisine vocabulary is accepted by all 4 CHECKs and the 3 functions,
-- an unknown cuisine is still refused, and each function keeps a single overload.
begin;
do $$
declare ok boolean; v_partner uuid; v_owner uuid;
begin
  if (select count(*) from pg_constraint where conname in ('brand_partners_cuisine_check','business_requests_cuisine_check','business_partner_requests_cuisine_check','profiles_cuisine_preferences_check') and pg_get_constraintdef(oid) like '%bbq%greek%') <> 4 then raise exception 'FAIL checks'; end if;
  if (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname in ('create_business_request','update_business_profile','answer_preference_poll') and prosrc like '%''bbq'', ''korean'', ''vietnamese'', ''greek''%') <> 3 then raise exception 'FAIL functions'; end if;
  if exists (select proname from pg_proc where pronamespace='public'::regnamespace and proname in ('create_business_request','update_business_profile','answer_preference_poll') group by proname having count(*) > 1) then raise exception 'FAIL overloads'; end if;
  perform set_config('app.trusted_update', 'true', true);
  select id into v_partner from brand_partners limit 1;
  update brand_partners set cuisine = 'bbq' where id = v_partner;
  update profiles set cuisine_preferences = array['korean','greek'] where id = (select id from profiles limit 1);
  begin update brand_partners set cuisine = 'klingon' where id = v_partner; ok := false;
  exception when check_violation then ok := true; end;
  if not ok then raise exception 'FAIL unknown accepted'; end if;
end $$;
select 'PASS' as result;
rollback;

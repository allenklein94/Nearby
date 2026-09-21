-- Verifies migration 20270193. Read-only.
select (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname in ('create_business_request','update_business_profile','answer_preference_poll','set_business_priority_attributes','create_business_experience','update_business_experience')) as fn_rows,
 (select count(*) from pg_proc where pronamespace='public'::regnamespace and pg_get_functiondef(oid) like '%''wifi''%') as fns_with_wifi,
 (select count(*) from pg_constraint where pg_get_constraintdef(oid) like '%''reservation_required''%') as constraints_with_new,
 (select count(*) from (select proname from pg_proc where pronamespace='public'::regnamespace group by proname having count(*)>1 and proname in ('create_business_request','update_business_profile','answer_preference_poll','set_business_priority_attributes','create_business_experience','update_business_experience')) x) as multi_overload;

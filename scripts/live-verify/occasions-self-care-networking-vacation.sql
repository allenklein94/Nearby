-- Verifies migration 20270196. Read-only + one rolled-back insert.
select (select count(*) from pg_constraint where contype='c' and pg_get_constraintdef(oid) like '%''vacation''%') as constraints_with_new,
 (select count(*) from pg_proc where pronamespace='public'::regnamespace and pg_get_functiondef(oid) like '%''vacation''%') as fns_with_new,
 _occasion_emoji('vacation') as emoji, _occasion_noun('self_care') as noun,
 (select count(*) from (select proname from pg_proc where pronamespace='public'::regnamespace and proname in ('create_business_request','create_business_request_for_gathering','create_business_request_for_match','create_occasion_package','set_business_priority_occasions','update_occasion_package','_occasion_emoji','_occasion_noun') group by proname having count(*)>1) x) as multi_overload;

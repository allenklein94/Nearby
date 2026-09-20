-- Verifies get_business_insights returns best_time_sample / best_time_gatherings (migration 20270148). Management API; rolled back.
begin;
select set_config('request.jwt.claims', json_build_object('sub',(select id from profiles where managed_partner_id is not null limit 1),'role','authenticated')::text, true);
select * from public.get_business_insights((select managed_partner_id from profiles where managed_partner_id is not null limit 1));
rollback;

-- 20270182: the two new occasions pass every gate; junk still fails; single overloads. Rolled back.
begin;
do $$
declare u uuid; partner uuid; owner uuid; ok boolean; n int;
begin
  select id into u from profiles order by created_at limit 1;
  select id, managed_partner_id into owner, partner from profiles where managed_partner_id is not null limit 1;
  assert _occasion_noun('fundraiser') = 'Fundraiser' and _occasion_noun('bachelor_bachelorette') = 'Bachelor/Bachelorette Party', 'noun';
  assert _occasion_emoji('fundraiser') is not null, 'emoji';
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role','authenticated')::text, true);
  perform create_business_request(raw_text_param => 'live-verify', latitude_param => 40.0, longitude_param => -75.0, category_param => 'Restaurants', party_size_param => 8, budget_max_param => 40, occasion_param => 'bachelor_bachelorette');
  perform create_business_request(raw_text_param => 'live-verify 2', latitude_param => 40.0, longitude_param => -75.0, category_param => 'Restaurants', party_size_param => 8, budget_max_param => 40, occasion_param => 'fundraiser');
  begin perform create_business_request(raw_text_param => 'junk', latitude_param => 40.0, longitude_param => -75.0, category_param => 'Restaurants', party_size_param => 8, budget_max_param => 40, occasion_param => 'nonsense'); ok := false;
  exception when others then ok := true; end;
  assert ok, 'junk occasion still refused';
  perform set_config('request.jwt.claims', json_build_object('sub', owner, 'role','authenticated')::text, true);
  perform set_business_priority_occasions(partner, array['fundraiser','bachelor_bachelorette']);
  select count(*) into n from pg_proc p join pg_namespace s on s.oid=p.pronamespace where s.nspname='public' and p.proname in ('create_business_request','create_business_request_for_gathering','create_business_request_for_match','set_business_priority_occasions','create_occasion_package','update_occasion_package','_occasion_noun','_occasion_emoji');
  assert n = 8, 'single overloads, got ' || n;
  raise notice 'ALL OK';
end $$;
rollback;

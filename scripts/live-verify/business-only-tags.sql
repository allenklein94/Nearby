-- Business-only tags (20270180). Rolled back: consumers cannot write a clinical tag anywhere; a business can use it.
begin;
do $$
declare u uuid; owner uuid; partner uuid; ok boolean; g uuid;
begin
  select id into u from profiles order by created_at limit 1;
  select id, managed_partner_id into owner, partner from profiles where managed_partner_id is not null limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role','authenticated')::text, true);

  begin perform create_business_request('live-verify dental', 40.0, -75.0, 'Dental', 1, null, 40, null, null, null, 15, null); ok := false;
  exception when others then ok := sqlerrm ilike '%only for businesses%'; end;
  assert ok, 'consumer request with a clinical category refused';

  begin insert into gatherings (host_id, title, scheduled_at, precise_lat, precise_lng, interest_tag, area, capacity, visibility)
        values (u, 'x', now() + interval '2 days', 40, -75, 'Chiropractic', 'lv', 4, 'everyone'); ok := false;
  exception when others then ok := sqlerrm ilike '%only for businesses%'; end;
  assert ok, 'gathering with a clinical tag refused';
  insert into gatherings (host_id, title, scheduled_at, precise_lat, precise_lng, interest_tag, area, capacity, visibility)
        values (u, 'x', now() + interval '2 days', 40, -75, 'Coffee', 'lv', 4, 'everyone') returning id into g;
  assert g is not null, 'a normal tag still works';

  begin update profiles set interests = array['Coffee','Dental'] where id = u; ok := false;
  exception when others then ok := sqlerrm ilike '%only for businesses%'; end;
  assert ok, 'profile interest with a clinical tag refused';
  update profiles set interests = array['Coffee'] where id = u;

  -- a business may describe itself with it
  perform set_config('request.jwt.claims', json_build_object('sub', owner, 'role','authenticated')::text, true);
  perform update_business_profile(partner, (select name from brand_partners where id = partner), null, null, null, null, null, 'health_personal_care', null, null, null, 'Dental', array['Vision']);
  assert (select subcategory from brand_partners where id = partner) = 'Dental', 'the real profile RPC accepts a clinical subcategory';
  update brand_partners set category = 'health_personal_care', subcategory = 'Dental', categories = array['Vision'] where id = partner;
  assert (select subcategory from brand_partners where id = partner) = 'Dental', 'business subcategory Dental accepted';
  raise notice 'ALL OK';
end $$;
rollback;

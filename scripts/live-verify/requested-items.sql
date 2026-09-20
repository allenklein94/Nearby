-- Item 69. Rolled back: a customer-picked item list reaches the business card data, invalid items are refused,
-- and the business payload still carries no requester identity.
begin;
do $$
declare
  v_user uuid; v_owner uuid; v_partner uuid; r jsonb; v_req uuid; ok boolean; o jsonb;
begin
  select id into v_user from profiles order by created_at limit 1;
  select p.id, p.managed_partner_id into v_owner, v_partner from profiles p where managed_partner_id is not null limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub', v_user, 'role','authenticated')::text, true);
  begin
    perform public.create_business_request('coffee', 40, -75, 'Coffee', 4, null, 30, current_date + 1, time '19:00', null, 15,
      null, null, null, null, null, null, null, false, null, null, v_partner, null, array['coffee','sushi']);
    ok := false;
  exception when others then ok := sqlerrm like '%Invalid requested item%'; end;
  assert ok, 'unknown item refused';
  r := public.create_business_request('coffee for 4', 40, -75, 'Coffee', 4, null, 30, current_date + 1, time '19:00', null, 15,
    null, null, null, null, null, null, null, false, null, null, v_partner, null, array['pastries','coffee','coffee']);
  v_req := (r->>'requestId')::uuid;
  assert (select requested_items from business_requests where id = v_req) = array['coffee','pastries'], 'sorted, de-duplicated';
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role','authenticated')::text, true);
  o := (select x from jsonb_array_elements(public.get_business_opportunities(v_partner)) x where x->>'request_id' = v_req::text);
  assert o->'business_requests'->'requested_items' = '["coffee","pastries"]'::jsonb, 'card data carries the items';
  assert o::text not like '%' || (select display_name from profiles where id = v_user) || '%', 'no requester name';
  assert (o->'business_requests'->>'summary') not ilike '%pastries%', 'not in the summary line';
  raise notice 'requested-items ok';
end $$;
rollback;

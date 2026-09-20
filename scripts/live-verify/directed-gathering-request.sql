-- Rolled back. Host asks a SPECIFIC business for a gathering -> that business (only) gets a pending,
-- is_directed opportunity in get_business_opportunities; other businesses get nothing; repeat ask is refused;
-- a request already open for the gathering is reused.
begin;
do $$
declare out text := ''; g uuid; host uuid; p1 uuid; p2 uuid; owner1 uuid; owner2 uuid; n int; rid uuid;
  opp jsonb; msg text;
begin
  select id, host_id into g, host from gatherings limit 1;
  select bp.id, pr.id into p1, owner1 from brand_partners bp join profiles pr on pr.managed_partner_id = bp.id where bp.active limit 1;
  select bp.id into p2 from brand_partners bp where bp.active and bp.id <> p1 limit 1;
  update gatherings set scheduled_at = now() + interval '3 days', precise_lat = coalesce(precise_lat, 33.0), precise_lng = coalesce(precise_lng, -117.0), interest_tag = 'Coffee'
    where id = g;
  delete from business_requests where gathering_id = g;
  perform set_config('request.jwt.claims', json_build_object('sub', host, 'role', 'authenticated')::text, true);
  perform request_business_partnership('gathering', g, p1, null);
  select count(*) into n from business_request_offers o join business_requests r on r.id = o.request_id where r.gathering_id = g;
  out := out || 'offer rows for gathering (expect 1): ' || n || E'\n';
  select count(*) into n from business_request_offers o join business_requests r on r.id = o.request_id where r.gathering_id = g and o.partner_id = p2;
  out := out || 'rows for other business (expect 0): ' || n || E'\n';
  select r.raw_text into msg from business_requests r where r.gathering_id = g;
  out := out || 'request text: ' || msg || E'\n';
  perform set_config('request.jwt.claims', json_build_object('sub', owner1, 'role', 'authenticated')::text, true);
  select x into opp from jsonb_array_elements(get_business_opportunities(p1)) x
    where (x->'business_requests'->'gatherings'->>'interest_tag') = 'Coffee' and (x->>'is_directed')::boolean limit 1;
  out := out || 'owner sees directed opportunity: ' || (opp is not null) || ' status=' || coalesce(opp->>'status','-')
       || ' party=' || coalesce(opp->'business_requests'->>'party_size','-') || ' date=' || coalesce(opp->'business_requests'->>'date','-')
       || ' title=' || coalesce(opp->'business_requests'->'gatherings'->>'title','-')
       || ' requester_name_hidden=' || ((opp->'business_requests'->>'requester_display_name') is null) || E'\n';
  perform set_config('request.jwt.claims', json_build_object('sub', host, 'role', 'authenticated')::text, true);
  begin perform request_business_partnership('gathering', g, p1, null); msg := 'NO ERROR'; exception when others then msg := sqlerrm; end;
  out := out || 'repeat ask -> ' || msg || E'\n';
  raise exception 'ROLLBACK_OK %', out;
end $$;
rollback;

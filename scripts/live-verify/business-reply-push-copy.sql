-- Item 121. Rolled back: the requester's push names the reply by what it carries (availability / alternative / offer),
-- through the real submit_business_offer, and the reviewer-approval path uses the same builder.
begin;
do $$
declare
  v_user uuid; v_owner uuid; v_partner uuid; v_g uuid; v_req uuid; v_title text; v_body text; v_case record;
begin
  select id into v_user from profiles order by created_at limit 1;
  select p.id, p.managed_partner_id into v_owner, v_partner from profiles p where managed_partner_id is not null limit 1;
  update brand_partners set name = 'Coastal Coffee' where id = v_partner;
  update profiles set notify_business = true where id = v_user;
  insert into gatherings (host_id, title, area, interest_tag, scheduled_at, visibility)
  values (v_user, 'Sunday coffee', 'Downtown', 'Coffee', now() + interval '2 days', 'everyone') returning id into v_g;

  for v_case in select * from (values
      ('standard', 'We can accommodate this as requested.', null::numeric, null::text, null::timestamptz, 'They can take you for your coffee gathering.'),
      ('alt_time', 'We can do 8 PM instead.', null, null, now() + interval '2 days 1 hour', 'They suggested another time for your coffee gathering.'),
      ('standard', '2 coffees and 2 pastries.', 12, '2 coffees + 2 pastries', null, 'They sent an offer for your coffee gathering: 2 coffees + 2 pastries'),
      ('standard', 'Coffee for the group.', 12, null, null, 'They sent an offer for your coffee gathering.')
    ) t(kind, descr, price, title, alt, expected)
  loop
    insert into business_requests (requester_id, raw_text, category, party_size, latitude, longitude, radius_miles, expires_at, status, gathering_id)
    values (v_user, 'secret free text', 'Coffee', 4, 40, -75, 15, now() + interval '2 days', 'open', v_g) returning id into v_req;
    insert into business_request_offers (request_id, partner_id, status) values (v_req, v_partner, 'pending');
    perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
    perform public.submit_business_offer(v_req, v_case.kind, v_case.descr, v_case.price, v_case.alt, null, null, null, v_case.title);
    perform set_config('request.jwt.claims', null, true);
    select convert_from(body, 'utf8')::jsonb->>'title', convert_from(body, 'utf8')::jsonb->>'body' into v_title, v_body
    from net.http_request_queue where convert_from(body, 'utf8') like '%business_offer_received%' and convert_from(body, 'utf8') like '%' || v_req || '%'
    order by id desc limit 1;
    assert v_title = '☕ Coastal Coffee responded', 'title: ' || coalesce(v_title, 'null');
    assert v_body = v_case.expected, 'body: ' || coalesce(v_body, 'null') || ' expected ' || v_case.expected;
    assert v_body not like '%secret%';
    assert (select convert_from(body, 'utf8')::jsonb->'data'->>'type' from net.http_request_queue
            where convert_from(body, 'utf8') like '%' || v_req || '%' order by id desc limit 1) = 'business_offer_received';
  end loop;

  -- the reviewer-approval path calls the same builder, and the old copy is gone from both functions
  assert (select prosrc from pg_proc where proname = 'admin_review_business_content_screening') like '%_business_reply_push(o.id)%';
  assert (select prosrc from pg_proc where proname = 'admin_review_business_content_screening') not like '%New offer for your request!%';
  assert (select prosrc from pg_proc where proname = 'submit_business_offer') like '%_business_reply_push(v_row.id)%';
  assert (select count(*) from pg_proc where proname in ('submit_business_offer', 'admin_review_business_content_screening', '_business_reply_push', '_business_reply_kind') and pronamespace = 'public'::regnamespace) = 4, 'single overloads';
  assert not has_function_privilege('authenticated', 'public._business_reply_push(uuid)', 'execute');
  assert not has_function_privilege('anon', 'public._business_reply_kind(text, text, numeric, numeric, text[])', 'execute');
  raise notice 'business-reply-push-copy ALL OK';
end $$;
rollback;

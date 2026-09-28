-- Item 125: the BUSINESS_OFFER_SENT handler for offers made automatically from a business's standing supply
-- (availability posting, occasion package, fulfillment policy, AI policy) sends the owner exactly the pre-item-125
-- wording, honors the business mute (except the package match, which never did), and sends nothing to the customer.
-- Rolled back: ends with an exception carrying the result; nothing is kept.
do $v$
declare
  v_owner uuid; v_partner uuid; v_req uuid; v_av uuid; v_pkg uuid; v_pol uuid; v_off uuid; v_sum text;
  v_res jsonb := '{}'::jsonb; v_src text; v_expect text; v_n int; v_requester uuid;
begin
  select id, managed_partner_id into v_owner, v_partner from profiles where managed_partner_id is not null limit 1;
  select id into v_requester from profiles where id <> v_owner limit 1;
  update profiles set notify_business = true where id in (v_owner, v_requester);
  insert into business_requests (requester_id, raw_text, category, party_size, latitude, longitude, radius_miles, expires_at)
    values (v_requester, 'private words never sent', 'Coffee', 2, 40, -75, 15, now() + interval '1 day') returning id into v_req;
  v_sum := business_safe_request_summary(v_req);
  insert into business_availability (partner_id, title, starts_at, ends_at) values (v_partner, 'Quiet corner', now(), now() + interval '2 hours') returning id into v_av;
  insert into business_occasion_packages (partner_id, occasion_type, name) values (v_partner, 'birthday', 'Birthday table') returning id into v_pkg;
  insert into business_ai_policies (partner_id, name, trust_level, action_type) values (v_partner, 'Lunch rule', 2, 'auto_respond_offer') returning id into v_pol;
  create temp view vq as select convert_from(body, 'utf8')::jsonb as b from net.http_request_queue where url like '%/send-push';

  foreach v_src in array array['match_availability', 'match_package', 'match_policy', 'ai_auto_respond'] loop
    delete from business_request_offers where request_id = v_req;
    insert into business_request_offers (request_id, partner_id, status, responded_at) values (v_req, v_partner, 'offered', now()) returning id into v_off;
    perform _emit_event('BUSINESS_OFFER_SENT', 'business_request_offer', v_off, v_requester, v_src,
      jsonb_build_object('request_id', v_req, 'partner_id', v_partner, 'availability_id', v_av, 'package_id', v_pkg, 'policy_id', v_pol),
      'BUSINESS_OFFER_SENT:' || v_off);
    v_expect := case v_src
      when 'match_availability' then 'Your availability was just matched!|"Quiet corner" matches a new request: ' || coalesce(v_sum, 'a new request')
      when 'match_package' then 'Your occasion package was just matched!|"Birthday table" matches a new request: ' || coalesce(v_sum, 'a new request')
      when 'match_policy' then 'Auto-accepted a new request!|Your fulfillment policy auto-accepted: ' || coalesce(v_sum, 'a new request')
      else 'Your AI Automation auto-responded!|Policy "Lunch rule" auto-sent an offer for: ' || v_sum end;
    select count(*) into v_n from vq where b->>'recipient_id' = v_requester::text and b->'data'->>'request_id' = v_req::text;
    v_res := v_res || jsonb_build_object(v_src, v_n = 0 and (select count(*) from vq where b->>'recipient_id' = v_owner::text
      and b->'data'->>'type' = 'business_opportunity_received' and b->'data'->>'request_id' = v_req::text
      and b->>'title' || '|' || (b->>'body') = v_expect) = 1);
  end loop;

  -- mute: a muted owner gets nothing from a policy match, but still gets the package match (pre-item-125 behavior)
  update profiles set notify_business = false where id = v_owner;
  foreach v_src in array array['match_policy', 'match_package'] loop
    delete from business_request_offers where request_id = v_req;
    insert into business_request_offers (request_id, partner_id, status, responded_at) values (v_req, v_partner, 'offered', now()) returning id into v_off;
    perform _emit_event('BUSINESS_OFFER_SENT', 'business_request_offer', v_off, v_requester, v_src,
      jsonb_build_object('request_id', v_req, 'partner_id', v_partner, 'package_id', v_pkg), 'BUSINESS_OFFER_SENT:' || v_off);
    v_res := v_res || jsonb_build_object('muted_' || v_src,
      (select outcome from domain_event_notifications n join domain_events e on e.id = n.event_id where e.object_id = v_off and n.recipient_id = v_owner));
  end loop;
  -- no raw text anywhere in what was queued
  v_res := v_res || jsonb_build_object('raw_text_leaked', exists (select 1 from vq where b::text like '%private words never sent%'));
  raise exception 'RESULT %', v_res;
end $v$;

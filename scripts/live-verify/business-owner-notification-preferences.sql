-- Item 143: business-owner alerts vs customer Businesses alerts. Runs inside a transaction that always rolls back.
-- Usage: `begin;` + (if not yet applied) the migration + this file + `rollback;`.
do $$
declare
  x uuid; y uuid; p uuid; m text[]; v text[]; r text;
begin
  -- x = one account that is BOTH a customer and a business owner; y = a customer who owns nothing
  select id into x from profiles order by id limit 1;
  select id into y from profiles where id <> x and managed_partner_id is null order by id limit 1;
  select id into p from brand_partners order by id limit 1;
  perform set_config('app.trusted_update', 'true', true);
  update profiles set managed_partner_id = p, notification_mutes = '{}' where id = x;
  update profiles set notification_mutes = '{}' where id = y;
  perform set_config('app.push_handoff_test_failure', 'true', true);  -- never call send-push for real

  -- 1. customer Businesses off: owner alerts (incl. the request-expiry warning) still go out; customer business alerts don't
  perform set_config('request.jwt.claims', json_build_object('sub', x, 'role', 'authenticated')::text, true);
  perform public.set_my_notification_group('business_offers', false);
  m := public.set_my_notification_group('business_responses', false);
  if m <> '{business_offers,business_responses}' then raise exception '1 mutes %', m; end if;
  if public._push_muted(x, 'business_request_expiring') then raise exception '1 expiry silenced by a customer switch'; end if;
  if public._push_muted(x, 'business_opportunity_received') then raise exception '1 new request silenced by a customer switch'; end if;
  if public._push_muted(x, 'reservation_cancelled_by_customer') then raise exception '1 owner reservation silenced'; end if;
  if not public._push_muted(x, 'business_offer_received') then raise exception '1 customer offer not muted'; end if;
  if public._send_push(x, 't', 'b', jsonb_build_object('type', 'business_request_expiring')) = 'muted' then raise exception '1 sender muted expiry'; end if;
  if public._send_push(x, 't', 'b', jsonb_build_object('type', 'business_offer_received')) <> 'muted' then raise exception '1 sender sent customer offer'; end if;
  if (select notify_business from profiles where id = x) then raise exception '1 notify_business should follow the customer groups'; end if;

  -- 2. owner alerts off, customer Businesses on: the reverse
  m := public.set_my_notification_group('business_offers', true);
  m := public.set_my_notification_group('business_responses', true);
  foreach r in array array['owner_requests', 'owner_offers', 'owner_reservations', 'owner_demand'] loop
    m := public.set_my_notification_group(r, false);
  end loop;
  if m <> '{owner_requests,owner_offers,owner_reservations,owner_demand}' then raise exception '2 mutes %', m; end if;
  if not public._push_muted(x, 'business_request_expiring') then raise exception '2 expiry not muted'; end if;
  if not public._push_muted(x, 'aggregated_demand_growing') then raise exception '2 demand not muted'; end if;
  if public._push_muted(x, 'business_offer_received') or public._push_muted(x, 'business_reservation_confirmed') then
    raise exception '2 owner switch silenced a customer alert';
  end if;
  if not (select notify_business from profiles where id = x) then raise exception '2 owner mutes changed notify_business'; end if;

  -- 3. each one flips alone; the older owner RPCs read and write the same store
  if public.get_my_business_notification_prefs() <> '{requests,offers,reservations,demand}' then raise exception '3 get %', public.get_my_business_notification_prefs(); end if;
  perform public.set_my_business_notification_group('demand', false);
  perform public.set_my_business_notification_group('requests', false);
  if (select notification_mutes from profiles where id = x) <> '{owner_offers,owner_reservations}' then raise exception '3 wrapper %', (select notification_mutes from profiles where id = x); end if;
  m := public.set_my_notification_group('dating', false);
  if m <> '{dating,owner_offers,owner_reservations}' then raise exception '3 canonical order %', m; end if;

  -- 4. account notices to an applicant are never muted, whatever is off
  update profiles set notification_mutes = array['business_offers','business_responses','owner_requests','owner_offers','owner_reservations','owner_demand'] where id = x;
  if public._push_muted(x, 'business_partner_approved') or public._push_muted(x, 'business_partner_needs_info') then raise exception '4 account notice muted'; end if;

  -- 5. permissions: a non-owner cannot set owner groups; the old owner RPC refuses too; customers can still set theirs
  perform set_config('request.jwt.claims', json_build_object('sub', y, 'role', 'authenticated')::text, true);
  begin
    perform public.set_my_notification_group('owner_requests', false);
    raise exception '5 non-owner set an owner group';
  exception when raise_exception then if sqlerrm not like 'Only a business owner%' then raise; end if;
  end;
  begin
    perform public.set_my_business_notification_group('requests', true);
    raise exception '5 non-owner used the old RPC';
  exception when raise_exception then if sqlerrm not like 'Only a business owner%' then raise; end if;
  end;
  if public.get_my_business_notification_prefs() is not null then raise exception '5 non-owner got owner prefs'; end if;
  m := public.set_my_notification_group('business_offers', false);
  if m <> '{business_offers}' then raise exception '5 customer set %', m; end if;

  -- 6. the CHECK, grants, overloads, the old table gone
  begin
    update profiles set notification_mutes = '{owner_nonsense}' where id = y;
    raise exception '6 CHECK accepted junk';
  exception when check_violation then null;
  end;
  if to_regclass('public.business_notification_prefs') is not null then raise exception '6 old store still exists'; end if;
  if has_function_privilege('anon', 'public.set_my_notification_group(text, boolean)', 'execute') then raise exception '6 anon'; end if;
  if has_function_privilege('authenticated', 'public._canonical_notification_mutes(text[])', 'execute') then raise exception '6 helper grant'; end if;
  if (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname in (
       'set_my_notification_group', 'get_my_business_notification_prefs', 'set_my_business_notification_group',
       '_business_request_expiry_warning_candidates', 'send_business_opportunity_digests', '_on_business_offer_accepted',
       '_on_business_offer_sent', '_on_business_request_sent', 'cancel_business_request', 'cancel_business_reservation',
       'cancel_community', 'cancel_gathering', 'notify_aggregated_demand_threshold', 'notify_occasion_demand_threshold',
       'approve_business_partner_request', 'deny_business_partner_request', 'request_more_business_partner_info')) <> 17 then
    raise exception '6 overloads';
  end if;
  if (select count(*) from notification_type_groups) <> 85 then raise exception '6 seed %', (select count(*) from notification_type_groups); end if;
  -- 7. no owner sender reads the customer-derived column for its owner recipient any more
  if exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname in
       ('_business_request_expiry_warning_candidates', 'send_business_opportunity_digests', 'notify_aggregated_demand_threshold',
        'notify_occasion_demand_threshold', 'cancel_business_request', '_on_business_request_sent')
       and pg_get_functiondef(oid) ~ 'notify_business') then
    raise exception '7 an owner sender still reads notify_business';
  end if;
end $$;
select 'ALL OK' as result;

-- Follow-up to 20270424 for the TRUST stack (owner, 2026-11-16; STAGED). Exists only where 0370-0417 and 0424 combine:
-- written and tested on integ/multi-location-x-trust (an integration check), to be carried onto whichever branch
-- first holds both. Deploys right after 0424, never without it.
--
-- 0424 keeps profiles.managed_partner_id as the ONE location an account is acting for. These eight trust functions used
-- it to mean "is a member of this business", which breaks once one account belongs to several locations:
--   * _capture_report_business / _capture_report_business_offer: "you can't report your own business" -> an owner could
--     report their OTHER location (and the offer report's manager of record would miss members not acting for it);
--   * admin_verify_business: "another admin has to verify it" -> an admin who belongs to B but acts for A could verify B
--     (conflict-of-interest bypass); admin_list_business_verifications' "you manage" flag + managers list likewise;
--   * business_verification_status: lapse 'manager_changed' fired merely because the verified manager switched location;
--   * _open_payment_exception, content_removal_close_links, offer_evidence_reasons: people to tell / to hold evidence for
--     = only whoever acts for the business right now.
-- All now ask private.is_business_member / private.business_memberships. Bodies are the live definitions with ONLY those
-- lookups changed (owner, security, search_path and grants kept).

-- _capture_report_business_offer
CREATE OR REPLACE FUNCTION private._capture_report_business_offer()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_partner uuid;
  v_manager uuid;
  v_name text;
begin
  if new.content_type is distinct from 'business_offer' then
    return new;
  end if;
  if new.content_captured_at is null then
    raise exception 'That offer isn''t available' using errcode = '22023', hint = 'report_content_mismatch';
  end if;
  select o.partner_id into v_partner from business_request_offers o where o.id = new.content_id;
  select p.id into v_manager from private.business_memberships bm join profiles p on p.id = bm.user_id where bm.partner_id = v_partner order by p.created_at limit 1;
  select bp.name into v_name from brand_partners bp where bp.id = v_partner;
  if new.reporter_id is not null and private.is_business_member(new.reporter_id, v_partner) then
    raise exception 'You can''t report your own business''s offer' using errcode = '22023', hint = 'report_content_mismatch';
  end if;
  new.reported_id := v_manager;
  new.content_excerpt := left('Offer from ' || coalesce(v_name, 'a business') || E':\n' || coalesce(new.content_excerpt, ''), 2000);
  return new;
end;
$function$;

-- _capture_report_business
CREATE OR REPLACE FUNCTION private._capture_report_business()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_name text;
begin
  if new.content_type is distinct from 'business' then
    return new;
  end if;
  if new.content_captured_at is null then
    raise exception 'That business isn''t available' using errcode = '22023', hint = 'report_content_mismatch';
  end if;
  if new.reporter_id is not null
     and private.is_business_member(new.reporter_id, new.content_id) then
    raise exception 'You can''t report your own business' using errcode = '22023', hint = 'report_content_mismatch';
  end if;
  select bp.name into v_name from brand_partners bp where bp.id = new.content_id;
  new.reported_id := null;
  new.content_excerpt := left('Business: ' || coalesce(v_name, '(no name)')
                              || case when coalesce(new.content_excerpt, '') <> '' then E'\n' || new.content_excerpt else '' end, 2000);
  return new;
end;
$function$;

-- _open_payment_exception
CREATE OR REPLACE FUNCTION private._open_payment_exception(payment_param business_payments, kind_param text, leaving_param uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_id uuid;
  v_money text := private._money_text(payment_param.amount, payment_param.currency);
  v_ref text := coalesce(' Stripe payment ' || payment_param.stripe_payment_intent_id || '.', '');
  v_partner uuid := coalesce(payment_param.partner_id, (select o.partner_id from public.business_reservations r
    join public.business_request_offers o on o.id = r.offer_id where r.id = payment_param.reservation_id));
  v_person uuid;
begin
  insert into private.payment_exceptions (payment_id, partner_id, kind, amount, currency, stripe_payment_intent_id)
    values (payment_param.id, v_partner, kind_param, payment_param.amount, payment_param.currency, payment_param.stripe_payment_intent_id)
    on conflict (payment_id) where status = 'open' do nothing returning id into v_id;
  if v_id is null then return; end if;
  insert into private.payment_exception_events (exception_id, event) values (v_id, 'opened');
  for v_person in select pr.id from private.business_memberships bm join public.profiles pr on pr.id = bm.user_id where bm.partner_id = v_partner and pr.id is distinct from leaving_param loop
    perform public._send_push(v_person, 'A refund is needed',
      case kind_param when 'paid_booking_ended' then 'A paid reservation ended because the customer left Nearby. Please refund ' || v_money || ' in Stripe; it goes back to their payment method.'
        else 'A payment of ' || v_money || ' arrived after its reservation was cancelled. Please refund it in Stripe; it goes back to their payment method.' end || v_ref,
      jsonb_build_object('type', 'reservation_cancelled_by_customer'), 'payment_exception:' || v_id || ':' || v_person);
  end loop;
  for v_person in select pr.id from public.profiles pr where pr.is_admin is true and pr.suspended_at is null and pr.id is distinct from leaving_param loop
    perform public._send_push(v_person, 'A payment needs attention', 'A refund is owed: ' || v_money || '.',
      jsonb_build_object('type', 'admin_report_received'), 'payment_exception:' || v_id || ':' || v_person);
  end loop;
end;
$function$;

-- admin_list_business_verifications
CREATE OR REPLACE FUNCTION public.admin_list_business_verifications()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_admin uuid := private.require_admin();
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'partner_id', b.id, 'name', b.name, 'address', b.address, 'active', b.active,
      'managers', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'display_name', p.display_name) order by p.created_at), '[]'::jsonb)
                   from private.business_memberships bm join public.profiles p on p.id = bm.user_id where bm.partner_id = b.id),
      'you_manage', private.is_business_member(v_admin, b.id),
      'state', s.state, 'badge', s.badge, 'lapse', s.lapse,
      'history', (select coalesce(jsonb_agg(jsonb_build_object(
                    'at', e.at, 'kind', e.kind, 'checks', e.checks, 'note', e.note,
                    'by', e.actor, 'by_name', (select display_name from public.profiles where id = e.actor),
                    'verified_name', e.verified_name, 'verified_address', e.verified_address) order by e.id desc), '[]'::jsonb)
                  from private.business_verification_events e where e.partner_id = b.id))
      order by b.name)
    from public.brand_partners b
    cross join lateral private.business_verification_status(b.id) s), '[]'::jsonb);
end;
$function$;

-- admin_verify_business
CREATE OR REPLACE FUNCTION public.admin_verify_business(partner_id_param uuid, checks_param jsonb, decision_note_param text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_admin uuid := private.require_admin();
  b public.brand_partners;
  v_manager uuid;
  v_note text := private.clean_case_text(decision_note_param, 500, 'verification_note_too_long');
  v_clean record;
  v_kind text;
begin
  select * into b from public.brand_partners where id = partner_id_param for update;   -- serializes decisions on one business
  if b.id is null then
    raise exception 'Business not found' using errcode = 'P0002', hint = 'business_not_found';
  end if;
  if private.is_business_member(v_admin, b.id) then
    raise exception 'You manage this business, so another admin has to verify it'
      using errcode = '42501', hint = 'verification_conflict_of_interest';
  end if;
  if b.active is not true then
    raise exception 'Only an active, approved business can be verified' using errcode = '22023', hint = 'business_not_active';
  end if;
  select p.id into v_manager from private.business_memberships bm join public.profiles p on p.id = bm.user_id where bm.partner_id = b.id order by p.created_at, p.id limit 1;
  if v_manager is null then
    raise exception 'This business has no manager to verify' using errcode = '22023', hint = 'business_has_no_manager';
  end if;
  if v_note is null or length(v_note) < 10 then
    raise exception 'Write the decision (at least 10 characters)' using errcode = '22023', hint = 'verification_note_too_short';
  end if;
  select * into v_clean from private.business_verification_clean_checks(checks_param);
  v_kind := case when v_clean.all_passed then 'verified' else 'not_verified' end;
  insert into private.business_verification_events (partner_id, actor, kind, checks, note, verified_name, verified_address, verified_manager)
  values (b.id, v_admin, v_kind, v_clean.cleaned, v_note,
          case when v_kind = 'verified' then b.name end,
          case when v_kind = 'verified' then b.address end,
          case when v_kind = 'verified' then v_manager end);
  return jsonb_build_object('state', v_kind, 'badge', (private.business_verification_status(b.id)).badge);
end;
$function$;

-- business_verification_status
CREATE OR REPLACE FUNCTION private.business_verification_status(p_partner uuid, OUT state text, OUT badge boolean, OUT lapse text)
 RETURNS record
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  e private.business_verification_events;
  b public.brand_partners;
begin
  select * into e from private.business_verification_events where partner_id = p_partner order by id desc limit 1;
  state := coalesce(e.kind, 'none');
  badge := false;
  if e.kind is distinct from 'verified' then return; end if;
  select * into b from public.brand_partners where id = p_partner;
  if b.id is null or b.active is not true then lapse := 'inactive';
  elsif b.name is distinct from e.verified_name then lapse := 'name_changed';
  elsif coalesce(b.address, '') is distinct from coalesce(e.verified_address, '') then lapse := 'address_changed';
  elsif not private.is_business_member(e.verified_manager, p_partner) then lapse := 'manager_changed';
  else badge := true;
  end if;
end;
$function$;

-- content_removal_close_links
CREATE OR REPLACE FUNCTION private.content_removal_close_links(p_type text, p_id uuid, p_bookings boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_offer record;
  v_result jsonb;
  v_request record;
  v_what text := case p_type when 'gathering' then 'A gathering' else 'A community' end;
  m uuid;
begin
  if p_bookings then
    for v_offer in
      select o.id as offer_id, o.partner_id, o.request_id
        from business_request_offers o
        join business_requests r on r.id = o.request_id
       where o.status = 'accepted'
         and ((p_type = 'gathering' and r.gathering_id = p_id) or (p_type = 'community' and r.community_id = p_id))
    loop
      select * into v_request from business_requests where id = v_offer.request_id;
      v_result := _cancel_reservation_by_offer(v_offer.offer_id);
      if (v_result->>'cancelled')::boolean then
        perform public._send_push(v_request.requester_id, 'Your reservation was cancelled',
          v_what || ' linked to your reservation was removed by Nearby, so the reservation was cancelled too.',
          jsonb_build_object('type', 'business_reservation_cancelled', 'request_id', v_request.id, 'offer_id', v_offer.offer_id));
        for m in select bm.user_id from private.business_memberships bm where bm.partner_id = v_offer.partner_id loop
          perform public._send_push(m, 'A reservation was cancelled',
            v_what || ' linked to a reservation was removed by Nearby, so the reservation was cancelled too.',
            jsonb_build_object('type', 'reservation_cancelled_by_customer', 'request_id', v_request.id, 'offer_id', v_offer.offer_id));
        end loop;
      elsif v_result->>'reason' = 'payment_captured' then
        perform public._send_push(v_request.requester_id, 'Action needed on your reservation',
          v_what || ' linked to your paid reservation was removed by Nearby. Contact the business directly to arrange a refund.',
          jsonb_build_object('type', 'business_reservation_cancelled', 'request_id', v_request.id, 'offer_id', v_offer.offer_id));
        for m in select bm.user_id from private.business_memberships bm where bm.partner_id = v_offer.partner_id loop
          perform public._send_push(m, 'A paid reservation is affected',
            v_what || ' linked to a paid reservation was removed by Nearby. The customer may reach out about a refund.',
            jsonb_build_object('type', 'reservation_cancelled_by_customer', 'request_id', v_request.id, 'offer_id', v_offer.offer_id));
        end loop;
      end if;
    end loop;
  end if;

  update business_request_offers set status = 'cancelled'
   where status in ('pending', 'offered')
     and request_id in (select r.id from business_requests r
                         where (p_type = 'gathering' and r.gathering_id = p_id) or (p_type = 'community' and r.community_id = p_id));
  update business_requests set status = 'cancelled'
   where status = 'open' and ((p_type = 'gathering' and gathering_id = p_id) or (p_type = 'community' and community_id = p_id));

  delete from social_invites where invite_type = p_type and target_id = p_id and status = 'pending';
  delete from business_partnership_requests where target_type = p_type and target_id = p_id;
  update private.ugc_held_items set status = 'superseded'
   where target_table = case p_type when 'gathering' then 'gatherings' else 'communities' end
     and target_id = p_id and status = 'pending';
end;
$function$;

-- offer_evidence_reasons
CREATE OR REPLACE FUNCTION private.offer_evidence_reasons(p_offer uuid, p_partner uuid, OUT report_ids uuid[], OUT case_ids uuid[], OUT hold_ids uuid[])
 RETURNS record
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_managers uuid[];
begin
  select coalesce(array_agg(r.id), '{}') into report_ids
    from reports r
   where ((r.content_type = 'business_offer' and r.content_id = p_offer)
       or (r.content_type = 'business' and r.content_id = p_partner))
     and (not coalesce(r.resolved, false) or private.report_on_legal_hold(r.id));
  -- Managers: the business's current managers + whoever the kept reports name (a manager whose link was already cleared).
  select coalesce(array_agg(distinct m), '{}') into v_managers
    from (select bm.user_id as m from private.business_memberships bm where bm.partner_id = p_partner
          union select r.reported_id from reports r where r.id = any(report_ids) and r.reported_id is not null) x;
  select coalesce(array_agg(distinct c.id), '{}') into case_ids
    from private.account_review_cases c
   where c.status = 'open'
     and (c.subject_user = any(v_managers)
          or exists (select 1 from private.account_review_case_members cm where cm.case_id = c.id and cm.user_id = any(v_managers)));
  select coalesce(array_agg(h.id), '{}') into hold_ids
    from private.legal_holds h
   where h.released_at is null and h.target_type = 'account' and h.target_id = any(v_managers);
end;
$function$;

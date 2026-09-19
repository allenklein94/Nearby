-- State-machine audit gap 6: when a decline leaves an open request with no live offer, tell the requester (and plan
-- participants) once that nobody is available, instead of one more per-business decline. Derived, no new stored status.
-- Same signature as before (no overload); execute grants are unchanged by CREATE OR REPLACE.

CREATE OR REPLACE FUNCTION public.decline_business_offer(request_id_param uuid, reason_param text, note_param text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_partner_id uuid;
  v_row record;
  v_requester_id uuid;
  v_raw_text text;
  v_partner_name text;
  v_occ_type text;
  v_occ_who text;
  v_push_title text;
  v_push_body text;
  service_key text;
  v_none_left boolean;
begin
  if reason_param not in (
    'too_far',
    'too_busy_right_now',
    'cant_accommodate_group_size',
    'outside_our_hours',
    'not_a_fit_for_us',
    'other'
  ) then
    raise exception 'Invalid decline reason.';
  end if;

  select managed_partner_id into v_partner_id from profiles where id = auth.uid();
  if v_partner_id is null then
    raise exception 'You do not manage a business.';
  end if;

  select * into v_row from business_request_offers
  where request_id = request_id_param and partner_id = v_partner_id
  for update;

  if v_row is null then
    raise exception 'This request was not sent to your business.';
  end if;
  if v_row.status not in ('pending', 'offered') then
    raise exception 'This request has already been resolved.';
  end if;

  update business_request_offers
  set status = 'declined',
      responded_at = now(),
      decline_reason = reason_param,
      decline_note = case when reason_param = 'other' then note_param else null end
  where id = v_row.id;

  select requester_id, raw_text into v_requester_id, v_raw_text from business_requests where id = request_id_param;
  select name into v_partner_name from brand_partners where id = v_partner_id;
  select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';

  select occasion_type, who_for_name into v_occ_type, v_occ_who from _occasion_context_for_business_request(request_id_param);
  if v_occ_type is not null then
    v_push_title := _occasion_emoji(v_occ_type) || ' An update on your ' || lower(_occasion_noun(v_occ_type)) || ' plan';
    v_push_body := coalesce(v_partner_name, 'A business') || ' can''t accommodate your request'
      || case when v_occ_who is not null then ' for ' || v_occ_who else '' end || '. Try another business nearby.';
  else
    v_push_title := 'An update on your request';
    v_push_body := coalesce(v_partner_name, 'A business') || ' can''t accommodate "' || left(coalesce(v_raw_text, ''), 60) || '"';
  end if;

  -- State-machine audit gap 6: this decline may leave the request with nobody left to answer it. Derived, not stored: the
  -- request is still open and no offer is live (pending/offered) or won (accepted/completed).
  select exists (select 1 from business_requests where id = request_id_param and status = 'open')
     and not exists (select 1 from business_request_offers
                     where request_id = request_id_param and status in ('pending', 'offered', 'accepted', 'completed'))
    into v_none_left;
  if v_none_left then
    v_push_title := 'Nobody is available yet';
    v_push_body := 'Every business we asked has passed on "' || left(coalesce(v_raw_text, ''), 60) || '". Try widening your search.';
  end if;

  if service_key is not null then
    if coalesce((select notify_business from profiles where id = v_requester_id), true) then
      perform net.http_post(
        url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
        body := jsonb_build_object(
          'recipient_id', v_requester_id,
          'title', v_push_title,
          'body', v_push_body,
          'data', jsonb_build_object('type', case when v_none_left then 'business_request_all_declined' else 'business_offer_declined' end, 'request_id', request_id_param)
        )
      );
    end if;

    perform _notify_other_plan_participants(request_id_param, v_requester_id, case when v_none_left then 'business_request_all_declined' else 'business_offer_declined' end, v_push_title, v_push_body);
  end if;

  return jsonb_build_object('success', true);
end;
$function$
;

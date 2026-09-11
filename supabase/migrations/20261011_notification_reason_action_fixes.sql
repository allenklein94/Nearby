-- Items 48 & 49 (CLAUDE.md): fix list from PRODUCT_AUDIT/
-- NOTIFICATION_REASON_ACTION_AUDIT_2026-09-11.md, items 2 and 6. (Item 1 --
-- the biggest one, recommended_business_availability tapping through to the
-- specific matched posting -- was already fixed client-side against the
-- already-live get_business_availability_by_id(); items 3/4/5 are pure
-- client-side routeNotificationTap additions, no DB change needed.)

-- Item 2: notify_gathering_interest's push already names a real person and
-- a real gathering ("X is interested in 'Title'") -- satisfies 48 -- but
-- never included gathering_id in its payload even though new.gathering_id
-- is right there, so the host's tap fell through to a generic Gatherings
-- browse instead of the specific gathering they need to review. One-line
-- fix; notifications.js's existing gathering_interest case already checks
-- data.gathering_id, no client change needed.
create or replace function public.notify_gathering_interest()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  gathering_host_id uuid;
  gathering_title text;
  interested_user_name text;
  host_wants_notif boolean;
  service_key text;
begin
  select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';

  select host_id, title into gathering_host_id, gathering_title from gatherings where id = new.gathering_id;
  select display_name into interested_user_name from profiles where id = new.user_id;
  select coalesce(notify_planning, true) into host_wants_notif from profiles where id = gathering_host_id;

  if host_wants_notif then
    perform net.http_post(
      url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
      body := jsonb_build_object(
        'recipient_id', gathering_host_id,
        'title', 'New interest in your gathering',
        'body', interested_user_name || ' is interested in "' || gathering_title || '"',
        'data', jsonb_build_object('type', 'gathering_interest', 'gathering_id', new.gathering_id)
      )
    );
  end if;
  return new;
end;
$function$;

-- Item 6: social_offer_received/social_offer_responded already carry a
-- real named person + real offer text (satisfies 48), but the only real
-- consumer-facing surface for a social offer is GroupPlanScreen (keyed by
-- proposalId, per groupPlans.js's getGroupPlanDetail() -- social offers are
-- scoped to a group plan's own resulting_request_id). The payload only ever
-- carried request_id/offer_id, so there was no way for a tap to reach that
-- screen at all. Both functions gain the same one-line lookup: the group
-- plan proposal whose resulting_request_id matches this business_requests
-- row (a request can only ever result from at most one proposal, per
-- propose_group_plan's own creation path -- confirmed via
-- pg_get_functiondef before writing this: resulting_request_id is set
-- exactly once, at group-plan confirmation). A request created outside the
-- group-plan flow (a plain Ask Nearby Businesses post) correctly yields
-- null here -- honest, no fabricated proposal_id -- and the client's
-- existing GroupPlan-family case already only navigates when proposal_id is
-- present.
create or replace function public.submit_social_offer(request_id_param uuid, offer_description_param text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_request record;
  v_offer_id uuid;
  v_eligible boolean;
  service_key text;
  v_offerer_name text;
  v_proposal_id uuid;
begin
  if offer_description_param is null or length(trim(offer_description_param)) = 0 then
    raise exception 'Describe what you can offer.';
  end if;

  select * into v_request from business_requests where id = request_id_param;
  if v_request is null then
    raise exception 'Request not found.';
  end if;
  if v_request.requester_id = auth.uid() then
    raise exception 'You cannot make a social offer on your own request.';
  end if;
  if v_request.status <> 'open' then
    raise exception 'This request is no longer open.';
  end if;

  select (
    not is_blocked(auth.uid(), v_request.requester_id)
    and (
      exists (
        select 1 from friendships f
        where f.status = 'accepted'
        and ((f.user_a = auth.uid() and f.user_b = v_request.requester_id) or (f.user_a = v_request.requester_id and f.user_b = auth.uid()))
      )
      or exists (
        select 1 from matches m
        where (m.user_a = auth.uid() and m.user_b = v_request.requester_id) or (m.user_a = v_request.requester_id and m.user_b = auth.uid())
      )
      or exists (
        select 1 from community_members cm1
        join community_members cm2 on cm1.community_id = cm2.community_id
        where cm1.user_id = auth.uid() and cm2.user_id = v_request.requester_id
      )
      or exists (
        select 1
        from (
          select gathering_id from gathering_interest where user_id = auth.uid() and status = 'approved'
          union
          select id as gathering_id from gatherings where host_id = auth.uid()
        ) mine
        join (
          select gathering_id from gathering_interest where user_id = v_request.requester_id and status = 'approved'
          union
          select id as gathering_id from gatherings where host_id = v_request.requester_id
        ) theirs on mine.gathering_id = theirs.gathering_id
      )
    )
  ) into v_eligible;

  if not v_eligible then
    raise exception 'You need to already be connected to this person to make them an offer.';
  end if;

  insert into social_offers (request_id, offerer_id, offer_description, status)
  values (request_id_param, auth.uid(), trim(offer_description_param), 'offered')
  on conflict (request_id, offerer_id) do update
    set offer_description = excluded.offer_description, status = 'offered',
        responded_at = null, viewed_at = null, created_at = now()
    where social_offers.status in ('withdrawn', 'declined', 'expired', 'cancelled')
  returning id into v_offer_id;

  if v_offer_id is null then
    raise exception 'You already made an offer on this request.';
  end if;

  select id into v_proposal_id from group_plan_proposals where resulting_request_id = request_id_param limit 1;

  select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';
  select display_name into v_offerer_name from profiles where id = auth.uid();
  if service_key is not null and coalesce((select notify_planning from profiles where id = v_request.requester_id), true) then
    perform net.http_post(
      url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
      body := jsonb_build_object(
        'recipient_id', v_request.requester_id,
        'title', 'Someone offered to help!',
        'body', coalesce(v_offerer_name, 'Someone you know') || ' made you a social offer: "' || left(trim(offer_description_param), 60) || '"',
        'data', jsonb_build_object('type', 'social_offer_received', 'request_id', request_id_param, 'offer_id', v_offer_id, 'proposal_id', v_proposal_id)
      )
    );
  end if;

  return jsonb_build_object('success', true, 'offerId', v_offer_id);
end;
$function$;

create or replace function public.respond_to_social_offer(offer_id_param uuid, accept_param boolean)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_offer_id uuid;
  v_offerer_id uuid;
  v_request_id uuid;
  service_key text;
  v_requester_name text;
  v_proposal_id uuid;
begin
  select so.id, so.offerer_id, so.request_id
  into v_offer_id, v_offerer_id, v_request_id
  from social_offers so
  join business_requests br on br.id = so.request_id
  where so.id = offer_id_param
  and br.requester_id = auth.uid()
  and so.status = 'offered'
  for update of so;

  if v_offer_id is null then
    raise exception 'Offer not found or already responded to.';
  end if;

  update social_offers
  set status = case when accept_param then 'accepted' else 'declined' end,
      responded_at = now()
  where id = v_offer_id;

  select id into v_proposal_id from group_plan_proposals where resulting_request_id = v_request_id limit 1;

  select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';
  select display_name into v_requester_name from profiles where id = auth.uid();
  if service_key is not null and coalesce((select notify_planning from profiles where id = v_offerer_id), true) then
    perform net.http_post(
      url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
      body := jsonb_build_object(
        'recipient_id', v_offerer_id,
        'title', case when accept_param then 'Your offer was accepted! 🎉' else 'An update on your offer' end,
        'body', coalesce(v_requester_name, 'Someone') || case when accept_param then ' accepted your offer.' else ' went a different way this time -- thanks for offering.' end,
        'data', jsonb_build_object('type', 'social_offer_responded', 'offer_id', v_offer_id, 'accepted', accept_param, 'proposal_id', v_proposal_id)
      )
    );
  end if;

  return jsonb_build_object('success', true, 'status', case when accept_param then 'accepted' else 'declined' end);
end;
$function$;

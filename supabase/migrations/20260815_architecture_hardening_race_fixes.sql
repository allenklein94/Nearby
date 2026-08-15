-- 10/10 roadmap Part 3: architecture hardening (see CLAUDE.md's "10/10
-- roadmap" plan and PRODUCT_AUDIT/ARCHITECTURE_HARDENING_AUDIT_2026-08-15.md).
-- Two real, confirmed races found by reading every live state-machine RPC
-- directly, not by guessing -- both fixed here, same signature, same
-- CREATE OR REPLACE convention as every other RPC fix in this schema.

-- Bug 1: accept_business_offer() read business_request_offers WITHOUT a
-- row lock, checked v_offer.status <> 'offered' against that stale
-- unlocked read, then much later did a BLIND `update ... where id =
-- offer_id_param` with no re-check of current status at write time. A
-- concurrent decline_business_offer()/submit_business_offer() (both of
-- which correctly lock the offer row via `for update`) or the
-- expire_stale_business_requests() cron, committing in the window between
-- accept's initial read and its final blind update, would be silently
-- overwritten back to 'accepted' -- a genuinely declined or expired offer
-- could still end up accepted. Fixed by locking the offer row `for
-- update` at the very first read, so the status check reflects the truly
-- current value and any concurrent writer blocks/serializes against it,
-- exactly like every sibling function on this same table already does.
create or replace function public.accept_business_offer(offer_id_param uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_offer record;
  v_request record;
  v_availability record;
  v_managing_profiles uuid[];
  service_key text;
begin
  select * into v_offer from business_request_offers where id = offer_id_param for update;
  if v_offer is null then
    raise exception 'Offer not found.';
  end if;

  select * into v_request from business_requests where id = v_offer.request_id for update;
  if v_request is null then
    raise exception 'Request not found.';
  end if;
  if v_request.requester_id <> auth.uid() then
    raise exception 'You do not own this request.';
  end if;
  if v_request.status <> 'open' then
    raise exception 'This request has already been resolved.';
  end if;
  if v_offer.status <> 'offered' then
    raise exception 'This offer is no longer available.';
  end if;

  if v_offer.availability_id is not null then
    select * into v_availability from business_availability where id = v_offer.availability_id for update;
    if v_availability is not null and v_availability.remaining_capacity is not null then
      if v_availability.remaining_capacity <= 0 then
        raise exception 'This availability just filled up.';
      end if;
      update business_availability
      set remaining_capacity = remaining_capacity - 1,
          status = case when remaining_capacity - 1 <= 0 then 'filled' else status end
      where id = v_offer.availability_id;
    end if;
  end if;

  update business_request_offers
  set status = 'accepted', accepted_at = now()
  where id = offer_id_param;

  update business_request_offers
  set status = 'expired'
  where request_id = v_request.id
  and id <> offer_id_param
  and status in ('pending', 'offered');

  update business_requests
  set status = 'fulfilled'
  where id = v_request.id;

  select array_agg(id) into v_managing_profiles from profiles where managed_partner_id = v_offer.partner_id;
  if v_managing_profiles is not null then
    select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';
    for i in 1 .. array_length(v_managing_profiles, 1) loop
      perform net.http_post(
        url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
        body := jsonb_build_object(
          'recipient_id', v_managing_profiles[i],
          'title', 'Your offer was accepted!',
          'body', 'A customer accepted your offer on "' || left(v_request.raw_text, 60) || '"',
          'data', jsonb_build_object('type', 'business_offer_accepted', 'request_id', v_request.id, 'offer_id', offer_id_param)
        )
      );
    end loop;
  end if;

  return jsonb_build_object('success', true);
end;
$function$;

-- Bug 2: approve_gathering_interest() never checked the interest row's own
-- current status, and never locked it -- it always re-ran the full
-- approve/waitlist logic against whatever the row's gathering_id/user_id
-- were, unconditionally overwriting status. A retried/double-tapped call
-- on an already-approved row would re-count v_approved_count *including
-- itself*, and at exactly-at-capacity could silently demote an already-
-- approved attendee back to 'waitlisted'. Fixed by locking the interest
-- row and requiring status = 'pending', matching the same double-review
-- guard this schema already uses elsewhere (business_partner_requests,
-- id_verification_submissions) for the identical risk shape. No existing
-- client caller (services/gatherings.js's approveInterest()) ever calls
-- this on a non-pending row on purpose -- there is no decline/re-approve
-- flow for gathering_interest -- so this guard closes a real risk with no
-- legitimate path affected.
create or replace function public.approve_gathering_interest(interest_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_gathering_id uuid;
  v_interested_user_id uuid;
  v_current_status text;
  v_host_id uuid;
  v_women_only boolean;
  v_capacity integer;
  v_interested_gender text;
  v_new_match_id uuid;
  v_is_blocked boolean;
  v_approved_count integer;
begin
  select gathering_id, user_id, status into v_gathering_id, v_interested_user_id, v_current_status
  from gathering_interest where id = interest_id for update;

  if v_gathering_id is null then
    raise exception 'Interest request not found';
  end if;
  if v_current_status <> 'pending' then
    raise exception 'This request has already been reviewed';
  end if;

  select host_id, women_only, capacity into v_host_id, v_women_only, v_capacity
  from gatherings where id = v_gathering_id for update;

  if v_host_id != auth.uid() then
    raise exception 'Only the host can approve interest';
  end if;
  if v_host_id = v_interested_user_id then
    raise exception 'Cannot match with yourself';
  end if;
  if v_women_only then
    select gender into v_interested_gender from profiles where id = v_interested_user_id;
    if lower(coalesce(v_interested_gender, '')) not in ('female', 'woman') then
      raise exception 'This gathering is women-only';
    end if;
  end if;
  select exists(
    select 1 from blocks where (blocker_id = v_host_id and blocked_id = v_interested_user_id)
    or (blocker_id = v_interested_user_id and blocked_id = v_host_id)
  ) into v_is_blocked;
  if v_is_blocked then
    raise exception 'Cannot approve interest from a blocked user';
  end if;

  select count(*) into v_approved_count from gathering_interest
  where gathering_id = v_gathering_id and status = 'approved';

  if v_capacity is not null and v_approved_count >= v_capacity then
    update gathering_interest set status = 'waitlisted' where id = interest_id;
    return jsonb_build_object('status', 'waitlisted', 'match_id', null);
  end if;

  update gathering_interest set status = 'approved' where id = interest_id;
  insert into matches (user_a, user_b, source_gathering_id)
  values (least(v_host_id, v_interested_user_id), greatest(v_host_id, v_interested_user_id), v_gathering_id)
  on conflict (user_a, user_b) do update
    set source_gathering_id = v_gathering_id
    where matches.source_gathering_id is null
  returning id into v_new_match_id;
  if v_new_match_id is null then
    select id into v_new_match_id from matches
    where user_a = least(v_host_id, v_interested_user_id) and user_b = greatest(v_host_id, v_interested_user_id);
  end if;
  return jsonb_build_object('status', 'approved', 'match_id', v_new_match_id);
end;
$function$;

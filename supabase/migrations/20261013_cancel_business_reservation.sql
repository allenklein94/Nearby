-- Item 50 (CLAUDE.md, "state consistency audit"), Finding 5 / fix 5: a real
-- "cancel a confirmed reservation" path, for either party, direct user
-- request (AskUserQuestion, 2026-09-11 -- "build it now" over "leave it
-- disclosed"). Once an offer moves to 'accepted' (business_reservations
-- 'confirmed'), no code path anywhere could move it any further except
-- complete_business_reservation() -- there was genuinely no way to
-- represent "this fell through" once accepted. This closes that gap
-- mirroring complete_business_reservation()'s own dual-auth shape
-- (requester OR the business's own managed_partner_id).
--
-- Real-money boundary (CLAUDE.md standing rule: "Real external accounts /
-- real money... always need the user present for that decision"): this RPC
-- deliberately REFUSES to cancel once business_payments.status is
-- 'captured' (money has actually moved) or 'authorized' (a live Stripe
-- hold/commitment exists, even though nothing in this schema currently
-- produces that status) -- those need a human-supervised refund via the
-- business directly, not an automated one. Only 'not_required' and
-- 'pending' (no real Stripe charge has happened yet) are cancellable
-- automatically.

-- business_payments never had a 'cancelled' terminal value -- reusing
-- 'failed' would misrepresent an intentional cancellation as a failed
-- charge attempt to anyone reading payment history later.
alter table public.business_payments drop constraint business_payments_status_check;
alter table public.business_payments
  add constraint business_payments_status_check
  check (status in ('not_required', 'pending', 'authorized', 'captured', 'failed', 'refunded', 'cancelled'));

-- Matches this table's own existing accepted_at/completed_at/responded_at
-- timestamp-per-transition columns.
alter table public.business_request_offers add column if not exists cancelled_at timestamptz;

create or replace function public.cancel_business_reservation(offer_id_param uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_offer record;
  v_request record;
  v_reservation record;
  v_payment_id uuid;
  v_payment_blocked boolean;
  v_partner_id uuid;
  v_is_business boolean;
  v_partner_name text;
  v_managing_profiles uuid[];
  service_key text;
begin
  select * into v_offer from business_request_offers where id = offer_id_param for update;
  if v_offer is null then
    raise exception 'Offer not found.';
  end if;
  if v_offer.status <> 'accepted' then
    raise exception 'This reservation is not in a state that can be cancelled.';
  end if;

  select * into v_reservation from business_reservations where offer_id = offer_id_param for update;
  if v_reservation is null or v_reservation.status <> 'confirmed' then
    raise exception 'This reservation is not in a state that can be cancelled.';
  end if;

  select * into v_request from business_requests where id = v_offer.request_id for update;

  select managed_partner_id into v_partner_id from profiles where id = auth.uid();
  if v_partner_id is not null and v_partner_id = v_offer.partner_id then
    v_is_business := true;
  elsif auth.uid() = v_request.requester_id then
    v_is_business := false;
  else
    raise exception 'You are not part of this reservation.';
  end if;

  select id into v_payment_id from business_payments where reservation_id = v_reservation.id for update;
  -- Pure SQL-side check + update rather than comparing a fetched record's
  -- field in PL/pgSQL -- kept this way after the shipped fix's own live
  -- verification (see CLAUDE_HISTORY.md, Item 50 fix 5) traced an earlier
  -- session's "silent no-op" scare to a mundane cause: business_payments'
  -- own CHECK constraint didn't allow 'cancelled' yet (added by this same
  -- migration, just above) until it was actually applied, so any UPDATE
  -- setting that value simply failed its constraint in every ad-hoc test
  -- run before the migration went live. Not a PL/pgSQL engine bug.
  select exists(
    select 1 from business_payments where id = v_payment_id and status in ('captured', 'authorized')
  ) into v_payment_blocked;
  if v_payment_blocked then
    raise exception 'This reservation has already been paid for. Contact the business directly to arrange a refund.';
  end if;

  update business_request_offers set status = 'cancelled', cancelled_at = now() where id = offer_id_param;
  update business_reservations set status = 'cancelled' where id = v_reservation.id;
  update business_payments set status = 'cancelled'
    where id = v_payment_id and status in ('not_required', 'pending');

  -- Undo accept_business_offer()'s own capacity decrement/auto-fill,
  -- exactly symmetric to that function's own logic.
  if v_offer.availability_id is not null then
    update business_availability
    set remaining_capacity = case when remaining_capacity is not null then remaining_capacity + 1 else remaining_capacity end,
        status = case when status = 'filled' and remaining_capacity is not null then 'active' else status end
    where id = v_offer.availability_id;
  end if;

  select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';

  -- Two distinct type strings, not one shared one: the same event notifies
  -- different roles on each side, and each role needs a different tap
  -- destination (consumer -> the request detail; business -> its
  -- dashboard) -- items 48/49's own "reason + action" discipline requires
  -- the payload alone (routeNotificationTap has no user context) to
  -- unambiguously determine where a tap should land.
  if v_is_business then
    if coalesce((select notify_business from profiles where id = v_request.requester_id), true) then
      perform net.http_post(
        url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
        body := jsonb_build_object(
          'recipient_id', v_request.requester_id,
          'title', 'Your reservation was cancelled',
          'body', 'The business cancelled your reservation for "' || left(v_request.raw_text, 60) || '"',
          'data', jsonb_build_object('type', 'business_reservation_cancelled', 'request_id', v_request.id, 'offer_id', offer_id_param)
        )
      );
    end if;
  else
    select name into v_partner_name from brand_partners where id = v_offer.partner_id;
    select array_agg(id) into v_managing_profiles from profiles where managed_partner_id = v_offer.partner_id;
    if v_managing_profiles is not null then
      for i in 1 .. array_length(v_managing_profiles, 1) loop
        continue when not coalesce((select notify_business from profiles where id = v_managing_profiles[i]), true);
        perform net.http_post(
          url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
          headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
          body := jsonb_build_object(
            'recipient_id', v_managing_profiles[i],
            'title', 'A reservation was cancelled',
            'body', 'A customer cancelled their reservation for "' || left(v_request.raw_text, 60) || '"',
            'data', jsonb_build_object('type', 'reservation_cancelled_by_customer', 'request_id', v_request.id, 'offer_id', offer_id_param)
          )
        );
      end loop;
    end if;
  end if;

  return jsonb_build_object('success', true);
end;
$function$;

revoke all on function public.cancel_business_reservation(uuid) from public, anon;
grant execute on function public.cancel_business_reservation(uuid) to authenticated;

-- Sponsored placement, PHASE 2 (Stripe test-mode checkout). Design: PRODUCT_AUDIT/SPONSORED_PLACEMENT_DESIGN_2026-09-20.md.
-- The database owns every state change. Only these SECURITY DEFINER functions move a placement/payment, and the
-- payment-state ones are service_role only (called by the checkout function and the signature-verified webhook), so a
-- client can never mark anything paid. Purchasing is impossible until the owner adds a category to the allow-list.
-- No refund/cancel-after-payment path here (phase 3): late or mismatched money is only FLAGGED (refund_due).
alter table public.sponsored_payments
  add column if not exists refund_due boolean not null default false;

-- Housekeeping: abandoned holds free their slot, placements move scheduled -> active -> completed by time.
-- (Serving never depends on this; it re-checks the time window itself.)
create or replace function public.sponsored_sweep()
returns void language plpgsql volatile security definer set search_path to 'public' as $$
begin
  update sponsored_payments y set status = 'failed'
    from sponsored_placements p
    where y.placement_id = p.id and y.status = 'pending' and p.status = 'awaiting_payment'
      and p.created_at < now() - interval '24 hours';
  update sponsored_placements set status = 'expired_unpaid'
    where status = 'awaiting_payment' and created_at < now() - interval '24 hours';
  update sponsored_placements set status = 'active'
    where status = 'scheduled' and starts_at <= now() and ends_at > now();
  update sponsored_placements set status = 'completed'
    where status in ('scheduled', 'active') and ends_at <= now();
end $$;

-- The one eligibility/availability check, shared by the owner's pre-check and the purchase itself. NULL = purchasable.
create or replace function public._sponsored_purchase_problem(partner_param uuid, starts_param timestamptz)
returns text language plpgsql volatile security definer set search_path to 'public' as $$
declare
  bp record;
  v_today timestamptz := date_trunc('day', now() at time zone 'utc') at time zone 'utc';
begin
  perform sponsored_sweep();
  select id, active, latitude, longitude, category into bp from brand_partners where id = partner_param;
  if not found or bp.active is not true then return 'business_inactive'; end if;
  if bp.latitude is null or bp.longitude is null then return 'needs_address'; end if;
  if bp.category is null
     or not exists (select 1 from sponsorable_category_groups a where a.group_key = bp.category) then
    return 'category_not_sponsorable';
  end if;
  -- a start DATE (00:00 UTC), at least tomorrow (so "full refund before the start" is meaningful), at most 60 days out
  if starts_param <> date_trunc('day', starts_param at time zone 'utc') at time zone 'utc' then return 'bad_start'; end if;
  if starts_param < v_today + interval '1 day' or starts_param > v_today + interval '60 days' then return 'bad_start'; end if;
  if exists (select 1 from sponsored_placements p where p.partner_id = partner_param
             and p.status in ('awaiting_payment', 'scheduled', 'active', 'paused')) then
    return 'already_holding';
  end if;
  if exists (select 1 from sponsored_placements p
             where p.area_key = sponsored_area_key(bp.latitude, bp.longitude) and p.category_group = bp.category
               and p.status in ('awaiting_payment', 'scheduled', 'active', 'paused')
               and tstzrange(p.starts_at, p.ends_at) && tstzrange(starts_param, starts_param + interval '7 days')) then
    return 'slot_taken';
  end if;
  return null;
end $$;

-- Owner pre-check (drives the Promotions card). Read-only apart from the housekeeping sweep.
create or replace function public.check_my_sponsored_slot(starts_param timestamptz default null)
returns jsonb language plpgsql volatile security definer set search_path to 'public' as $$
declare
  v_partner uuid;
  v_problem text;
  v_price record;
  v_cat text;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  select managed_partner_id into v_partner from profiles where id = auth.uid();
  if v_partner is null then return jsonb_build_object('ok', false, 'problem', 'not_a_business_owner'); end if;
  select amount_cents, currency into v_price from sponsored_price where id;
  select category into v_cat from brand_partners where id = v_partner;
  if starts_param is null then
    -- eligibility only (no date chosen yet)
    v_problem := _sponsored_purchase_problem(v_partner, date_trunc('day', now() at time zone 'utc') at time zone 'utc' + interval '1 day');
    if v_problem in ('bad_start', 'slot_taken') then v_problem := null; end if;
  else
    v_problem := _sponsored_purchase_problem(v_partner, starts_param);
  end if;
  return jsonb_build_object('ok', v_problem is null, 'problem', v_problem, 'amount_cents', v_price.amount_cents,
                            'currency', v_price.currency, 'category_group', v_cat);
end $$;

-- Creates the held placement + pending payment. service_role only: the checkout function has already authenticated the
-- caller and screened the text (screening_tier must arrive as 'low').
create or replace function public.sponsored_begin_purchase(
  user_id_param uuid, item_kind_param text, item_id_param uuid, starts_param timestamptz,
  title_param text, description_param text, screening_tier_param text
) returns table (placement_id uuid, payment_id uuid, amount_cents integer, currency text)
language plpgsql volatile security definer set search_path to 'public' as $$
#variable_conflict use_column
declare
  v_partner uuid;
  v_problem text;
  v_item uuid;
  v_price record;
  v_place uuid;
  v_pay uuid;
begin
  select managed_partner_id into v_partner from profiles where id = user_id_param;
  if v_partner is null then raise exception 'sponsored:not_a_business_owner'; end if;
  if screening_tier_param is distinct from 'low' then raise exception 'sponsored:screening_not_clean'; end if;
  v_problem := _sponsored_purchase_problem(v_partner, starts_param);
  if v_problem is not null then raise exception 'sponsored:%', v_problem; end if;
  if item_kind_param = 'offer' then
    if not exists (select 1 from brand_offers o where o.id = item_id_param and o.partner_id = v_partner and o.active = true
                   and (o.expires_at is null or o.expires_at > now())) then
      raise exception 'sponsored:bad_item';
    end if;
    v_item := item_id_param;
  elsif item_kind_param = 'business' then
    v_item := v_partner;
  else
    raise exception 'sponsored:bad_item';
  end if;
  select sp.amount_cents, sp.currency into v_price from sponsored_price sp where sp.id;
  begin
    insert into sponsored_placements (partner_id, item_kind, item_id, area_key, category_group, starts_at, ends_at,
                                      status, title, description, screening_tier, created_by)
    values (v_partner, item_kind_param, v_item, '', '', starts_param, starts_param + interval '7 days',
            'awaiting_payment', btrim(title_param), nullif(btrim(coalesce(description_param, '')), ''), 'low', user_id_param)
    returning id into v_place;
  exception
    when exclusion_violation then raise exception 'sponsored:slot_taken';
    when unique_violation then raise exception 'sponsored:already_holding';
  end;
  insert into sponsored_payments (placement_id, amount_cents, currency, status)
    values (v_place, v_price.amount_cents, v_price.currency, 'pending') returning id into v_pay;
  return query select v_place, v_pay, v_price.amount_cents, v_price.currency;
end $$;

create or replace function public.sponsored_attach_checkout_session(payment_id_param uuid, session_id_param text)
returns void language sql volatile security definer set search_path to 'public' as $$
  update sponsored_payments set stripe_checkout_session_id = session_id_param
   where id = payment_id_param and status = 'pending';
$$;

-- Stripe could not create the session: nothing was charged, release the hold.
create or replace function public.sponsored_release_hold(payment_id_param uuid)
returns void language plpgsql volatile security definer set search_path to 'public' as $$
declare v_place uuid;
begin
  update sponsored_payments set status = 'failed' where id = payment_id_param and status = 'pending' returning placement_id into v_place;
  if v_place is not null then
    update sponsored_placements set status = 'payment_failed' where id = v_place and status = 'awaiting_payment';
  end if;
end $$;

-- The ONLY path to paid. Called by the verified webhook. Idempotent.
--   paid | already_paid | refund_due (money arrived but the placement can no longer run) | amount_mismatch | unknown_session
create or replace function public.sponsored_mark_paid(
  session_id_param text, payment_intent_param text, amount_total_param integer, currency_param text
) returns text language plpgsql volatile security definer set search_path to 'public' as $$
declare
  y record;
  p record;
begin
  select * into y from sponsored_payments where stripe_checkout_session_id = session_id_param for update;
  if not found then return 'unknown_session'; end if;
  if y.status = 'paid' then return 'already_paid'; end if;
  if amount_total_param is distinct from y.amount_cents or lower(coalesce(currency_param, '')) <> lower(y.currency) then
    update sponsored_payments set refund_due = true where id = y.id;
    return 'amount_mismatch';
  end if;
  select * into p from sponsored_placements where id = y.placement_id for update;
  if p.status <> 'awaiting_payment' then
    -- the hold expired or was cancelled before the money arrived: record it, never serve it, flag for a refund
    update sponsored_payments set status = 'paid', paid_at = now(), stripe_payment_intent_id = payment_intent_param,
      refund_due = true where id = y.id;
    return 'refund_due';
  end if;
  update sponsored_payments set status = 'paid', paid_at = now(), stripe_payment_intent_id = payment_intent_param where id = y.id;
  update sponsored_placements set status = case when starts_at <= now() then 'active' else 'scheduled' end where id = p.id;
  return 'paid';
end $$;

-- Session expired or async payment failed: free the slot.
create or replace function public.sponsored_mark_unpaid(session_id_param text, failed_param boolean default false)
returns void language plpgsql volatile security definer set search_path to 'public' as $$
declare v_place uuid;
begin
  update sponsored_payments set status = 'failed'
   where stripe_checkout_session_id = session_id_param and status = 'pending' returning placement_id into v_place;
  if v_place is not null then
    update sponsored_placements set status = case when failed_param then 'payment_failed' else 'expired_unpaid' end
     where id = v_place and status = 'awaiting_payment';
  end if;
end $$;

-- Refund reported by Stripe. Serving stops immediately (the predicate needs status = 'paid').
create or replace function public.sponsored_mark_refunded(payment_intent_param text, refunded_cents_param integer)
returns void language plpgsql volatile security definer set search_path to 'public' as $$
declare y record;
begin
  select * into y from sponsored_payments where stripe_payment_intent_id = payment_intent_param for update;
  if not found then return; end if;
  update sponsored_payments set refunded_cents = greatest(y.refunded_cents, coalesce(refunded_cents_param, 0)),
    status = case when coalesce(refunded_cents_param, 0) >= y.amount_cents then 'refunded' else 'partially_refunded' end,
    refund_due = false
   where id = y.id;
  if coalesce(refunded_cents_param, 0) >= y.amount_cents then
    update sponsored_placements set status = 'refunded' where id = y.placement_id and status <> 'completed';
  else
    update sponsored_placements set status = 'paused' where id = y.placement_id and status in ('scheduled', 'active');
  end if;
end $$;

create or replace function public.sponsored_mark_disputed(payment_intent_param text)
returns void language plpgsql volatile security definer set search_path to 'public' as $$
declare y record;
begin
  select * into y from sponsored_payments where stripe_payment_intent_id = payment_intent_param for update;
  if not found then return; end if;
  update sponsored_payments set status = 'disputed' where id = y.id;
  update sponsored_placements set status = 'paused' where id = y.placement_id and status in ('scheduled', 'active');
end $$;

-- Owner walks away from an UNPAID hold (frees the slot). A paid placement cannot be cancelled here (phase 3).
create or replace function public.cancel_my_sponsored_hold(placement_id_param uuid)
returns boolean language plpgsql volatile security definer set search_path to 'public' as $$
declare v_partner uuid; n integer;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  select managed_partner_id into v_partner from profiles where id = auth.uid();
  update sponsored_placements set status = 'cancelled'
   where id = placement_id_param and partner_id = v_partner and status = 'awaiting_payment';
  get diagnostics n = row_count;
  if n = 1 then
    update sponsored_payments set status = 'failed' where placement_id = placement_id_param and status = 'pending';
  end if;
  return n = 1;
end $$;

-- The owner's own placements and their payment state. Never another business's, never any viewer data.
create or replace function public.get_my_sponsored_placements()
returns table (
  placement_id uuid, item_kind text, title text, description text, starts_at timestamptz, ends_at timestamptz,
  status text, payment_status text, amount_cents integer, currency text, created_at timestamptz
)
language plpgsql stable security definer set search_path to 'public' as $$
#variable_conflict use_column
declare v_partner uuid;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  select managed_partner_id into v_partner from profiles where id = auth.uid();
  if v_partner is null then return; end if;
  return query
    select p.id, p.item_kind, p.title, p.description, p.starts_at, p.ends_at, p.status,
           (select y.status from sponsored_payments y where y.placement_id = p.id order by y.created_at desc limit 1),
           (select y.amount_cents from sponsored_payments y where y.placement_id = p.id order by y.created_at desc limit 1),
           (select y.currency from sponsored_payments y where y.placement_id = p.id order by y.created_at desc limit 1),
           p.created_at
    from sponsored_placements p where p.partner_id = v_partner order by p.created_at desc limit 20;
end $$;

revoke all on function public.sponsored_sweep() from public, anon, authenticated;
revoke all on function public._sponsored_purchase_problem(uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.sponsored_begin_purchase(uuid, text, uuid, timestamptz, text, text, text) from public, anon, authenticated;
revoke all on function public.sponsored_attach_checkout_session(uuid, text) from public, anon, authenticated;
revoke all on function public.sponsored_release_hold(uuid) from public, anon, authenticated;
revoke all on function public.sponsored_mark_paid(text, text, integer, text) from public, anon, authenticated;
revoke all on function public.sponsored_mark_unpaid(text, boolean) from public, anon, authenticated;
revoke all on function public.sponsored_mark_refunded(text, integer) from public, anon, authenticated;
revoke all on function public.sponsored_mark_disputed(text) from public, anon, authenticated;
revoke all on function public.check_my_sponsored_slot(timestamptz) from public, anon;
revoke all on function public.cancel_my_sponsored_hold(uuid) from public, anon;
revoke all on function public.get_my_sponsored_placements() from public, anon;
grant execute on function public.sponsored_sweep() to service_role;
grant execute on function public.sponsored_begin_purchase(uuid, text, uuid, timestamptz, text, text, text) to service_role;
grant execute on function public.sponsored_attach_checkout_session(uuid, text) to service_role;
grant execute on function public.sponsored_release_hold(uuid) to service_role;
grant execute on function public.sponsored_mark_paid(text, text, integer, text) to service_role;
grant execute on function public.sponsored_mark_unpaid(text, boolean) to service_role;
grant execute on function public.sponsored_mark_refunded(text, integer) to service_role;
grant execute on function public.sponsored_mark_disputed(text) to service_role;
grant execute on function public.check_my_sponsored_slot(timestamptz) to authenticated, service_role;
grant execute on function public.cancel_my_sponsored_hold(uuid) to authenticated, service_role;
grant execute on function public.get_my_sponsored_placements() to authenticated, service_role;

select cron.schedule('sponsored-sweep', '5 * * * *', 'select sponsored_sweep();');

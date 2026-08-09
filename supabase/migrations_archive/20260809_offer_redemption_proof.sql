-- Audit item 7/8 (PRODUCT_AUDIT/CRITICAL_MISSING_FEATURES.md #8): no proof-of-
-- redemption mechanism existed anywhere. redeemOffer() was (and still is, for the
-- claim step) a plain client-side insert into offer_redemptions with nothing
-- confirming the business side of the transaction ever actually happened — and
-- the monthly billing math (generate_monthly_invoices / get_partner_billing_estimate)
-- counted every one of those unconfirmed rows as billable, inheriting the same
-- trust gap. This adds a real (low-tech, no camera/QR infra needed) confirmation
-- step: claiming an offer generates a short code shown to the user, a business
-- owner enters that code in their own dashboard to confirm the visit actually
-- happened, and only confirmed redemptions count toward billing going forward.

alter table offer_redemptions
  add column confirmation_code text default lpad(floor(random() * 1000000)::text, 6, '0'),
  add column confirmed_at timestamptz,
  add column confirmed_by uuid references profiles(id);

-- Only one *pending* code can be outstanding with a given digit string at a
-- time (once confirmed, its code can be freely reused by a later redemption)
-- so a business owner typing a 6-digit code always resolves to exactly one
-- real, still-open redemption.
create unique index offer_redemptions_pending_code_key
  on offer_redemptions (confirmation_code)
  where confirmed_at is null;

-- Defensive tightening of the existing client-INSERT policy: a client could
-- otherwise pass confirmed_at/confirmed_by directly in the insert payload and
-- self-confirm its own redemption, defeating the whole point of this table.
-- No existing legitimate insert ever sets either column, so this changes
-- nothing for the real flow.
drop policy "Users can redeem offers they're eligible for" on offer_redemptions;
create policy "Users can redeem offers they're eligible for"
  on offer_redemptions for insert
  to authenticated
  with check (
    auth.uid() = user_id
    and confirmed_at is null
    and confirmed_by is null
    and exists (
      select 1 from brand_offers bo
      where bo.id = offer_redemptions.offer_id
        and bo.active = true
        and (bo.expires_at is null or bo.expires_at > now())
        and (
          bo.gathering_id is null
          or exists (
            select 1 from gathering_interest gi
            where gi.gathering_id = bo.gathering_id
              and gi.user_id = auth.uid()
              and gi.status = 'approved'
          )
        )
    )
  );

create or replace function confirm_offer_redemption(code_param text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_redemption record;
  v_offer record;
begin
  select r.* into v_redemption
  from offer_redemptions r
  where r.confirmation_code = code_param and r.confirmed_at is null;

  if v_redemption is null then
    return jsonb_build_object('success', false, 'error', 'No pending redemption found with that code.');
  end if;

  select o.*, bp.name as partner_name into v_offer
  from brand_offers o
  join brand_partners bp on bp.id = o.partner_id
  where o.id = v_redemption.offer_id;

  if not exists (
    select 1 from profiles p where p.id = auth.uid() and p.managed_partner_id = v_offer.partner_id
  ) then
    return jsonb_build_object('success', false, 'error', 'That code isn''t for one of your offers.');
  end if;

  update offer_redemptions
  set confirmed_at = now(), confirmed_by = auth.uid()
  where id = v_redemption.id;

  return jsonb_build_object(
    'success', true,
    'offerTitle', v_offer.title,
    'redeemedByName', (select display_name from profiles where id = v_redemption.user_id)
  );
end;
$$;

revoke all on function confirm_offer_redemption(text) from public, anon;
grant execute on function confirm_offer_redemption(text) to authenticated;

-- Only confirmed redemptions are real, billable proof of a visit — everything
-- downstream of this (invoices, the owner's own live estimate) now trusts
-- confirmed_at, not just the existence of a row.
create or replace function generate_monthly_invoices(period_start_param date default null::date, period_end_param date default null::date)
returns setof business_invoices
language plpgsql
security definer
set search_path = public
as $$
declare
  v_period_start date;
  v_period_end date;
  v_contract record;
  v_effective_start date;
  v_effective_end date;
  v_redemption_ids uuid[];
  v_redemption_count int;
  v_billable_count int;
  v_amount numeric(10,2);
  v_invoice business_invoices%rowtype;
begin
  v_period_start := coalesce(period_start_param, date_trunc('month', now() - interval '1 month')::date);
  v_period_end := coalesce(period_end_param, (date_trunc('month', now()) - interval '1 day')::date);

  for v_contract in
    select distinct on (partner_id) *
    from partner_contracts
    where status = 'active'
      and contract_start <= v_period_end
      and (contract_end is null or contract_end >= v_period_start)
    order by partner_id, created_at desc
  loop
    if exists (
      select 1 from business_invoices
      where partner_id = v_contract.partner_id
        and period_start = v_period_start
        and period_end = v_period_end
    ) then
      continue;
    end if;

    v_effective_start := greatest(v_period_start, v_contract.contract_start);
    v_effective_end := least(v_period_end, coalesce(v_contract.contract_end, v_period_end));

    with locked as (
      select r.id
      from offer_redemptions r
      join brand_offers o on o.id = r.offer_id
      where o.partner_id = v_contract.partner_id
        and r.invoice_id is null
        and r.confirmed_at is not null
        and r.redeemed_at >= v_effective_start
        and r.redeemed_at < v_effective_end + interval '1 day'
      for update of r
    )
    select array_agg(id) into v_redemption_ids from locked;

    v_redemption_count := coalesce(array_length(v_redemption_ids, 1), 0);
    v_billable_count := greatest(v_redemption_count - v_contract.included_units, 0);

    v_amount := case v_contract.billing_model
      when 'per_redemption' then v_billable_count * v_contract.redemption_fee
      when 'flat_monthly' then v_contract.monthly_fee
      when 'hybrid' then v_contract.monthly_fee + (v_billable_count * v_contract.redemption_fee)
      else 0
    end;

    if v_contract.max_monthly_spend is not null then
      v_amount := least(v_amount, v_contract.max_monthly_spend);
    end if;

    insert into business_invoices (partner_id, period_start, period_end, redemption_count, amount_due, status)
    values (v_contract.partner_id, v_period_start, v_period_end, v_redemption_count, v_amount, 'draft')
    returning * into v_invoice;

    if v_redemption_ids is not null then
      update offer_redemptions set invoice_id = v_invoice.id where id = any(v_redemption_ids);
    end if;

    if v_contract.contract_end is not null and v_contract.contract_end <= v_period_end then
      if v_contract.auto_renew then
        update partner_contracts
          set contract_end = contract_end + interval '1 month'
          where id = v_contract.id;
      else
        update partner_contracts set status = 'expired' where id = v_contract.id;
      end if;
    end if;

    return next v_invoice;
  end loop;
end;
$$;

create or replace function get_partner_billing_estimate(partner_id_param uuid)
returns table(redemption_count integer, estimated_amount numeric, billing_model text, included_units integer, billable_count integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_contract record;
  v_count int;
  v_billable_count int;
  v_amount numeric(10,2);
  v_period_start date := date_trunc('month', now())::date;
  v_effective_start date;
begin
  if not exists (
    select 1 from profiles p
    where p.id = auth.uid() and p.managed_partner_id = partner_id_param
  ) then
    raise exception 'not authorized';
  end if;

  select * into v_contract
  from partner_contracts
  where partner_id = partner_id_param
    and status = 'active'
    and contract_start <= now()::date
    and (contract_end is null or contract_end >= now()::date)
  order by created_at desc
  limit 1;

  if v_contract is null then
    return query select 0, 0::numeric, null::text, 0, 0;
    return;
  end if;

  v_effective_start := greatest(v_period_start, v_contract.contract_start);

  select count(*) into v_count
  from offer_redemptions r
  join brand_offers o on o.id = r.offer_id
  where o.partner_id = partner_id_param
    and r.confirmed_at is not null
    and r.redeemed_at >= v_effective_start;

  v_billable_count := greatest(v_count - v_contract.included_units, 0);

  v_amount := case v_contract.billing_model
    when 'per_redemption' then v_billable_count * v_contract.redemption_fee
    when 'flat_monthly' then v_contract.monthly_fee
    when 'hybrid' then v_contract.monthly_fee + (v_billable_count * v_contract.redemption_fee)
    else 0
  end;

  if v_contract.max_monthly_spend is not null then
    v_amount := least(v_amount, v_contract.max_monthly_spend);
  end if;

  return query select v_count, v_amount, v_contract.billing_model, v_contract.included_units, v_billable_count;
end;
$$;

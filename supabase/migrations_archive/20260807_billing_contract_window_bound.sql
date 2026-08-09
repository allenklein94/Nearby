-- Fixes a real gap in generate_monthly_invoices() / get_partner_billing_estimate():
-- the redemption lookup was bounded only by the invoicing period, never by the
-- contract's own contract_start/contract_end. A contract starting mid-period would
-- sweep in (and permanently stamp invoice_id on) redemptions from before it existed;
-- a contract ending mid-period would do the same for redemptions after it lapsed.
-- Didn't surface in the Coastal Coffee test because that contract is open-ended and
-- predates all of its redemptions.

create or replace function public.generate_monthly_invoices(
  period_start_param date default null,
  period_end_param date default null
)
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

    -- Clip the billing window to this contract's actual active dates, so a
    -- contract that starts or ends mid-period only ever bills redemptions
    -- that happened while it was actually in force.
    v_effective_start := greatest(v_period_start, v_contract.contract_start);
    v_effective_end := least(v_period_end, coalesce(v_contract.contract_end, v_period_end));

    with locked as (
      select r.id
      from offer_redemptions r
      join brand_offers o on o.id = r.offer_id
      where o.partner_id = v_contract.partner_id
        and r.invoice_id is null
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
      else 0 -- 'custom': amount_due is NOT NULL, so this drafts at 0 and
             -- finance corrects it by hand (still 'draft' status)
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

revoke all on function public.generate_monthly_invoices(date, date) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- get_partner_billing_estimate() — same fix: clip to contract_start so a
-- contract signed mid-month doesn't retroactively bill this month's
-- pre-contract redemptions in the dashboard preview either. (contract_end
-- doesn't need clipping here: the contract selection below already
-- requires contract_end is null or >= today.)
-- ---------------------------------------------------------------------
create or replace function public.get_partner_billing_estimate(partner_id_param uuid)
returns table(
  redemption_count int,
  estimated_amount numeric,
  billing_model text,
  included_units int,
  billable_count int
)
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

revoke all on function public.get_partner_billing_estimate(uuid) from public, anon;
grant execute on function public.get_partner_billing_estimate(uuid) to authenticated;

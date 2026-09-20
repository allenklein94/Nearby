-- Business dashboard estimate: itemize base fee vs redemption charges (2026-09-20).
--
-- The dashboard showed "Estimated this month $20" beside "0 redemptions" for a
-- hybrid contract ($20 monthly fee + $1/redemption): the $20 is the fixed
-- monthly fee, but nothing said so. The amount math is UNCHANGED; this adds the
-- fee terms, the two components (base_fee_amount, redemption_amount) and a
-- capped flag so the UI can show "Monthly fee + N x $fee". Return shape
-- changes, so drop first (single overload).

drop function if exists public.get_partner_billing_estimate(uuid);

CREATE FUNCTION public.get_partner_billing_estimate(partner_id_param uuid)
 RETURNS TABLE(redemption_count integer, estimated_amount numeric, billing_model text, included_units integer, billable_count integer, monthly_fee numeric, redemption_fee numeric, base_fee_amount numeric, redemption_amount numeric, capped boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_contract record;
  v_count int;
  v_billable_count int;
  v_amount numeric(10,2);
  v_base numeric(10,2);
  v_redemption numeric(10,2);
  v_capped boolean := false;
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
    return query select 0, 0::numeric, null::text, 0, 0, null::numeric, null::numeric, 0::numeric, 0::numeric, false;
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

  -- Itemized so the client can show base fee and redemption charges
  -- separately (a fixed monthly fee is not redemption-driven).
  v_base := case when v_contract.billing_model in ('flat_monthly', 'hybrid') then coalesce(v_contract.monthly_fee, 0) else 0 end;
  v_redemption := case when v_contract.billing_model in ('per_redemption', 'hybrid') then v_billable_count * coalesce(v_contract.redemption_fee, 0) else 0 end;
  v_amount := case v_contract.billing_model
    when 'per_redemption' then v_billable_count * v_contract.redemption_fee
    when 'flat_monthly' then v_contract.monthly_fee
    when 'hybrid' then v_contract.monthly_fee + (v_billable_count * v_contract.redemption_fee)
    else 0
  end;

  if v_contract.max_monthly_spend is not null then
    v_capped := v_amount > v_contract.max_monthly_spend;
    v_amount := least(v_amount, v_contract.max_monthly_spend);
  end if;

  return query select v_count, v_amount, v_contract.billing_model, v_contract.included_units, v_billable_count, v_contract.monthly_fee, v_contract.redemption_fee, v_base, v_redemption, v_capped;
end;
$function$;

grant execute on function public.get_partner_billing_estimate(uuid) to authenticated, service_role;
revoke all on function public.get_partner_billing_estimate(uuid) from public, anon;

-- Partner billing contracts + real monthly invoice generation.
--
-- Replaces the flat $3/redemption placeholder with per-partner negotiated
-- terms (Starbucks pays one way, a local coffee shop pays another), and
-- turns business_invoices from an unused schema into something that
-- actually gets written to, once a month, from real redemption data.
--
-- Pipeline: brand_partners -> brand_offers -> offer_redemptions (ledger)
--           -> generate_monthly_invoices() -> business_invoices (draft)
--           -> [Stripe: not wired up yet, blocked on account creation]

-- ---------------------------------------------------------------------
-- partner_contracts
-- ---------------------------------------------------------------------
create table if not exists public.partner_contracts (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references public.brand_partners(id) on delete cascade,
  billing_model text not null check (billing_model in ('per_redemption', 'flat_monthly', 'hybrid', 'custom')),
  monthly_fee numeric(10,2),
  redemption_fee numeric(10,2),
  contract_start date not null,
  contract_end date,
  max_monthly_spend numeric(10,2),
  auto_renew boolean not null default false,
  status text not null default 'active' check (status in ('pending', 'active', 'expired', 'cancelled')),
  created_at timestamptz not null default now(),
  constraint partner_contracts_fee_matches_model check (
    (billing_model = 'per_redemption' and redemption_fee is not null) or
    (billing_model = 'flat_monthly' and monthly_fee is not null) or
    (billing_model = 'hybrid' and monthly_fee is not null and redemption_fee is not null) or
    (billing_model = 'custom')
  )
);

create index if not exists idx_partner_contracts_partner_status
  on public.partner_contracts(partner_id, status);

alter table public.partner_contracts enable row level security;

drop policy if exists "Business owners can view their own contract" on public.partner_contracts;
create policy "Business owners can view their own contract"
  on public.partner_contracts for select
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.managed_partner_id = partner_contracts.partner_id
    )
  );
-- Deliberately no insert/update/delete policy: contracts are a finance/ops
-- decision, not something a business self-serves. Write via SQL editor
-- (service role) or a future admin tool.

-- ---------------------------------------------------------------------
-- offer_redemptions.invoice_id — the redemption ledger link
-- ---------------------------------------------------------------------
alter table public.offer_redemptions
  add column if not exists invoice_id uuid references public.business_invoices(id);

create index if not exists idx_offer_redemptions_invoice_id
  on public.offer_redemptions(invoice_id);

-- Guards against ever double-invoicing the same partner+period, on top of
-- the application-level check in generate_monthly_invoices().
alter table public.business_invoices
  drop constraint if exists business_invoices_partner_period_unique;
alter table public.business_invoices
  add constraint business_invoices_partner_period_unique unique (partner_id, period_start, period_end);

alter table public.business_invoices enable row level security;

drop policy if exists "Business owners can view their own invoices" on public.business_invoices;
create policy "Business owners can view their own invoices"
  on public.business_invoices for select
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.managed_partner_id = business_invoices.partner_id
    )
  );

-- ---------------------------------------------------------------------
-- generate_monthly_invoices() — run manually (or from a scheduled job)
-- once a month. Defaults to billing the prior calendar month.
-- ---------------------------------------------------------------------
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
  v_redemption_ids uuid[];
  v_redemption_count int;
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
    -- Idempotency: skip if this partner+period was already invoiced.
    if exists (
      select 1 from business_invoices
      where partner_id = v_contract.partner_id
        and period_start = v_period_start
        and period_end = v_period_end
    ) then
      continue;
    end if;

    -- Lock this partner's unbilled redemptions for the period before
    -- aggregating, so two concurrent runs can't double-count or
    -- double-stamp the same rows.
    with locked as (
      select r.id
      from offer_redemptions r
      join brand_offers o on o.id = r.offer_id
      where o.partner_id = v_contract.partner_id
        and r.invoice_id is null
        and r.redeemed_at >= v_period_start
        and r.redeemed_at < v_period_end + interval '1 day'
      for update of r
    )
    select array_agg(id) into v_redemption_ids from locked;

    v_redemption_count := coalesce(array_length(v_redemption_ids, 1), 0);

    v_amount := case v_contract.billing_model
      when 'per_redemption' then v_redemption_count * v_contract.redemption_fee
      when 'flat_monthly' then v_contract.monthly_fee
      when 'hybrid' then v_contract.monthly_fee + (v_redemption_count * v_contract.redemption_fee)
      else 0 -- 'custom': business_invoices.amount_due is NOT NULL, so this drafts at
             -- 0 and finance corrects it by hand (still 'draft' status) before sending
    end;

    if v_contract.max_monthly_spend is not null and v_amount is not null then
      v_amount := least(v_amount, v_contract.max_monthly_spend);
    end if;

    insert into business_invoices (partner_id, period_start, period_end, redemption_count, amount_due, status)
    values (v_contract.partner_id, v_period_start, v_period_end, v_redemption_count, v_amount, 'draft')
    returning * into v_invoice;

    if v_redemption_ids is not null then
      update offer_redemptions set invoice_id = v_invoice.id where id = any(v_redemption_ids);
    end if;

    -- Contract lifecycle: if this period closes out the contract term,
    -- either roll it forward a month or mark it expired.
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
-- get_partner_billing_estimate() — same math as the invoice generator,
-- applied to the current (unclosed) month, for the dashboard preview.
-- ---------------------------------------------------------------------
create or replace function public.get_partner_billing_estimate(partner_id_param uuid)
returns table(redemption_count int, estimated_amount numeric, billing_model text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_contract record;
  v_count int;
  v_amount numeric(10,2);
  v_period_start date := date_trunc('month', now())::date;
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
    return query select 0, 0::numeric, null::text;
    return;
  end if;

  select count(*) into v_count
  from offer_redemptions r
  join brand_offers o on o.id = r.offer_id
  where o.partner_id = partner_id_param
    and r.redeemed_at >= v_period_start;

  v_amount := case v_contract.billing_model
    when 'per_redemption' then v_count * v_contract.redemption_fee
    when 'flat_monthly' then v_contract.monthly_fee
    when 'hybrid' then v_contract.monthly_fee + (v_count * v_contract.redemption_fee)
    else 0
  end;

  if v_contract.max_monthly_spend is not null then
    v_amount := least(v_amount, v_contract.max_monthly_spend);
  end if;

  return query select v_count, v_amount, v_contract.billing_model;
end;
$$;

revoke all on function public.get_partner_billing_estimate(uuid) from public, anon;
grant execute on function public.get_partner_billing_estimate(uuid) to authenticated;

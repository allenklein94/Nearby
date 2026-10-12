-- Owner (2026-10-12): claiming a perk creates a code; only the business's confirmation establishes a real visit. The
-- business dashboard's redemption figures (Total redemptions, This month, Repeat customers, "redemptions vs last month")
-- therefore count CONFIRMED visits only (confirmed_at is not null), exactly like billing (get_partner_billing_estimate /
-- generate_monthly_invoices). The month a visit belongs to is the same one billing uses (redeemed_at), so these figures and
-- the fee estimate always agree. A pending claim is not lost: it counts the moment the business confirms it, once.
-- Same signatures and return types as before (CREATE OR REPLACE keeps the existing grants; no second overload).

create or replace function public.get_business_dashboard_stats(partner_id_param uuid)
 returns table(total_followers bigint, followers_this_month bigint, total_redemptions bigint, redemptions_this_month bigint, repeat_redeemers bigint)
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
begin
  if not exists (select 1 from profiles where id = auth.uid() and managed_partner_id = partner_id_param) then
    return query select 0::bigint, 0::bigint, 0::bigint, 0::bigint, 0::bigint;
    return;
  end if;

  return query
  with visits as (
    select r.user_id, r.redeemed_at
    from offer_redemptions r
    join brand_offers o on o.id = r.offer_id
    where o.partner_id = partner_id_param
      and r.confirmed_at is not null
  )
  select
    (select count(*) from business_followers where brand_partner_id = partner_id_param) as total_followers,
    (select count(*) from business_followers where brand_partner_id = partner_id_param and opted_in_at >= date_trunc('month', now())) as followers_this_month,
    (select count(*) from visits) as total_redemptions,
    (select count(*) from visits v where v.redeemed_at >= date_trunc('month', now())) as redemptions_this_month,
    (select count(*) from (select v.user_id from visits v group by v.user_id having count(*) > 1) repeat_users) as repeat_redeemers;
end;
$function$;

create or replace function public.get_business_growth(partner_id_param uuid)
 returns table(redemptions_growth_pct numeric, followers_growth_pct numeric)
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
begin
  if not exists (select 1 from profiles where id = auth.uid() and managed_partner_id = partner_id_param) then
    return query select null::numeric, null::numeric;
    return;
  end if;

  return query
  with this_month as (
    select count(*) as cnt from offer_redemptions r
    join brand_offers o on o.id = r.offer_id
    where o.partner_id = partner_id_param
    and r.confirmed_at is not null
    and r.redeemed_at >= date_trunc('month', now())
  ),
  last_month as (
    select count(*) as cnt from offer_redemptions r
    join brand_offers o on o.id = r.offer_id
    where o.partner_id = partner_id_param
    and r.confirmed_at is not null
    and r.redeemed_at >= date_trunc('month', now()) - interval '1 month'
    and r.redeemed_at < date_trunc('month', now())
  ),
  followers_this_month as (
    select count(*) as cnt from business_followers
    where brand_partner_id = partner_id_param
    and opted_in_at >= date_trunc('month', now())
  ),
  followers_last_month as (
    select count(*) as cnt from business_followers
    where brand_partner_id = partner_id_param
    and opted_in_at >= date_trunc('month', now()) - interval '1 month'
    and opted_in_at < date_trunc('month', now())
  )
  select
    case when lm.cnt > 0 then round(100.0 * (tm.cnt - lm.cnt) / lm.cnt, 0) else null end as redemptions_growth_pct,
    case when flm.cnt > 0 then round(100.0 * (ftm.cnt - flm.cnt) / flm.cnt, 0) else null end as followers_growth_pct
  from this_month tm, last_month lm, followers_this_month ftm, followers_last_month flm;
end;
$function$;

-- get_business_dashboard_stats / _growth / _top_members / _visit_frequency /
-- _insights were all SECURITY DEFINER functions granted to any `authenticated`
-- user, with no check that the caller actually owns partner_id_param — found
-- while building the public BusinessProfileScreen. get_business_top_members
-- in particular returns named individuals' display_name + attendance count,
-- so this was a real PII leak: any logged-in user who knew (or guessed) a
-- partner_id could pull another business's follower/redemption counts and
-- top-attendee list. BusinessDashboardScreen.js's own client-side scoping
-- (only ever calling these with the caller's own managed_partner_id) was
-- never a real access control, just a UI convention.
--
-- Fix: each function now checks profiles.managed_partner_id = auth.uid()'s
-- own row against partner_id_param, and returns empty/zero/null instead of
-- raising — matches the RLS convention of "just don't show it" rather than
-- leaking existence via an error message.
--
-- get_business_dashboard_stats's total_followers is the one piece of this
-- data that's legitimately public (shown on the new BusinessProfileScreen),
-- so a separate, narrower get_business_follower_count() is added below —
-- BusinessProfileScreen.js is updated in this same commit to call that
-- instead of the now-locked-down dashboard stats function.

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
  select
    (select count(*) from business_followers where brand_partner_id = partner_id_param) as total_followers,
    (select count(*) from business_followers where brand_partner_id = partner_id_param and opted_in_at >= date_trunc('month', now())) as followers_this_month,
    (select count(*) from offer_redemptions r join brand_offers o on o.id = r.offer_id where o.partner_id = partner_id_param) as total_redemptions,
    (select count(*) from offer_redemptions r join brand_offers o on o.id = r.offer_id where o.partner_id = partner_id_param and r.redeemed_at >= date_trunc('month', now())) as redemptions_this_month,
    (
      select count(*) from (
        select r.user_id
        from offer_redemptions r
        join brand_offers o on o.id = r.offer_id
        where o.partner_id = partner_id_param
        group by r.user_id
        having count(*) > 1
      ) repeat_users
    ) as repeat_redeemers;
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
    and r.redeemed_at >= date_trunc('month', now())
  ),
  last_month as (
    select count(*) as cnt from offer_redemptions r
    join brand_offers o on o.id = r.offer_id
    where o.partner_id = partner_id_param
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

create or replace function public.get_business_top_members(partner_id_param uuid)
returns table(user_id uuid, display_name text, gatherings_attended bigint)
language plpgsql
stable security definer
set search_path to 'public'
as $function$
begin
  if not exists (select 1 from profiles where id = auth.uid() and managed_partner_id = partner_id_param) then
    return;
  end if;

  return query
  select p.id, p.display_name, count(*) as gatherings_attended
  from gathering_interest gi
  join gatherings g on g.id = gi.gathering_id
  join profiles p on p.id = gi.user_id
  where g.hosting_partner_id = partner_id_param
  and gi.status = 'approved'
  group by p.id, p.display_name
  order by gatherings_attended desc
  limit 5;
end;
$function$;

create or replace function public.get_business_visit_frequency(partner_id_param uuid)
returns numeric
language plpgsql
stable security definer
set search_path to 'public'
as $function$
begin
  if not exists (select 1 from profiles where id = auth.uid() and managed_partner_id = partner_id_param) then
    return null;
  end if;

  return (
    select round(avg(cnt), 1) from (
      select gi.user_id, count(*) as cnt
      from gathering_interest gi
      join gatherings g on g.id = gi.gathering_id
      where g.hosting_partner_id = partner_id_param
      and gi.status = 'approved'
      group by gi.user_id
    ) sub
  );
end;
$function$;

create or replace function public.get_business_insights(partner_id_param uuid)
returns table(top_interests text[], best_hour_of_day integer)
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not exists (select 1 from profiles where id = auth.uid() and managed_partner_id = partner_id_param) then
    return query select array[]::text[], null::integer;
    return;
  end if;

  return query
  select
    coalesce(
      (
        select array_agg(interest order by cnt desc)
        from (
          select interest, count(*) as cnt
          from business_followers bf
          join profiles p on p.id = bf.user_id
          cross join unnest(coalesce(p.interests, array[]::text[])) as interest
          where bf.brand_partner_id = partner_id_param
          group by interest
          order by cnt desc
          limit 5
        ) sub
      ),
      array[]::text[]
    ) as top_interests,
    (
      select extract(hour from g.scheduled_at)::int
      from gatherings g
      join gathering_interest gi on gi.gathering_id = g.id and gi.status = 'approved'
      where g.hosting_partner_id = partner_id_param
      group by extract(hour from g.scheduled_at)
      order by count(*) desc
      limit 1
    ) as best_hour_of_day;
end;
$function$;

-- Narrow, deliberately public-safe: just a count, no revenue/attendee data.
create or replace function public.get_business_follower_count(partner_id_param uuid)
returns bigint
language sql
stable security definer
set search_path to 'public'
as $function$
  select count(*) from business_followers where brand_partner_id = partner_id_param;
$function$;

revoke all on function public.get_business_follower_count(uuid) from public, anon;
grant execute on function public.get_business_follower_count(uuid) to authenticated;

-- Per-customer drill-in for the "Most Engaged" list (CRM depth, roadmap #12)
-- — owner-only, same ownership check as the functions above. Deliberately
-- narrower than a full gathering row: just what's needed to show "here's
-- when this person came."
create or replace function public.get_business_member_gathering_history(partner_id_param uuid, member_id_param uuid)
returns table(gathering_id uuid, title text, scheduled_at timestamptz)
language plpgsql
stable security definer
set search_path to 'public'
as $function$
begin
  if not exists (select 1 from profiles where id = auth.uid() and managed_partner_id = partner_id_param) then
    return;
  end if;

  return query
  select g.id, g.title, g.scheduled_at
  from gathering_interest gi
  join gatherings g on g.id = gi.gathering_id
  where g.hosting_partner_id = partner_id_param
  and gi.status = 'approved'
  and gi.user_id = member_id_param
  order by g.scheduled_at desc;
end;
$function$;

revoke all on function public.get_business_member_gathering_history(uuid, uuid) from public, anon;
grant execute on function public.get_business_member_gathering_history(uuid, uuid) to authenticated;

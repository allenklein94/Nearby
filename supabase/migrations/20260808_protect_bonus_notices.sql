-- bonus_notices (a real spendable resource -- see noticeLimits.js/referrals.js)
-- and referred_by were both writable directly from client-side JS with no
-- guard, and neither was in prevent_self_premium_edit()'s protected column
-- list -- a user could set their own bonus_notices to any number directly,
-- bypassing the real referral_redemptions-gated earn flow entirely.
--
-- Fixed in two parts: (1) the two legitimate write paths (spend in
-- noticeLimits.js, earn in referrals.js) are moved into SECURITY DEFINER
-- RPCs that set app.trusted_update before writing, same pattern already
-- used elsewhere (e.g. the admin_approve_id_verification fix above); (2)
-- both columns are now added to the trigger's guarded list, so a direct
-- client update to either is silently reverted like every other protected
-- column. spend_bonus_notice's UPDATE ... WHERE bonus_notices > 0 also
-- closes a pre-existing read-then-write race in the old client code (two
-- concurrent spends could both read the same count before either wrote it
-- back) as a side effect of making it atomic -- not the primary goal here,
-- but worth noting.
create or replace function public.spend_bonus_notice()
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_rows integer;
begin
  perform set_config('app.trusted_update', 'true', true);
  update profiles set bonus_notices = bonus_notices - 1
  where id = auth.uid() and coalesce(bonus_notices, 0) > 0;
  get diagnostics v_rows = row_count;
  return v_rows > 0;
end;
$function$;

revoke all on function public.spend_bonus_notice() from public, anon;
grant execute on function public.spend_bonus_notice() to authenticated;

create or replace function public.grant_referral_bonus(code_param text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_referrer_id uuid;
begin
  select id into v_referrer_id from profiles where referral_code = upper(trim(code_param));
  if v_referrer_id is null then
    raise exception 'That code doesn''t match any account.';
  end if;
  if v_referrer_id = auth.uid() then
    raise exception 'You can''t use your own referral code.';
  end if;

  -- Unique constraint on referred_id raises 23505 (propagated to the
  -- caller as-is) if this user has already redeemed a code -- same
  -- anti-fraud gate the old client code relied on.
  insert into referral_redemptions (referrer_id, referred_id) values (v_referrer_id, auth.uid());

  perform set_config('app.trusted_update', 'true', true);
  update profiles set referred_by = v_referrer_id where id = auth.uid();
  update profiles set bonus_notices = coalesce(bonus_notices, 0) + 3 where id = v_referrer_id;
  update profiles set bonus_notices = coalesce(bonus_notices, 0) + 3 where id = auth.uid();
end;
$function$;

revoke all on function public.grant_referral_bonus(text) from public, anon;
grant execute on function public.grant_referral_bonus(text) to authenticated;

create or replace function public.prevent_self_premium_edit()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if auth.uid() is not null and coalesce(current_setting('app.trusted_update', true), '') <> 'true' then
    if new.is_premium is distinct from old.is_premium then
      new.is_premium := old.is_premium;
    end if;
    if new.is_admin is distinct from old.is_admin then
      new.is_admin := old.is_admin;
    end if;
    if new.bonus_notices is distinct from old.bonus_notices then
      new.bonus_notices := old.bonus_notices;
    end if;
    if new.referred_by is distinct from old.referred_by then
      new.referred_by := old.referred_by;
    end if;
    if new.ai_uses_today is distinct from old.ai_uses_today then
      new.ai_uses_today := old.ai_uses_today;
    end if;
    if new.ai_uses_date is distinct from old.ai_uses_date then
      new.ai_uses_date := old.ai_uses_date;
    end if;
    if new.browse_views_today is distinct from old.browse_views_today then
      new.browse_views_today := old.browse_views_today;
    end if;
    if new.browse_views_date is distinct from old.browse_views_date then
      new.browse_views_date := old.browse_views_date;
    end if;
    if new.managed_partner_id is distinct from old.managed_partner_id then
      new.managed_partner_id := old.managed_partner_id;
    end if;
    if new.gatherings_created_today is distinct from old.gatherings_created_today then
      new.gatherings_created_today := old.gatherings_created_today;
    end if;
    if new.gatherings_created_date is distinct from old.gatherings_created_date then
      new.gatherings_created_date := old.gatherings_created_date;
    end if;
    if new.communities_created_today is distinct from old.communities_created_today then
      new.communities_created_today := old.communities_created_today;
    end if;
    if new.communities_created_date is distinct from old.communities_created_date then
      new.communities_created_date := old.communities_created_date;
    end if;
    if new.friend_requests_sent_today is distinct from old.friend_requests_sent_today then
      new.friend_requests_sent_today := old.friend_requests_sent_today;
    end if;
    if new.friend_requests_sent_date is distinct from old.friend_requests_sent_date then
      new.friend_requests_sent_date := old.friend_requests_sent_date;
    end if;
    if new.stories_posted_today is distinct from old.stories_posted_today then
      new.stories_posted_today := old.stories_posted_today;
    end if;
    if new.stories_posted_date is distinct from old.stories_posted_date then
      new.stories_posted_date := old.stories_posted_date;
    end if;
  end if;
  return new;
end;
$function$;

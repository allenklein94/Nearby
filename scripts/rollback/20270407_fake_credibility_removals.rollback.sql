-- Rollback for migration 20270407: back to 20270406's state. No row was changed by the migration, so none is restored.
drop trigger if exists gathering_feedback_after_end on public.gathering_feedback;
drop function if exists public._gathering_feedback_after_end();

CREATE OR REPLACE FUNCTION public.get_host_reputation(host_id_param uuid)
 RETURNS TABLE(welcoming_pct numeric, would_return_pct numeric, feedback_count bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    round(100.0 * count(*) filter (where gf.felt_welcoming = true) / nullif(count(*) filter (where gf.felt_welcoming is not null), 0), 0) as welcoming_pct,
    round(100.0 * count(*) filter (where gf.would_attend_again = true) / nullif(count(*) filter (where gf.would_attend_again is not null), 0), 0) as would_return_pct,
    count(*) as feedback_count
  from gathering_feedback gf
  join gatherings g on g.id = gf.gathering_id
  where g.host_id = host_id_param;
$function$
;

CREATE OR REPLACE FUNCTION public.grant_referral_bonus(code_param text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_caller_trusted text := current_setting('app.trusted_update', true); -- 20270359: the caller's value, put back after the trusted write
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
  perform set_config('app.trusted_update', coalesce(v_caller_trusted, 'false'), true); -- 20270359: trust ends here
end;
$function$;

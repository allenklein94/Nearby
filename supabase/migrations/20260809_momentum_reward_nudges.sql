-- Audit item 9 (PRODUCT_AUDIT/CRITICAL_MISSING_FEATURES.md #10 / #12): Insights,
-- Momentum, and Rewards already compute real, honest signals (a weekly attendance
-- streak, a proximity-to-next-reward-tier count) with nothing downstream acting on
-- them. This adds one real proactive push notification, following the exact same
-- pattern every other scheduled reminder in this schema already uses (see
-- send_birthday_reminders / send_first_mission_reminders): a SECURITY DEFINER
-- function, scheduled weekly via pg_cron, calling the send-push Edge Function
-- directly via net.http_post with the service role key pulled from vault.

create or replace function send_momentum_nudges()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  service_key text;
  u record;
  wk int;
  week_has_activity boolean;
  streak int;
  current_week_activity boolean;
  redemption_count int;
  next_tier_min int;
  next_tier_name text;
  next_tier_emoji text;
begin
  select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';

  for u in select id, display_name from profiles loop
    -- ---------- streak signal (mirrors getMomentumStats' weekly-bucket logic) ----------
    -- Consecutive completed weeks (not counting the current, still-in-progress
    -- week) with at least one attended-or-hosted gathering, counting back up
    -- to 8 weeks — same lookback window the Momentum screen itself uses.
    streak := 0;
    for wk in 1..8 loop
      select exists (
        select 1 from gathering_interest gi
        join gatherings g on g.id = gi.gathering_id
        where gi.user_id = u.id and gi.status = 'approved'
          and g.scheduled_at >= date_trunc('week', now()) - (wk || ' weeks')::interval
          and g.scheduled_at < date_trunc('week', now()) - ((wk - 1) || ' weeks')::interval
        union
        select 1 from gatherings g2
        where g2.host_id = u.id
          and g2.scheduled_at >= date_trunc('week', now()) - (wk || ' weeks')::interval
          and g2.scheduled_at < date_trunc('week', now()) - ((wk - 1) || ' weeks')::interval
      ) into week_has_activity;

      exit when not week_has_activity;
      streak := streak + 1;
    end loop;

    select exists (
      select 1 from gathering_interest gi
      join gatherings g on g.id = gi.gathering_id
      where gi.user_id = u.id and gi.status = 'approved' and g.scheduled_at >= date_trunc('week', now())
      union
      select 1 from gatherings g2
      where g2.host_id = u.id and g2.scheduled_at >= date_trunc('week', now())
    ) into current_week_activity;

    if streak >= 2 and not current_week_activity then
      perform net.http_post(
        url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
        body := jsonb_build_object(
          'recipient_id', u.id,
          'title', '🔥 Keep your streak going',
          'body', 'You''ve been active ' || streak || ' weeks in a row — join or host something this week to keep it up.',
          'data', jsonb_build_object('type', 'momentum_streak_nudge')
        )
      );
      continue; -- one nudge per person per run; don't also send the tier nudge below
    end if;

    -- ---------- reward-tier-proximity signal (mirrors getMyRewardStatus) ----------
    select count(*) into redemption_count from offer_redemptions where user_id = u.id;

    select min, name, emoji into next_tier_min, next_tier_name, next_tier_emoji
    from (values (5, 'Bronze', '🥉'), (15, 'Silver', '🥈'), (30, 'Gold', '🥇')) as tiers(min, name, emoji)
    where tiers.min > redemption_count
    order by tiers.min asc
    limit 1;

    if next_tier_min is not null and (next_tier_min - redemption_count) <= 2 then
      perform net.http_post(
        url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
        body := jsonb_build_object(
          'recipient_id', u.id,
          'title', next_tier_emoji || ' Almost at ' || next_tier_name,
          'body', (next_tier_min - redemption_count) || ' more redemption' || (case when (next_tier_min - redemption_count) = 1 then '' else 's' end) || ' and you''re ' || next_tier_name || '.',
          'data', jsonb_build_object('type', 'reward_tier_nudge')
        )
      );
    end if;
  end loop;
end;
$$;

revoke all on function send_momentum_nudges() from public, anon, authenticated;

select cron.schedule('send-momentum-reward-nudges', '0 15 * * 3', 'select send_momentum_nudges();');

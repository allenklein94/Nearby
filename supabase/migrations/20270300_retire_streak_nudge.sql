-- Owner item 53 (2026-10-12): retire the "🔥 Keep your streak going" push (momentum_streak_nudge). Nearby celebrates what
-- people did; it never nudges them to protect a streak. Its ONLY sender was the streak branch of send_momentum_nudges()
-- (cron job "send-momentum-reward-nudges", Wednesdays 15:00); no client, edge function or other SQL function sends it.
-- This removes that branch. The reward-tier branch (reward_tier_nudge) is unchanged here, byte for byte: it is a separate
-- push and not part of this decision. The streak DISPLAY on Your Activity is unchanged too (owner: kept until the Momentum
-- evidence is in). Any streak push still waiting in the outbox for a retry is failed so it can never go out late.
-- Guard: utils/streakNudgeRetired.test.js; live check scripts/live-verify/streak-nudge-retired.sql.

create or replace function public.send_momentum_nudges()
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  u record;
  redemption_count int;
  next_tier_min int;
  next_tier_name text;
  next_tier_emoji text;
begin

  for u in select id, display_name, coalesce(notify_discovery, true) as wants_notif from profiles loop
    if not u.wants_notif then
      continue;
    end if;

    -- The streak nudge push was retired by owner item 53 (2026-10-12): never send it again.

    -- ---------- reward-tier-proximity signal (mirrors getMyRewardStatus) ----------
    select count(*) into redemption_count from offer_redemptions where user_id = u.id;

    select min, name, emoji into next_tier_min, next_tier_name, next_tier_emoji
    from (values (5, 'Bronze', '🥉'), (15, 'Silver', '🥈'), (30, 'Gold', '🥇')) as tiers(min, name, emoji)
    where tiers.min > redemption_count
    order by tiers.min asc
    limit 1;

    if next_tier_min is not null and (next_tier_min - redemption_count) <= 2 then
      perform public._send_push(u.id, next_tier_emoji || ' Almost at ' || next_tier_name, (next_tier_min - redemption_count) || ' more redemption' || (case when (next_tier_min - redemption_count) = 1 then '' else 's' end) || ' and you''re ' || next_tier_name || '.', jsonb_build_object('type', 'reward_tier_nudge'));
    end if;
  end loop;
end;
$function$;

revoke all on function public.send_momentum_nudges() from public, anon, authenticated;

update public.push_outbox
set status = 'failed', last_error = 'retired: momentum_streak_nudge (owner item 53)', updated_at = now()
where data->>'type' = 'momentum_streak_nudge' and status in ('pending', 'retry');

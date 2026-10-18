-- Owner idea "186" (2026-10-18): Nearby brings people back only when something relevant happened, never with an
-- engagement nudge. Retires the last two scheduled "come back" pushes (item 53 retired the streak push the same way):
--   1. first_mission_reminder ("Your mission is still waiting"): ONLY sender send_first_mission_reminders(), cron job
--      "send-first-mission-reminders" (daily 10:00).
--   2. reward_tier_nudge ("Almost at {tier}"): ONLY sender send_momentum_nudges() (its streak branch already removed by
--      20270300), cron job "send-momentum-reward-nudges" (Wednesdays 15:00). With this branch gone the function sends nothing.
-- Both jobs are unscheduled and both functions dropped; no client, edge function or other SQL function sends either push.
-- Kept as is: every event-driven push, match reminders, birthday/occasion reminders, stalled group-plan nudges, the reward
-- tiers and the streak DISPLAY on Your Activity. Any retired push still waiting in the outbox is failed so it never goes
-- out late. Guard: utils/engagementNudgesRetired.test.js; live check scripts/live-verify/engagement-nudges-retired.sql.

select cron.unschedule(jobid) from cron.job
where jobname in ('send-first-mission-reminders', 'send-momentum-reward-nudges');

drop function if exists public.send_first_mission_reminders();
drop function if exists public.send_momentum_nudges();

update public.push_outbox
set status = 'failed', last_error = 'retired: ' || (data->>'type') || ' (owner idea 186)', updated_at = now()
where data->>'type' in ('first_mission_reminder', 'reward_tier_nudge') and status in ('pending', 'retry');

-- Owner idea "186": the "Your mission is still waiting" (first_mission_reminder) and "Almost at {tier}" (reward_tier_nudge)
-- pushes are retired. Checks the schedule, the senders, the outbox and that the kept reminders still run.
-- Rolled back always. Run after migration 20270329 is applied.
begin;
create temp table r(check_name text, ok boolean);

insert into r select 'neither retired job is scheduled',
  not exists (select 1 from cron.job where jobname in ('send-first-mission-reminders', 'send-momentum-reward-nudges'));
insert into r select 'no cron job calls a retired sender',
  not exists (select 1 from cron.job where command ~ 'send_first_mission_reminders|send_momentum_nudges');
insert into r select 'both senders are gone',
  to_regprocedure('public.send_first_mission_reminders()') is null and to_regprocedure('public.send_momentum_nudges()') is null;
insert into r select 'no database function sends either push (or the streak push)',
  not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname in ('public', 'private') and p.prokind = 'f'
                and (p.prosrc like '%''first\_mission\_reminder''%' or p.prosrc like '%''reward\_tier\_nudge''%'
                     or p.prosrc like '%''momentum\_streak\_nudge''%'));
insert into r select 'no retired push is waiting to be sent or retried',
  not exists (select 1 from push_outbox where data->>'type' in ('first_mission_reminder', 'reward_tier_nudge')
              and status in ('pending', 'retry'));

-- Every scheduled reminder job still runs (kept reminders: none of them sends a retired push).
select public.send_match_reminders();
select public.send_birthday_reminders();
select public.send_birthday_planning_nudges();
select public.send_occasion_planning_nudges();
select public.send_occasion_group_plan_stall_nudges();
select public.send_gathering_reminders();
insert into r select 'the kept reminder jobs ran and wrote no retired push',
  not exists (select 1 from push_outbox where data->>'type' in ('first_mission_reminder', 'reward_tier_nudge') and created_at >= now());
insert into r select 'the kept reminder jobs are still scheduled',
  (select count(*) = 6 from cron.job where jobname in ('send-match-reminders', 'send-birthday-reminders', 'send-birthday-planning-nudges',
    'send-occasion-planning-nudges', 'send-occasion-group-plan-stall-nudges', 'send-gathering-reminders'));

select check_name, ok from r;
rollback;

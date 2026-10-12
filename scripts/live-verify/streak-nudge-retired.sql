-- Owner item 53: the "Keep your streak going" push (momentum_streak_nudge) is retired. A person who WOULD have qualified
-- under the old rule (active 3 weeks in a row, nothing yet this week, discovery pushes on) gets no streak push when the
-- weekly job runs; the reward-tier push is still in the function. Rolled back always (pg_net's queue rolls back with it).
-- Run after migration 20270300 is applied.
begin;
create temp table r(check_name text, ok boolean);
create temp table fx as
  select (select id from profiles order by created_at limit 1 offset 0) as host,
         (select id from profiles order by created_at limit 1 offset 1) as fan;
update profiles set notify_discovery = true where id = (select fan from fx);

insert into gatherings (host_id, title, scheduled_at, precise_lat, precise_lng, interest_tag, area, capacity, visibility, wide_area, is_public)
select fx.host, 'item 53 streak ' || w, date_trunc('week', now()) - (w || ' weeks')::interval + interval '2 days', 40.3, -75.2, 'Coffee',
       'live-verify', 10, 'everyone', '40.3,-75.2', true
from fx, generate_series(1, 3) w;
insert into gathering_interest (gathering_id, user_id, status)
select g.id, fx.fan, 'approved' from gatherings g, fx where g.title like 'item 53 streak %' and g.host_id = fx.host;

insert into r select 'fixture: the fan was active 3 past weeks in a row',
  (select count(*) = 3 from gathering_interest gi join gatherings g on g.id = gi.gathering_id, fx
   where gi.user_id = fx.fan and g.title like 'item 53 streak %' and gi.status = 'approved');

select public.send_momentum_nudges();

insert into r select 'no streak push was written for anyone in this run',
  not exists (select 1 from push_outbox where data->>'type' = 'momentum_streak_nudge' and created_at >= now());
insert into r select 'no streak push is waiting to be retried',
  not exists (select 1 from push_outbox where data->>'type' = 'momentum_streak_nudge' and status in ('pending', 'retry'));
insert into r select 'the sender no longer names the streak push',
  position('momentum_streak_nudge' in pg_get_functiondef('public.send_momentum_nudges()'::regprocedure)) = 0
  and position('Keep your streak' in pg_get_functiondef('public.send_momentum_nudges()'::regprocedure)) = 0;
insert into r select 'the reward-tier push is untouched',
  position('reward_tier_nudge' in pg_get_functiondef('public.send_momentum_nudges()'::regprocedure)) > 0;
insert into r select 'no other database function sends it',
  not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.prokind = 'f' and pg_get_functiondef(p.oid) like '%momentum\_streak\_nudge%');
insert into r select 'the weekly job still runs only send_momentum_nudges()',
  (select bool_and(command = 'select send_momentum_nudges();') from cron.job where jobname = 'send-momentum-reward-nudges');

select check_name, ok from r;
rollback;

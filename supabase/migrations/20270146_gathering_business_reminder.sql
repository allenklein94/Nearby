-- Rule 6 (consumer intent and business demand stay connected): a host who ticked "Ask local businesses" has only stored
-- CONSENT (gatherings.ask_local_businesses); the request is created when the host taps "Yes, look now" on the gathering.
-- A host who never returns generated no opportunity. This adds ONE reminder push -- it never creates a request.
--
-- Eligible (all must hold): flag on; the gathering still exists (a cancelled gathering is deleted); it is upcoming with
-- at least 6 hours to go and within 3 days; it has a location (the request needs one); no business_requests row exists
-- for it (any status: once the host has asked, we stop, including after an expired/cancelled ask); no business already
-- hosts it; it has existed for 12+ hours (not a nag right after creation); host has not muted Plans (notify_planning);
-- not reminded before. Attendee count is NOT a condition: a zero-attendee gathering is valid, which is the reason the
-- request is not created at the checkbox.
create table if not exists public.gathering_business_reminders (
  gathering_id uuid primary key references public.gatherings(id) on delete cascade,
  sent_at timestamptz not null default now()
);
alter table public.gathering_business_reminders enable row level security;
revoke all on public.gathering_business_reminders from public, anon, authenticated;

create or replace function public._gathering_business_reminder_candidates()
returns table (gathering_id uuid, host_id uuid, title text)
language sql
stable
security definer
set search_path to 'public'
as $$
  select g.id, g.host_id, g.title
  from gatherings g
  where g.ask_local_businesses = true
    and g.scheduled_at >= now() + interval '6 hours'
    and g.scheduled_at <= now() + interval '3 days'
    and g.precise_lat is not null and g.precise_lng is not null
    and g.hosting_partner_id is null
    and g.created_at <= now() - interval '12 hours'
    and not exists (select 1 from business_requests r where r.gathering_id = g.id)
    and not exists (select 1 from gathering_business_reminders b where b.gathering_id = g.id)
    and coalesce((select p.notify_planning from profiles p where p.id = g.host_id), true);
$$;
revoke all on function public._gathering_business_reminder_candidates() from public, anon, authenticated;

create or replace function public.send_gathering_business_reminders()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_row record;
  v_sent integer := 0;
  service_key text;
begin
  select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';
  if service_key is null then
    return 0;
  end if;
  for v_row in select * from public._gathering_business_reminder_candidates() loop
    -- Record first (primary key = one reminder per gathering, ever), then push.
    insert into gathering_business_reminders (gathering_id) values (v_row.gathering_id) on conflict do nothing;
    continue when not found;
    perform net.http_post(
      url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
      body := jsonb_build_object(
        'recipient_id', v_row.host_id,
        'title', 'Want local business options?',
        'body', 'You asked us to look for local business options for "' || v_row.title || '". Ready to see what''s available?',
        'data', jsonb_build_object('type', 'gathering_business_reminder', 'gathering_id', v_row.gathering_id)
      )
    );
    v_sent := v_sent + 1;
  end loop;
  return v_sent;
end;
$fn$;
revoke all on function public.send_gathering_business_reminders() from public, anon, authenticated;

select cron.unschedule(jobid) from cron.job where jobname = 'send-gathering-business-reminders';
select cron.schedule('send-gathering-business-reminders', '20 * * * *', 'select send_gathering_business_reminders();');

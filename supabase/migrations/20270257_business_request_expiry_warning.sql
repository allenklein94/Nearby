-- Item 140 follow-up (2026-10-02, owner): "Request expires soon". A business can miss a request simply because it did not
-- realize the response window was about to close. ONE warning push per request per business, about two hours before the
-- request's own deadline (business_requests.expires_at, the same deadline submit_business_offer and the hourly expiry
-- sweep enforce).
--
-- Eligible (all must hold, re-checked at send time, so anything that closes it first suppresses the warning):
--   * the business's offer row is still 'pending' = it has not answered (an offer sent, a decline, a withdrawal, an
--     expiry or a cancellation all leave 'pending'); a business that already responded did not miss it;
--   * the request is still 'open' (not fulfilled / expired / cancelled / merged) and no offer on it is accepted/completed;
--   * the deadline is still in the future and at most two hours away;
--   * the business learned of the request (the later of the request's and its offer row's creation) MORE than two hours
--     before the deadline: a request that arrives with less than two hours left gets no immediate warning;
--   * the business is active; the recipient is the owner of THAT business (profiles.managed_partner_id) who has not turned
--     business notifications off (notify_business). The per-group mute (business_notification_prefs, group 'requests')
--     and the email fallback for web-only owners are applied by send-push, as for every business push.
-- Idempotent twice over: the ledger's primary key (request, business) is written first and the push carries the outbox
-- dedupe key 'request_expiring:<offer id>', so a re-run, an overlapping run or a retry never sends a second warning; a
-- request reopened later is not warned again (one per request, ever).
-- Payload: ids only (type, request_id, offer_id, partner_id) + the business-safe summary in the body; never the requester.

create table if not exists public.business_request_expiry_warnings (
  request_id uuid not null references public.business_requests(id) on delete cascade,
  partner_id uuid not null references public.brand_partners(id) on delete cascade,
  offer_id uuid not null,
  sent_at timestamptz not null default now(),
  primary key (request_id, partner_id)
);
alter table public.business_request_expiry_warnings enable row level security;
revoke all on public.business_request_expiry_warnings from public, anon, authenticated;

create or replace function public._business_request_expiry_warning_candidates()
returns table (offer_id uuid, request_id uuid, partner_id uuid, owner_id uuid, expires_at timestamptz)
language sql
stable
security definer
set search_path to 'public'
as $$
  select o.id, r.id, o.partner_id, p.id, r.expires_at
  from business_request_offers o
  join business_requests r on r.id = o.request_id
  join brand_partners bp on bp.id = o.partner_id
  join profiles p on p.managed_partner_id = o.partner_id
  where o.status = 'pending'
    and r.status = 'open'
    and r.expires_at > now()
    and r.expires_at <= now() + interval '2 hours'
    and r.expires_at - greatest(r.created_at, o.created_at) > interval '2 hours'
    and coalesce(bp.active, true)
    and coalesce(p.notify_business, true)
    and not exists (select 1 from business_request_offers w where w.request_id = r.id and w.status in ('accepted', 'completed'))
    and not exists (select 1 from business_request_expiry_warnings x where x.request_id = r.id and x.partner_id = o.partner_id);
$$;
revoke all on function public._business_request_expiry_warning_candidates() from public, anon, authenticated;

-- "about 2 hours" / "about an hour and a half" / "about an hour" / "N minutes": the real time left when it is sent.
create or replace function public._time_left_phrase(until_param timestamptz)
returns text
language sql
stable
set search_path to 'public'
as $$
  select case
    when m >= 105 then 'about 2 hours'
    when m >= 75 then 'about an hour and a half'
    when m >= 50 then 'about an hour'
    when m <= 1 then 'a minute'
    else m || ' minutes'
  end
  from (select ceil(extract(epoch from (until_param - now())) / 60)::int as m) s;
$$;
revoke all on function public._time_left_phrase(timestamptz) from public, anon, authenticated;

create or replace function public.send_business_request_expiry_warnings()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_row record;
  v_sent integer := 0;
  v_summary text;
begin
  for v_row in select * from public._business_request_expiry_warning_candidates() loop
    -- Record first (one per request per business, ever), then push.
    insert into business_request_expiry_warnings (request_id, partner_id, offer_id)
      values (v_row.request_id, v_row.partner_id, v_row.offer_id)
      on conflict do nothing;
    continue when not found;
    v_summary := public.business_safe_request_summary(v_row.request_id);
    perform public._send_push(
      v_row.owner_id,
      'Request expires soon',
      coalesce(nullif(v_summary, '') || ' · ', '') || 'Closes in ' || public._time_left_phrase(v_row.expires_at) || '. Reply before it expires.',
      jsonb_build_object('type', 'business_request_expiring', 'request_id', v_row.request_id, 'offer_id', v_row.offer_id, 'partner_id', v_row.partner_id),
      'request_expiring:' || v_row.offer_id
    );
    v_sent := v_sent + 1;
  end loop;
  return v_sent;
end;
$fn$;
revoke all on function public.send_business_request_expiry_warnings() from public, anon, authenticated;

select cron.unschedule(jobid) from cron.job where jobname = 'send-business-request-expiry-warnings';
select cron.schedule('send-business-request-expiry-warnings', '*/15 * * * *', 'select send_business_request_expiry_warnings();');

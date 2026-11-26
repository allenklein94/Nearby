-- Screening outage alerts (owner, 2026-11-02): tell an administrator when business-content screening is UNAVAILABLE, so a
-- depleted balance, a bad key, a retired model or a provider outage can't silently stop every business from sending offers.
-- Staged after 20270386; deploy only with its own approval. Monitoring only: screening stays fail-closed and nothing here
-- refuses, allows, holds, delays or changes any business write, verdict or screening result.
--
-- Input: the screening edge functions (_shared/screeningHealth.js) call public.record_screening_service_result after EVERY
-- provider call: ok, or a failure KIND (credit / credentials / model / rate_limit / timeout / provider_error / bad_reply) +
-- the HTTP status. A content verdict (low / medium / high / uncertain, incl. a refused offer) is never a failure and is never
-- reported as one. Nothing else arrives: no content, verdict, business, user, request id or key.
--
-- Rules (one outage open at a time, serialized by an advisory lock):
--   * opens on the FIRST credit / credentials / model failure (they don't fix themselves), or on the 3rd failure of the
--     other kinds within 10 minutes since the last recovery (one timeout or overload alone never alerts);
--   * opening alerts each admin ONCE ("Offer screening is unavailable", reason in plain words); while it stays open, at most
--     one reminder per 24 h, and only when failures are still happening; the first success closes it and alerts ONCE
--     ("Offer screening is working again"). Dedupe keys make each of those exactly once per admin, even under races.
--   * recipients = admins who are not suspended (same set as 20270355's report notice); the push carries only the type, the
--     phase and the kind. Unknown push types are never muted (_push_muted) and open nothing on tap (no new screen).
--   * retention: failure rows 30 days, closed outages 90 days (purged on the next report).

create table if not exists private.screening_service_failures (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  kind text not null check (kind in ('credit', 'credentials', 'model', 'rate_limit', 'timeout', 'provider_error', 'bad_reply')),
  http_status smallint check (http_status is null or http_status between 100 and 599),
  source text not null check (source ~ '^[a-z0-9-]{1,40}$')
);
create index if not exists screening_service_failures_time on private.screening_service_failures (occurred_at);
revoke all on private.screening_service_failures from public, anon, authenticated;

create table if not exists private.screening_outages (
  id bigint generated always as identity primary key,
  opened_at timestamptz not null default now(),
  first_kind text not null,
  last_kind text not null,
  last_failure_at timestamptz not null,
  failure_count integer not null default 1,
  last_alert_at timestamptz not null,
  reminders integer not null default 0,
  recovered_at timestamptz
);
create unique index if not exists screening_outages_one_open on private.screening_outages ((true)) where recovered_at is null;
revoke all on private.screening_outages from public, anon, authenticated;

create or replace function private._screening_outage_alert(outage_id_param bigint, phase_param text, kind_param text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_phase text := split_part(phase_param, ':', 1);  -- 'open' | 'reminder' | 'recovered' ('reminder:N' keeps each reminder distinct)
  v_title text;
  v_body text;
  v_reason text := case kind_param
    when 'credit' then 'The screening provider reports no remaining credit.'
    when 'credentials' then 'The screening provider refused the API key.'
    when 'model' then 'The screening model is not available.'
    when 'rate_limit' then 'The screening provider is limiting requests.'
    when 'timeout' then 'Screening requests are timing out.'
    when 'bad_reply' then 'The screening provider is returning unreadable answers.'
    else 'The screening provider is returning errors.' end;
  r record;
begin
  if v_phase = 'recovered' then
    v_title := 'Offer screening is working again';
    v_body := 'Businesses can send offers again.';
  elsif v_phase = 'reminder' then
    v_title := 'Offer screening is still unavailable';
    v_body := v_reason || ' Businesses still can''t send offers.';
  else
    v_title := 'Offer screening is unavailable';
    v_body := v_reason || ' Businesses can''t send offers until it''s fixed.';
  end if;
  for r in select p.id from profiles p where p.is_admin is true and p.suspended_at is null loop
    perform _send_push(
      r.id, v_title, v_body,
      jsonb_build_object('type', 'admin_screening_outage', 'phase', v_phase, 'kind', kind_param),
      'screening_outage:' || outage_id_param || ':' || phase_param || ':' || r.id);
  end loop;
end;
$function$;
revoke all on function private._screening_outage_alert(bigint, text, text) from public, anon, authenticated;

create or replace function public.record_screening_service_result(
  source_param text, ok_param boolean, kind_param text default null, http_status_param integer default null)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_open private.screening_outages;
  v_recent integer;
  v_now timestamptz := clock_timestamp();
  v_source text := case when coalesce(source_param, '') ~ '^[a-z0-9-]{1,40}$' then source_param else 'unknown' end;
  v_kind text := case when kind_param in ('credit', 'credentials', 'model', 'rate_limit', 'timeout', 'provider_error', 'bad_reply')
                      then kind_param else 'provider_error' end;
  v_status smallint := case when http_status_param between 100 and 599 then http_status_param end;
begin
  if coalesce(ok_param, false) then
    -- The common case: nothing open, nothing to do (no lock, no write).
    if not exists (select 1 from private.screening_outages where recovered_at is null) then
      return;
    end if;
    perform pg_advisory_xact_lock(hashtext('nearby.screening_outage'));
    update private.screening_outages set recovered_at = v_now
     where recovered_at is null
    returning * into v_open;
    if v_open.id is not null then
      perform private._screening_outage_alert(v_open.id, 'recovered', v_open.last_kind);
    end if;
    return;
  end if;

  perform pg_advisory_xact_lock(hashtext('nearby.screening_outage'));
  delete from private.screening_service_failures where occurred_at < v_now - interval '30 days';
  delete from private.screening_outages where recovered_at < v_now - interval '90 days';
  insert into private.screening_service_failures (occurred_at, kind, http_status, source)
  values (v_now, v_kind, v_status, v_source);

  select * into v_open from private.screening_outages where recovered_at is null;
  if v_open.id is not null then
    update private.screening_outages
       set last_kind = v_kind, last_failure_at = v_now, failure_count = failure_count + 1
     where id = v_open.id;
    if v_now >= v_open.last_alert_at + interval '24 hours' then
      update private.screening_outages set last_alert_at = v_now, reminders = reminders + 1 where id = v_open.id;
      perform private._screening_outage_alert(v_open.id, 'reminder:' || (v_open.reminders + 1), v_kind);
    end if;
    return;
  end if;

  if v_kind not in ('credit', 'credentials', 'model') then
    -- only failures since the last recovery count (a closed outage's failures never re-open it)
    select count(*) into v_recent from private.screening_service_failures
     where occurred_at > greatest(v_now - interval '10 minutes',
                                  coalesce((select max(recovered_at) from private.screening_outages), '-infinity'::timestamptz));
    if v_recent < 3 then
      return;
    end if;
  end if;

  insert into private.screening_outages (opened_at, first_kind, last_kind, last_failure_at, failure_count, last_alert_at)
  values (v_now, v_kind, v_kind, v_now, 1, v_now)
  returning * into v_open;
  perform private._screening_outage_alert(v_open.id, 'open', v_kind);
end;
$function$;
revoke all on function public.record_screening_service_result(text, boolean, text, integer) from public, anon, authenticated;
grant execute on function public.record_screening_service_result(text, boolean, text, integer) to service_role;

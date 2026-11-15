-- Dead push tokens (owner, 2026-11-15): a business owner who installed the app once and later deleted it kept a stored push
-- token, so send-push "delivered" every alert to Expo and never used the email fallback (which runs only without a token).
--
-- Expo says a token is permanently unusable with the error DeviceNotRegistered: sometimes at once (the send's ticket), usually
-- minutes later (the delivery RECEIPT, once Apple/Google report the app gone). This migration lets send-push act on both:
--   * at once: the ticket says DeviceNotRegistered -> the token is cleared and send-push emails that alert (existing fallback);
--   * later: send-push records each accepted send (ticket id + a hash of the token; for an owner business alert also the
--     alert's own title/body/data, the same words the push carried). Every 5 minutes a job asks send-push to fetch the
--     receipts of sends older than 15 minutes. A DeviceNotRegistered receipt clears the token and returns that alert ONCE
--     for the email; ok / any other error settles the row with no action; no receipt yet = kept and asked again, dropped
--     after 24 hours (Expo keeps receipts for 24 hours).
-- Never a false removal: only DeviceNotRegistered counts (rate limits, Expo/network failures, other errors never clear a
-- token), and a token is cleared only while it is STILL the one that failed (a reinstalled app registers a new one, which is
-- kept; re-opening the app re-registers in any case). Never a duplicate email: each recorded send is settled once (row
-- deleted in the same statement that returns it), and the at-once path only runs for a send Expo refused (no ticket id).
-- Nothing here touches what a client can read: no client grant on anything new.

create table if not exists private.push_receipt_checks (
  ticket_id text primary key check (char_length(ticket_id) between 1 and 200),
  recipient_id uuid not null references auth.users(id) on delete cascade,
  token_sha256 text not null check (token_sha256 ~ '^[0-9a-f]{64}$'),
  email_title text,          -- only for an owner business alert (send-push EMAIL_TYPES); null otherwise
  email_body text,
  email_data jsonb,
  created_at timestamptz not null default now()
);
create index if not exists push_receipt_checks_created on private.push_receipt_checks (created_at);
revoke all on private.push_receipt_checks from public, anon, authenticated;

create or replace function private.push_token_sha256(token_param text)
returns text
language sql
immutable
set search_path to ''
as $$
  select encode(sha256(convert_to(btrim(token_param), 'UTF8')), 'hex');
$$;
revoke all on function private.push_token_sha256(text) from public, anon, authenticated;

-- send-push: one accepted send. Email fields only for an owner business alert (send-push decides; capped lengths).
create or replace function public._record_push_ticket(ticket_id_param text, recipient_id_param uuid, token_param text,
                                                      email_title_param text default null, email_body_param text default null,
                                                      email_data_param jsonb default null)
returns void
language sql
security definer
set search_path to ''
as $$
  insert into private.push_receipt_checks (ticket_id, recipient_id, token_sha256, email_title, email_body, email_data)
  values (ticket_id_param, recipient_id_param, private.push_token_sha256(token_param),
          left(email_title_param, 300), left(email_body_param, 2000),
          case when email_title_param is null then null else email_data_param end)
  on conflict (ticket_id) do nothing;
$$;
revoke all on function public._record_push_ticket(text, uuid, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public._record_push_ticket(text, uuid, text, text, text, jsonb) to service_role;

-- Clears the recipient's token only if it is still the one with this hash. true = cleared.
create or replace function private.invalidate_push_token(recipient_id_param uuid, token_sha256_param text)
returns boolean
language plpgsql
security definer
set search_path to ''
as $$
begin
  delete from private.push_tokens t
   where t.user_id = recipient_id_param and private.push_token_sha256(t.expo_push_token) = token_sha256_param;
  return found;
end;
$$;
revoke all on function private.invalidate_push_token(uuid, text) from public, anon, authenticated;

-- send-push, at once: Expo refused the send with DeviceNotRegistered.
create or replace function public._invalidate_push_token(recipient_id_param uuid, token_param text)
returns boolean
language sql
security definer
set search_path to ''
as $$
  select private.invalidate_push_token(recipient_id_param, private.push_token_sha256(token_param));
$$;
revoke all on function public._invalidate_push_token(uuid, text) from public, anon, authenticated;
grant execute on function public._invalidate_push_token(uuid, text) to service_role;

-- send-push, receipts: the ticket ids due for a receipt (sent more than 15 minutes ago), oldest first.
create or replace function public._push_receipts_due(limit_param int default 300)
returns table(ticket_id text)
language sql
security definer
set search_path to ''
as $$
  select c.ticket_id from private.push_receipt_checks c
   where c.created_at < now() - interval '15 minutes'
   order by c.created_at
   limit least(greatest(coalesce(limit_param, 300), 1), 1000);
$$;
revoke all on function public._push_receipts_due(int) from public, anon, authenticated;
grant execute on function public._push_receipts_due(int) to service_role;

-- send-push, receipts: settles one ticket. outcome = 'ok' | 'device_not_registered' | 'other_error' | 'pending' (no receipt
-- yet). Returns null when nothing is to be done (already settled by another run, pending, ok, other error); for a dead
-- device { invalidated, recipient_id, email } where email = the alert to send by email (null for a non-business push).
create or replace function public._settle_push_receipt(ticket_id_param text, outcome_param text)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  r private.push_receipt_checks;
  v_cleared boolean;
begin
  if outcome_param not in ('ok', 'device_not_registered', 'other_error', 'pending') then
    raise exception 'unknown receipt outcome' using hint = 'push_receipt_outcome';
  end if;
  if outcome_param = 'pending' then
    -- Expo keeps receipts 24 hours: after that it never will answer, so the row goes (no action).
    delete from private.push_receipt_checks where ticket_id = ticket_id_param and created_at < now() - interval '24 hours';
    return null;
  end if;
  delete from private.push_receipt_checks where ticket_id = ticket_id_param returning * into r;
  if not found or outcome_param <> 'device_not_registered' then
    return null;
  end if;
  v_cleared := private.invalidate_push_token(r.recipient_id, r.token_sha256);
  return jsonb_build_object('invalidated', v_cleared, 'recipient_id', r.recipient_id,
    'email', case when r.email_title is null then null
                  else jsonb_build_object('title', r.email_title, 'body', r.email_body, 'data', coalesce(r.email_data, '{}'::jsonb)) end);
end;
$$;
revoke all on function public._settle_push_receipt(text, text) from public, anon, authenticated;
grant execute on function public._settle_push_receipt(text, text) to service_role;

-- Every 5 minutes: if any send is due, ask send-push to check receipts (same key + address pattern as the push outbox).
-- Also drops rows older than 2 days that were never settled (e.g. send-push not deployed yet). Dry-run switch for journeys.
create or replace function public.dispatch_push_receipt_checks()
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_key text;
begin
  delete from private.push_receipt_checks where created_at < now() - interval '2 days';
  if not exists (select 1 from private.push_receipt_checks where created_at < now() - interval '15 minutes') then
    return false;
  end if;
  if current_setting('app.push_receipt_dispatch_dry_run', true) = 'on' then
    return true;
  end if;
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'service_role_key';
  if v_key is null then return false; end if;
  perform net.http_post(
    url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key),
    body := jsonb_build_object('action', 'check_receipts'));
  return true;
end;
$$;
revoke all on function public.dispatch_push_receipt_checks() from public, anon, authenticated;

do $cron$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'check-push-receipts') then
      perform cron.unschedule('check-push-receipts');
    end if;
    perform cron.schedule('check-push-receipts', '*/5 * * * *', 'select public.dispatch_push_receipt_checks()');
  end if;
end;
$cron$;

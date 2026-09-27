-- Raw ask text retention (2026-09-27, owner decision, LOCKED: "structured forever, raw text 180 days").
--
-- Typed Home/Discover ask analytics keep two copies of what the person typed (already stripped of stated dietary /
-- accessibility needs by the client, utils/sensitiveNeeds.js):
--   intent_submissions.raw_text   one row per resolved ask
--   intent_outcomes.raw_text      one row per result the person tapped
-- Those two columns are the ONLY approved raw-ask copies. This migration enforces, in the data layer:
--   * every raw ask text expires 180 days after the row is written (raw_ask_retention_days()); the expiry is stamped
--     by the server on insert (raw_text_expires_at), ignores anything the client sends, and can never be changed;
--   * after expiry the text is cleared (set to NULL, never rewritten or moved): hourly by purge_expired_raw_ask_text()
--     (pg_cron, :40), and at once by the trigger on any write that touches an expired row;
--   * the text can only ever be CLEARED after insert, never rewritten, so a client cannot re-store text into an old
--     row to extend its life;
--   * everything else in both rows (category, date window, intent kind, party size, local period, wide area, result
--     type/id/title, outcome, would-repeat, timestamps, the submission -> request link) is untouched: the structured
--     record survives the text.
-- Not in scope, deliberately: business_requests.raw_text (the request's own operational content, shown to the
-- requester on their plan; not ask analytics). No user-facing setting. Safe to rerun.

create or replace function public.raw_ask_retention_days()
returns integer language sql immutable as $$ select 180 $$;

alter table public.intent_submissions add column if not exists raw_text_expires_at timestamptz;
alter table public.intent_outcomes add column if not exists raw_text_expires_at timestamptz;

-- Backfill: existing rows expire 180 days after they were written (prod had 0 rows on 2026-09-27).
update public.intent_submissions set raw_text_expires_at = coalesce(created_at, now()) + make_interval(days => public.raw_ask_retention_days())
  where raw_text_expires_at is null;
update public.intent_outcomes set raw_text_expires_at = coalesce(selected_at, now()) + make_interval(days => public.raw_ask_retention_days())
  where raw_text_expires_at is null;
alter table public.intent_submissions alter column raw_text_expires_at set not null;
alter table public.intent_outcomes alter column raw_text_expires_at set not null;

create index if not exists intent_submissions_raw_text_expiry on public.intent_submissions (raw_text_expires_at)
  where raw_text is not null;
create index if not exists intent_outcomes_raw_text_expiry on public.intent_outcomes (raw_text_expires_at)
  where raw_text is not null;

-- The one rule for every write path (client inserts through RLS, service writes, future functions).
create or replace function public._raw_ask_text_retention()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    new.raw_text_expires_at := now() + make_interval(days => public.raw_ask_retention_days());
    if new.raw_text is not null and length(trim(new.raw_text)) = 0 then
      new.raw_text := null;
    end if;
  else
    new.raw_text_expires_at := old.raw_text_expires_at;
    if new.raw_text is not null and new.raw_text is distinct from old.raw_text then
      raise exception 'Ask text can only be cleared, never rewritten.';
    end if;
  end if;
  if new.raw_text_expires_at <= now() then
    new.raw_text := null;
  end if;
  return new;
end $$;
revoke all on function public._raw_ask_text_retention() from public, anon, authenticated;

drop trigger if exists raw_ask_text_retention on public.intent_submissions;
create trigger raw_ask_text_retention before insert or update on public.intent_submissions
  for each row execute function public._raw_ask_text_retention();
drop trigger if exists raw_ask_text_retention on public.intent_outcomes;
create trigger raw_ask_text_retention before insert or update on public.intent_outcomes
  for each row execute function public._raw_ask_text_retention();

-- Clears expired text only. Never deletes a row and never touches another column (the trigger freezes the expiry).
-- Idempotent: a second run finds nothing to clear.
create or replace function public.purge_expired_raw_ask_text()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_submissions integer;
  v_outcomes integer;
begin
  update intent_submissions set raw_text = null where raw_text is not null and raw_text_expires_at <= now();
  get diagnostics v_submissions = row_count;
  update intent_outcomes set raw_text = null where raw_text is not null and raw_text_expires_at <= now();
  get diagnostics v_outcomes = row_count;
  return jsonb_build_object('intent_submissions', v_submissions, 'intent_outcomes', v_outcomes);
end $$;
revoke all on function public.purge_expired_raw_ask_text() from public, anon, authenticated;
grant execute on function public.purge_expired_raw_ask_text() to service_role;

select public.purge_expired_raw_ask_text();

do $$ begin
  if exists (select 1 from cron.job where jobname = 'purge-expired-raw-ask-text') then
    perform cron.unschedule('purge-expired-raw-ask-text');
  end if;
  perform cron.schedule('purge-expired-raw-ask-text', '40 * * * *', 'select public.purge_expired_raw_ask_text();');
end $$;

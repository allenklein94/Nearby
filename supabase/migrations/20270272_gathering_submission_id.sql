-- Owner (2026-10-03, flywheel gap 1, LOCKED): record the explicit typed ask -> gathering relationship.
--   gatherings.submission_id -> public.intent_submissions.id (uuid)
-- the same typed-ask identifier business_requests.submission_id, intent_outcomes.submission_id and the typed-ask audit
-- snapshots already reference (all ON DELETE SET NULL; intent_submissions rows are never deleted by retention, only their
-- raw text is cleared).
--
-- Set ONLY by the app when a gathering is created through "Create it yourself" from that typed ask (the ask's own id is
-- carried into Create; see routeClassifiedIntentToCreation). NULL for every other gathering. Never inferred from
-- category, words, timing, location or behavior, never backfilled, never set after creation.
-- Recording only: nothing reads it for ranking, recommendations, routing, business matching, notifications, visibility
-- or joining. Existing attribution is unchanged: a business request made from such a gathering still carries only its
-- own submission_id (item 126 stays conservative).
--
-- Rules enforced here (no client change can bypass them):
--   * on insert, an id that is not one of the HOST's own typed asks is dropped to NULL (the gathering is still created;
--     attribution never blocks a real action);
--   * after insert the value can never be changed or added by any write; the only change allowed is the foreign key's own
--     ON DELETE SET NULL (if the ask row is ever deleted), which runs nested inside the referential action.
alter table public.gatherings
  add column if not exists submission_id uuid references public.intent_submissions(id) on delete set null;

create or replace function public._gathering_submission_id_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if new.submission_id is not null and not exists (
      select 1 from intent_submissions s where s.id = new.submission_id and s.user_id = new.host_id
    ) then
      new.submission_id := null;
    end if;
    return new;
  end if;
  if new.submission_id is distinct from old.submission_id then
    -- the referential ON DELETE SET NULL runs one trigger level deeper than any direct UPDATE
    if new.submission_id is null and pg_trigger_depth() > 1 then
      return new;
    end if;
    raise exception 'A gathering''s source ask is set when it is created and cannot be changed.';
  end if;
  return new;
end;
$$;

revoke all on function public._gathering_submission_id_guard() from public, anon, authenticated;

drop trigger if exists gathering_submission_id_guard on public.gatherings;
create trigger gathering_submission_id_guard
  before insert or update of submission_id on public.gatherings
  for each row execute function public._gathering_submission_id_guard();

-- The Discover typed-ask session, synced to the account (2026-09-27, owner, item 108 completion). The account's one active
-- Discover session is the source of truth; each device's storage is only a cache for instant restore. Scoped to exactly this
-- session: not a general synced app-state store.
--
--   * One row per account (user_id primary key). A new search replaces it; a refinement updates it.
--   * Latest valid update wins, by the time the person made the change on their device (client_updated_at, never more than
--     5 minutes ahead of the server clock). No merge logic.
--   * Clearing the search leaves a TOMBSTONE (content removed, cleared_at set) so every device learns the session ended.
--   * Raw text retention (the 20270237 rule): the words expire raw_ask_retention_days() after the ask was made; the expiry is
--     stamped by the server (from the caller's own intent_submissions row when linked, else when this session first reached the
--     server), can never move, and the text can only be cleared. On expiry the whole session ends (content cleared = tombstone),
--     by the same hourly purge job and at once on any write.
--   * Private: RLS on, no table grants; three caller-only RPCs. No business path reads it. Account deletion cascades.
--   * No results are stored; a restore re-runs the canonical search.

create table if not exists public.discover_sessions (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  session_id uuid not null,
  typed_text text check (typed_text is null or char_length(typed_text) between 1 and 500),
  classify_result jsonb check (classify_result is null or (jsonb_typeof(classify_result) = 'object' and pg_column_size(classify_result) <= 16384)),
  submission_id uuid,
  root_snapshot_id uuid,
  refined boolean not null default false,
  asked_at timestamptz not null,
  raw_text_expires_at timestamptz not null,
  client_updated_at timestamptz not null,
  updated_at timestamptz not null default now(),
  cleared_at timestamptz,
  constraint discover_sessions_live_or_cleared check ((cleared_at is null) = (typed_text is not null and classify_result is not null))
);
alter table public.discover_sessions enable row level security;
revoke all on public.discover_sessions from public, anon, authenticated;

-- Retention, enforced on every write: the expiry is the server's and never moves; once passed, the session is cleared.
create or replace function public._discover_session_retention()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and new.session_id = old.session_id then
    new.asked_at := old.asked_at;
    new.raw_text_expires_at := old.raw_text_expires_at;
  end if;
  if new.raw_text_expires_at <= now() and new.cleared_at is null then
    new.typed_text := null;
    new.classify_result := null;
    new.cleared_at := now();
  end if;
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function public._discover_session_retention() from public, anon, authenticated;
drop trigger if exists discover_session_retention on public.discover_sessions;
create trigger discover_session_retention before insert or update on public.discover_sessions
  for each row execute function public._discover_session_retention();

create or replace function public._discover_session_json(s public.discover_sessions)
returns jsonb language sql stable as $$
  select case when s.user_id is null then null
    when s.cleared_at is not null then jsonb_build_object('session_id', s.session_id, 'cleared_at', s.cleared_at, 'client_updated_at', s.client_updated_at)
    else jsonb_build_object('session_id', s.session_id, 'typed_text', s.typed_text, 'classify_result', s.classify_result,
      'submission_id', s.submission_id, 'root_snapshot_id', s.root_snapshot_id, 'refined', s.refined, 'asked_at', s.asked_at,
      'raw_text_expires_at', s.raw_text_expires_at, 'client_updated_at', s.client_updated_at, 'updated_at', s.updated_at) end
$$;
revoke all on function public._discover_session_json(public.discover_sessions) from public, anon, authenticated;

-- The caller's session: live, a tombstone ({session_id, cleared_at}), or null (never synced).
create or replace function public.get_discover_session()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  s discover_sessions;
begin
  if auth.uid() is null then return null; end if;
  select * into s from discover_sessions where user_id = auth.uid();
  if s.user_id is null then return null; end if;
  if s.cleared_at is null and s.raw_text_expires_at <= now() then
    update discover_sessions set typed_text = null, classify_result = null, cleared_at = now() where user_id = auth.uid() returning * into s;
  end if;
  return _discover_session_json(s);
end;
$$;
revoke all on function public.get_discover_session() from public, anon;
grant execute on function public.get_discover_session() to authenticated;

-- Save the caller's session. Accepted only when it is at least as recent as what the account holds (latest wins); returns
-- {accepted, session} with the account's session after the call, so a stale device can adopt the newer one.
create or replace function public.save_discover_session(session jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_sid uuid;
  v_at timestamptz;
  v_sub uuid;
  v_asked timestamptz;
  v_exp timestamptz;
  s discover_sessions;
begin
  if v_user is null then raise exception 'Not signed in.'; end if;
  if jsonb_typeof(session) <> 'object' or jsonb_typeof(session -> 'classify_result') <> 'object'
     or jsonb_typeof(session -> 'typed_text') <> 'string' then
    raise exception 'Not a Discover session.';
  end if;
  v_sid := (session ->> 'session_id')::uuid;
  v_at := least((session ->> 'client_updated_at')::timestamptz, now() + interval '5 minutes');
  if v_sid is null or v_at is null then raise exception 'Not a Discover session.'; end if;

  select * into s from discover_sessions where user_id = v_user for update;
  if s.user_id is not null and v_at < s.client_updated_at then
    return jsonb_build_object('accepted', false, 'session', _discover_session_json(s));
  end if;
  -- a cleared session never comes back under the same id (another device cleared it)
  if s.user_id is not null and s.session_id = v_sid and s.cleared_at is not null then
    return jsonb_build_object('accepted', false, 'session', _discover_session_json(s));
  end if;

  -- the retention clock: the linked ask's own server-stamped expiry, else first arrival of this session on the server
  v_sub := case when (session ->> 'submission_id') ~ '^[0-9a-f-]{36}$' then (session ->> 'submission_id')::uuid end;
  select i.created_at, i.raw_text_expires_at into v_asked, v_exp from intent_submissions i where i.id = v_sub and i.user_id = v_user;
  if v_exp is null then
    v_sub := null;
    v_asked := now();
    v_exp := now() + make_interval(days => raw_ask_retention_days());
  end if;

  insert into discover_sessions as d (user_id, session_id, typed_text, classify_result, submission_id, root_snapshot_id, refined,
    asked_at, raw_text_expires_at, client_updated_at, cleared_at)
  values (v_user, v_sid, left(session ->> 'typed_text', 500), session -> 'classify_result', v_sub,
    case when (session ->> 'root_snapshot_id') ~ '^[0-9a-f-]{36}$' then (session ->> 'root_snapshot_id')::uuid end,
    coalesce((session ->> 'refined')::boolean, false), v_asked, v_exp, v_at, null)
  on conflict (user_id) do update set
    session_id = excluded.session_id, typed_text = excluded.typed_text, classify_result = excluded.classify_result,
    submission_id = excluded.submission_id, root_snapshot_id = excluded.root_snapshot_id, refined = excluded.refined,
    asked_at = excluded.asked_at, raw_text_expires_at = excluded.raw_text_expires_at,
    client_updated_at = excluded.client_updated_at, cleared_at = null
  returning * into s;
  return jsonb_build_object('accepted', s.cleared_at is null, 'session', _discover_session_json(s));
end;
$$;
revoke all on function public.save_discover_session(jsonb) from public, anon;
grant execute on function public.save_discover_session(jsonb) to authenticated;

-- Clear the caller's session everywhere (a tombstone). Only a clear at least as recent as the session applies.
create or replace function public.clear_discover_session(session_id_param uuid, client_updated_at_param timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_at timestamptz := least(client_updated_at_param, now() + interval '5 minutes');
  s discover_sessions;
begin
  if auth.uid() is null then raise exception 'Not signed in.'; end if;
  select * into s from discover_sessions where user_id = auth.uid() for update;
  if s.user_id is null then return null; end if;
  if s.session_id = session_id_param or v_at >= s.client_updated_at then
    update discover_sessions set typed_text = null, classify_result = null, cleared_at = now(),
      client_updated_at = coalesce(v_at, now()) -- the clearing device's time, so its next search is never refused by another device's skewed clock
    where user_id = auth.uid() returning * into s;
  end if;
  return _discover_session_json(s);
end;
$$;
revoke all on function public.clear_discover_session(uuid, timestamptz) from public, anon;
grant execute on function public.clear_discover_session(uuid, timestamptz) to authenticated;

-- The hourly retention job also ends expired Discover sessions (text cleared, the row kept as a tombstone).
create or replace function public.purge_expired_raw_ask_text()
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_submissions integer;
  v_outcomes integer;
  v_sessions integer;
begin
  update intent_submissions set raw_text = null where raw_text is not null and raw_text_expires_at <= now();
  get diagnostics v_submissions = row_count;
  update intent_outcomes set raw_text = null where raw_text is not null and raw_text_expires_at <= now();
  get diagnostics v_outcomes = row_count;
  update discover_sessions set typed_text = null, classify_result = null, cleared_at = now() where cleared_at is null and raw_text_expires_at <= now();
  get diagnostics v_sessions = row_count;
  return jsonb_build_object('intent_submissions', v_submissions, 'intent_outcomes', v_outcomes, 'discover_sessions', v_sessions);
end $function$;
revoke all on function public.purge_expired_raw_ask_text() from public, anon, authenticated;

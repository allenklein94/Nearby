-- Typed-ask audit (2026-09-27, owner item 105, live-loop milestone). OBSERVABILITY ONLY, INTERNAL ONLY.
--
-- The typed-ask half of the evidence loop (routing_decisions is the business half):
--   typed ask -> what Nearby understood -> what Nearby showed -> what the person did -> eventual outcome.
--
--   typed_ask_snapshots   one row per typed ask on Home or Discover: the structured interpretation the ranking path used
--                         (closed vocabularies, numbers and booleans only), candidate count, removal counts per pass,
--                         rules version, and the existing intent_submissions id.
--   typed_ask_results     one row per result ACTUALLY SHOWN, in the order shown: type, id, business, final score and the
--                         canonical signal codes (with deltas) that moved it. Written from the rendered layout, never
--                         reconstructed later.
--   typed_ask_audit_failures  a failed write (the search itself never depends on this).
--   intent_outcomes.snapshot_id / result_position  the EXISTING tap event, linked to the snapshot row it came from.
--   typed_ask_result_outcomes  view: each shown result -> tapped, tap outcome, request made from that ask, offer from that
--                         business, gathering joined.
--
-- NO RAW TEXT anywhere: the RPC refuses any string that is not a short vocabulary token, drops unknown interpretation keys
-- and never stores a stated access/dietary need or a child's age (the client never sends them either). Nothing here is added
-- to the raw-ask retention purge because nothing here is ask text. No client can read any of it; no business-facing function
-- references it. Recording never changes a score or an order (the app computes the scores before recording them).

create table if not exists public.typed_ask_snapshots (
  id uuid primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  submission_id uuid references public.intent_submissions (id) on delete set null,
  surface text not null check (surface in ('home', 'discover')),
  rules_version text not null check (rules_version ~ '^[a-z0-9._-]{1,40}$'),
  outcome text check (outcome ~ '^[a-z_]{1,40}$'),
  interpretation jsonb not null default '{}'::jsonb,
  candidate_count integer check (candidate_count >= 0),
  exclusions jsonb not null default '{}'::jsonb,
  result_count integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists typed_ask_snapshots_user on public.typed_ask_snapshots (user_id, created_at desc);
create index if not exists typed_ask_snapshots_submission on public.typed_ask_snapshots (submission_id);

create table if not exists public.typed_ask_results (
  snapshot_id uuid not null references public.typed_ask_snapshots (id) on delete cascade,
  position integer not null check (position between 1 and 50),
  section text not null check (section ~ '^[a-z_]{1,20}(:[a-z_]{1,40})?$'),
  result_type text not null check (result_type ~ '^[a-z_]{1,40}$'),
  result_id text check (result_id ~ '^[A-Za-z0-9_:.-]{1,64}$'),
  partner_id uuid,
  score numeric,
  signals jsonb not null default '[]'::jsonb,
  primary key (snapshot_id, position)
);
create index if not exists typed_ask_results_result on public.typed_ask_results (result_type, result_id);

create table if not exists public.typed_ask_audit_failures (
  id bigserial primary key,
  surface text,
  error text,
  created_at timestamptz not null default now()
);

alter table public.typed_ask_snapshots enable row level security;
alter table public.typed_ask_results enable row level security;
alter table public.typed_ask_audit_failures enable row level security;
revoke all on public.typed_ask_snapshots, public.typed_ask_results, public.typed_ask_audit_failures from public, anon, authenticated;
revoke all on sequence public.typed_ask_audit_failures_id_seq from public, anon, authenticated;

-- The existing tap event gains the link (client-written, own rows only, as before). No FK on purpose: a tap may land before the
-- snapshot write does, and a failed snapshot must never make the existing tap insert fail. The view joins on the same user.
alter table public.intent_outcomes add column if not exists snapshot_id uuid;
alter table public.intent_outcomes add column if not exists result_position integer check (result_position between 1 and 50);
create index if not exists intent_outcomes_snapshot on public.intent_outcomes (snapshot_id) where snapshot_id is not null;

-- ---------------------------------------------------------------------------------------------------------------------
-- Validation helpers (no client grants)
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function public._typed_ask_token_ok(v jsonb)
returns boolean language sql immutable as $$
  select case jsonb_typeof(v)
    when 'string' then (v #>> '{}') ~ '^[A-Za-z0-9 &_''.:+/-]{1,40}$'
    when 'number' then true
    when 'boolean' then true
    when 'null' then true
    else false end
$$;
revoke all on function public._typed_ask_token_ok(jsonb) from public, anon, authenticated;

-- A value is a token, an array of tokens, or ONE level of object whose keys are snake_case and values tokens.
create or replace function public._typed_ask_value_ok(v jsonb)
returns boolean language sql immutable as $$
  select case jsonb_typeof(v)
    when 'array' then jsonb_array_length(v) <= 30 and not exists (select 1 from jsonb_array_elements(v) e where not public._typed_ask_token_ok(e))
    when 'object' then not exists (select 1 from jsonb_each(v) e where e.key !~ '^[a-z][a-z0-9_]{0,39}$' or not public._typed_ask_token_ok(e.value))
    else public._typed_ask_token_ok(v) end
$$;
revoke all on function public._typed_ask_value_ok(jsonb) from public, anon, authenticated;

-- The recordable interpretation fields (same list as utils/typedAskAudit.js INTERPRETATION_FIELDS; a Jest test keeps them equal).
create or replace function public._typed_ask_interpretation_fields()
returns text[] language sql immutable as $$
  select array['intent', 'category', 'category_group', 'preferred_category', 'date_tag', 'cuisine', 'occasion', 'combination',
    'multi_part', 'date_window', 'when_preset', 'party_size', 'party_size_stated', 'party_type', 'price_level', 'budget_max',
    'attributes', 'energies', 'formats', 'skill_levels', 'genres', 'intensity', 'effort', 'social_context', 'meet_new_people',
    'distance_willingness', 'search_widened', 'transport_mode', 'time_budget_minutes', 'clock_window', 'date_anchor',
    'commitment', 'spontaneity', 'open_now', 'open_now_chip', 'environment', 'environment_required', 'exclude', 'avoid_pricey',
    'open_ended_groups', 'vibes_avoid']::text[]
$$;
revoke all on function public._typed_ask_interpretation_fields() from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------------
-- The one write path. Never raises to the client: any problem is recorded in typed_ask_audit_failures and returns null.
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function public.record_typed_ask_snapshot(snapshot jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_id uuid;
  v_submission uuid;
  v_interp jsonb := '{}'::jsonb;
  v_excl jsonb := '{}'::jsonb;
  v_results jsonb;
  r jsonb;
  s jsonb;
  k text;
  v jsonb;
  n integer := 0;
begin
  if v_user is null then
    return null;
  end if;
  begin
    if jsonb_typeof(snapshot) <> 'object' then raise exception 'snapshot must be an object'; end if;
    v_id := (snapshot ->> 'id')::uuid;
    if v_id is null then raise exception 'missing id'; end if;

    -- submission link only when it is the caller's own
    v_submission := nullif(snapshot ->> 'submission_id', '')::uuid;
    if v_submission is not null and not exists (select 1 from intent_submissions where id = v_submission and user_id = v_user) then
      v_submission := null;
    end if;

    -- interpretation: known keys only, token values only (anything else is dropped, never stored)
    if jsonb_typeof(snapshot -> 'interpretation') = 'object' then
      for k, v in select * from jsonb_each(snapshot -> 'interpretation') loop
        if k = any (_typed_ask_interpretation_fields()) and _typed_ask_value_ok(v) and jsonb_typeof(v) <> 'null' then
          v_interp := v_interp || jsonb_build_object(k, v);
        end if;
      end loop;
    end if;
    -- access needs never recorded, even if a client sent them
    if jsonb_typeof(v_interp -> 'attributes') = 'array' then
      v_interp := jsonb_set(v_interp, '{attributes}', coalesce((select jsonb_agg(e) from jsonb_array_elements(v_interp -> 'attributes') e
        where e #>> '{}' not in ('wheelchair_accessible', 'accessible_parking', 'accessible_restroom', 'service_animal_friendly')), '[]'::jsonb));
    end if;

    if jsonb_typeof(snapshot -> 'exclusions') = 'object' then
      for k, v in select * from jsonb_each(snapshot -> 'exclusions') loop
        if k ~ '^[a-z][a-z0-9_]{0,39}$' and jsonb_typeof(v) = 'number' then
          v_excl := v_excl || jsonb_build_object(k, v);
        end if;
      end loop;
    end if;

    v_results := case when jsonb_typeof(snapshot -> 'results') = 'array' then snapshot -> 'results' else '[]'::jsonb end;
    if jsonb_array_length(v_results) > 50 then raise exception 'too many results'; end if;

    insert into typed_ask_snapshots (id, user_id, submission_id, surface, rules_version, outcome, interpretation, candidate_count,
      exclusions, result_count)
    values (v_id, v_user, v_submission, snapshot ->> 'surface', snapshot ->> 'rules_version', snapshot ->> 'outcome', v_interp,
      nullif(snapshot ->> 'candidate_count', '')::integer, v_excl, jsonb_array_length(v_results))
    on conflict (id) do nothing;
    if not found then
      return v_id; -- a retry of the same snapshot: already recorded
    end if;

    for r in select * from jsonb_array_elements(v_results) loop
      -- signals: [{code, delta}] with a snake_case code and a numeric delta only
      s := coalesce((select jsonb_agg(jsonb_build_object('code', e ->> 'code', 'delta', (e ->> 'delta')::numeric))
        from jsonb_array_elements(case when jsonb_typeof(r -> 'signals') = 'array' then r -> 'signals' else '[]'::jsonb end) e
        where jsonb_typeof(e) = 'object' and (e ->> 'code') ~ '^[a-z][a-z0-9_]{0,39}$' and jsonb_typeof(e -> 'delta') = 'number'), '[]'::jsonb);
      insert into typed_ask_results (snapshot_id, position, section, result_type, result_id, partner_id, score, signals)
      values (v_id, (r ->> 'position')::integer, r ->> 'section', r ->> 'result_type', r ->> 'result_id',
        case when (r ->> 'partner_id') ~ '^[0-9a-f-]{36}$' then (r ->> 'partner_id')::uuid end,
        case when jsonb_typeof(r -> 'score') = 'number' then (r ->> 'score')::numeric end, s);
      n := n + 1;
    end loop;
    return v_id;
  exception when others then
    insert into typed_ask_audit_failures (surface, error) values (left(snapshot ->> 'surface', 20), left(sqlerrm, 500));
    return null;
  end;
end;
$$;
revoke all on function public.record_typed_ask_snapshot(jsonb) from public, anon;
grant execute on function public.record_typed_ask_snapshot(jsonb) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------
-- Analysis view (no client grants): each shown result -> what happened next. Only links the same person's own events.
-- ---------------------------------------------------------------------------------------------------------------------
create or replace view public.typed_ask_result_outcomes as
select
  s.id as snapshot_id, s.surface, s.rules_version, s.submission_id, s.created_at as asked_at, s.outcome as ask_outcome,
  s.interpretation, r.position, r.section, r.result_type, r.result_id, r.partner_id, r.score, r.signals,
  tap.selected_at as tapped_at, tap.outcome as tap_outcome, tap.would_repeat as tap_would_repeat,
  req.id as request_id, req.status as request_status, req.created_at as requested_at,
  ofr.status as offer_status,
  gi.status as gathering_join_status, gi.created_at as gathering_joined_at
from public.typed_ask_snapshots s
join public.typed_ask_results r on r.snapshot_id = s.id
left join lateral (
  select o.selected_at, o.outcome, o.would_repeat from public.intent_outcomes o
  where o.user_id = s.user_id
    and ((o.snapshot_id = s.id and o.result_position = r.position)
      or (o.snapshot_id is null and s.submission_id is not null and o.submission_id = s.submission_id
          and o.result_type = r.result_type and o.result_id::text = r.result_id))
  order by o.selected_at limit 1
) tap on true
left join lateral (
  select br.id, br.status, br.created_at from public.business_requests br
  where s.submission_id is not null and br.submission_id = s.submission_id and br.requester_id = s.user_id
    and (r.partner_id is null or br.target_partner_id is null or br.target_partner_id = r.partner_id)
  order by br.created_at limit 1
) req on r.partner_id is not null or r.result_type like 'business_%'
left join lateral (
  select bo.status from public.business_request_offers bo
  where bo.request_id = req.id and bo.partner_id = r.partner_id
  order by bo.status = 'accepted' desc limit 1
) ofr on req.id is not null and r.partner_id is not null
left join lateral (
  select g.status, g.created_at from public.gathering_interest g
  where r.result_type = 'gathering' and g.user_id = s.user_id and g.gathering_id::text = r.result_id and g.created_at >= s.created_at
  limit 1
) gi on true;
revoke all on public.typed_ask_result_outcomes from public, anon, authenticated;

-- Typed-ask refinement chips on the audit (2026-09-27, owner item 107 follow-up: Home + Discover share the chips). A refinement is
-- recorded as its own snapshot (resulting interpretation + the results actually shown, in order) linked to the ORIGINAL ask's
-- snapshot, with which chip and whether it was applied or removed. Same rules as 20270238: no text, internal only, the write
-- never raises. The function keeps its one signature (single overload).

alter table public.typed_ask_snapshots add column if not exists parent_snapshot_id uuid references public.typed_ask_snapshots (id) on delete set null;
alter table public.typed_ask_snapshots add column if not exists refinement_key text check (refinement_key in ('friends', 'date', 'solo', 'under_25'));
alter table public.typed_ask_snapshots add column if not exists refinement_action text check (refinement_action in ('applied', 'removed'));
alter table public.typed_ask_snapshots drop constraint if exists typed_ask_snapshots_refinement_pair;
alter table public.typed_ask_snapshots add constraint typed_ask_snapshots_refinement_pair check ((refinement_key is null) = (refinement_action is null));
-- The token check also accepts $ (price tiers $, $$, $$$; they were being dropped from the recorded interpretation).
create or replace function public._typed_ask_token_ok(v jsonb)
returns boolean language sql immutable as $fn$
  select case jsonb_typeof(v)
    when 'string' then (v #>> '{}') ~ '^[A-Za-z0-9 &_''.:+/$-]{1,40}$'
    when 'number' then true
    when 'boolean' then true
    when 'null' then true
    else false end
$fn$;
revoke all on function public._typed_ask_token_ok(jsonb) from public, anon, authenticated;

create index if not exists typed_ask_snapshots_parent on public.typed_ask_snapshots (parent_snapshot_id) where parent_snapshot_id is not null;

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
  v_parent uuid;
  v_ref_key text;
  v_ref_action text;
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

    -- a refinement chip: which one, applied or removed, and the caller's OWN original snapshot it refines
    v_ref_key := snapshot ->> 'refinement_key';
    v_ref_action := snapshot ->> 'refinement_action';
    if v_ref_key is not null and (v_ref_key not in ('friends', 'date', 'solo', 'under_25') or v_ref_action not in ('applied', 'removed')) then
      v_ref_key := null;
      v_ref_action := null;
    end if;
    if v_ref_key is null then v_ref_action := null; end if;
    v_parent := case when (snapshot ->> 'parent_snapshot_id') ~ '^[0-9a-f-]{36}$' then (snapshot ->> 'parent_snapshot_id')::uuid end;
    if v_parent is not null and not exists (select 1 from typed_ask_snapshots where id = v_parent and user_id = v_user) then
      v_parent := null;
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
      exclusions, result_count, parent_snapshot_id, refinement_key, refinement_action)
    values (v_id, v_user, v_submission, snapshot ->> 'surface', snapshot ->> 'rules_version', snapshot ->> 'outcome', v_interp,
      nullif(snapshot ->> 'candidate_count', '')::integer, v_excl, jsonb_array_length(v_results), v_parent, v_ref_key, v_ref_action)
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

-- The analysis view carries the refinement fields too (columns appended, so the view is replaced in place).
create or replace view public.typed_ask_result_outcomes as
select
  s.id as snapshot_id, s.surface, s.rules_version, s.submission_id, s.created_at as asked_at, s.outcome as ask_outcome,
  s.interpretation, r.position, r.section, r.result_type, r.result_id, r.partner_id, r.score, r.signals,
  tap.selected_at as tapped_at, tap.outcome as tap_outcome, tap.would_repeat as tap_would_repeat,
  req.id as request_id, req.status as request_status, req.created_at as requested_at,
  ofr.status as offer_status,
  gi.status as gathering_join_status, gi.created_at as gathering_joined_at,
  s.parent_snapshot_id, s.refinement_key, s.refinement_action
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

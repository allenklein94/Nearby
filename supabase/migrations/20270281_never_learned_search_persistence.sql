-- Item 183 follow-up (owner, 2026-10-03, LOCKED): never-learned categories are stripped at the PERSISTENCE boundary.
-- A typed search may still resolve "church" (and any other wording of a never-learned category, today Faith &
-- Spirituality, the one list in _category_never_learned) and return results for that request. But nothing about it is
-- kept: the search log, the tap log and the typed-ask audit store no category, no words and no result title for it.
-- Because every downstream reader takes the category from those rows, it therefore cannot enter business demand counts
-- (get_partner_demand_signals), internal category trends, the intent funnel's category, learned
-- affinity (20270280), ranking explanations or Settings "What Nearby has noticed". A DECLARED profile interest is a direct
-- user choice and is untouched. Enforced here in the database (every write path, any client version); the app strips
-- the same rows before sending (src/constants/neverLearned.js). 0 existing rows matched.

create or replace function public._strip_never_learned_search()
returns trigger language plpgsql set search_path = public as $$
begin
  if public._category_never_learned(new.category) then
    new.category := null;
    new.raw_text := null;
    if tg_table_name = 'intent_outcomes' then new.result_title := null; end if;
  end if;
  return new;
end;
$$;
revoke all on function public._strip_never_learned_search() from public, anon, authenticated;
-- the trigger runs as the writer; it only calls this pure check
grant execute on function public._category_never_learned(text) to authenticated;

-- "a_" sorts before raw_ask_text_retention, so the retention trigger sees the stripped row.
drop trigger if exists a_strip_never_learned_search on public.intent_submissions;
create trigger a_strip_never_learned_search before insert or update on public.intent_submissions
  for each row execute function public._strip_never_learned_search();
drop trigger if exists a_strip_never_learned_search on public.intent_outcomes;
create trigger a_strip_never_learned_search before insert or update on public.intent_outcomes
  for each row execute function public._strip_never_learned_search();

CREATE OR REPLACE FUNCTION public.record_typed_ask_snapshot(snapshot jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  -- item 183: a typed ask about a never-learned category (religion) is resolved for that search only and never audited.
  if public._category_never_learned(snapshot #>> '{interpretation,category}')
     or public._category_never_learned(snapshot #>> '{interpretation,preferred_category}')
     or public._category_never_learned(snapshot #>> '{interpretation,date_tag}') then
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
    if v_ref_key is not null and (v_ref_key not in ('friends', 'date', 'solo', 'under_25', 'category') or v_ref_action not in ('applied', 'removed')) then
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
$function$;
revoke all on function public.record_typed_ask_snapshot(jsonb) from public, anon;
grant execute on function public.record_typed_ask_snapshot(jsonb) to authenticated;

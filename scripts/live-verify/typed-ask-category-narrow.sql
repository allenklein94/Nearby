-- Item 108: a category narrowing is recorded like a refinement chip, linked to the original ask. Rolled back.
begin;
do $$
declare
  u uuid := (select id from profiles order by created_at limit 1);
  root uuid := gen_random_uuid();
  child uuid := gen_random_uuid();
  r record;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  perform record_typed_ask_snapshot(jsonb_build_object('id', root, 'surface', 'discover', 'rules_version', 'typed-ask-audit-v1', 'outcome', 'results',
    'interpretation', jsonb_build_object('date_window', 'tonight', 'party_type', 'friends'), 'results', '[]'::jsonb));
  perform record_typed_ask_snapshot(jsonb_build_object('id', child, 'surface', 'discover', 'rules_version', 'typed-ask-audit-v1', 'outcome', 'results',
    'interpretation', jsonb_build_object('date_window', 'tonight', 'party_type', 'friends', 'narrow_group', 'activities_recreation'),
    'refinement_key', 'category', 'refinement_action', 'applied', 'parent_snapshot_id', root,
    'results', jsonb_build_array(jsonb_build_object('position', 0, 'section', 'top', 'result_type', 'gathering', 'result_id', 'g1', 'signals', '[]'::jsonb))));
  select * into r from typed_ask_snapshots where id = child;
  if r.refinement_key <> 'category' or r.refinement_action <> 'applied' or r.parent_snapshot_id <> root
     or r.interpretation ->> 'narrow_group' <> 'activities_recreation' or r.interpretation ->> 'party_type' <> 'friends' or r.result_count <> 1 then
    raise exception 'category narrowing not recorded: %', row_to_json(r);
  end if;
  -- an unknown refinement key is dropped, not stored
  perform record_typed_ask_snapshot(jsonb_build_object('id', gen_random_uuid(), 'surface', 'discover', 'rules_version', 'typed-ask-audit-v1',
    'outcome', 'results', 'refinement_key', 'bogus', 'refinement_action', 'applied', 'results', '[]'::jsonb));
  if exists (select 1 from typed_ask_snapshots where refinement_key = 'bogus') then raise exception 'bogus key stored'; end if;
  raise notice 'ALL OK';
end $$;
select 'ALL OK' as result;
rollback;

-- Taxonomy code dependencies (migration 20270233). ROLLED BACK. Uses a synthetic inventory inside the transaction (the
-- real synced one is restored by the rollback): a rename / move / retirement that leaves app code on the old name is
-- recorded as INCOMPLETE with one follow-up per stale reference, resolved only by syncing updated code or by a named,
-- reasoned waiver; no inventory = no change at all.
begin;
do $$
declare
  admin_id uuid := (select id from profiles where is_admin order by created_at limit 1);
  user_id uuid := (select id from profiles where not coalesce(is_admin, false) order by created_at limit 1);
  p jsonb; r jsonb; ok boolean; fid bigint;
  inv_old jsonb := jsonb_build_object('format', 1, 'rows', jsonb_build_array(
    jsonb_build_object('tag', 'LV Code Alpha', 'file', 'src/constants/onboardingInterests.js', 'consumer', 'quick_picks', 'occurrences', 1, 'group', null),
    jsonb_build_object('tag', 'LV Code Alpha', 'file', 'src/constants/energyLevel.js', 'consumer', 'energy', 'occurrences', 1, 'group', null),
    jsonb_build_object('tag', 'LV Code Alpha', 'file', 'src/constants/gatheringCategories.js', 'consumer', 'baseline_taxonomy', 'occurrences', 1, 'group', 'food_drink'),
    jsonb_build_object('tag', 'LV Code Alpha', 'file', 'docs/business.html', 'consumer', 'static_signup_export', 'occurrences', 1, 'group', 'food_drink')));
begin
  perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
  perform admin_add_category_tag('LV Code Alpha', 'food_drink');

  -- No inventory at all -> fail closed.
  delete from category_code_inventory_state;
  p := admin_preview_category_change('rename', 'LV Code Alpha', 'LV Code Beta');
  assert (p->>'blockers') ilike '%never been synced%', 'no inventory = the change is blocked';

  perform sync_category_code_dependencies(inv_old, 'test-commit-1');
  p := admin_preview_category_change('rename', 'LV Code Alpha', 'LV Code Beta');
  assert jsonb_array_length(p->'blockers') = 0, 'clean once the inventory exists';
  assert jsonb_array_length(p->'code'->'dependencies') = 4, 'preview names all 4 code references';
  assert not (p->>'complete_after_commit')::boolean, 'preview says the change will be incomplete';
  assert (p->>'warnings') ilike '%INCOMPLETE%' and (p->>'warnings') ilike '%quick_picks%', 'warning names the consumers';

  -- The token binds the code inventory too.
  perform sync_category_code_dependencies(jsonb_set(inv_old, '{rows,0,occurrences}', '2'), 'test-commit-2');
  begin perform admin_rename_category_tag('LV Code Alpha', 'LV Code Beta', 'Clearer name for everyone', p->>'impact_token', gen_random_uuid()); ok := false;
  exception when others then ok := sqlerrm ilike '%preview it again%'; end;
  assert ok, 'an inventory change after the preview invalidates it';

  -- Rename: committed data-side, but INCOMPLETE with one follow-up per stale reference.
  p := admin_preview_category_change('rename', 'LV Code Alpha', 'LV Code Beta');
  r := admin_rename_category_tag('LV Code Alpha', 'LV Code Beta', 'Clearer name for everyone', p->>'impact_token', '00000000-0000-4000-8000-000000000001');
  assert (r->>'changed')::boolean and not (r->>'complete')::boolean, 'rename committed but NOT complete';
  assert (r->>'open_code_followups')::int = 4, 'four open follow-ups';
  assert (get_category_taxonomy()->>'pending_code_updates')::int >= 4, 'the public snapshot reports pending code updates';
  r := admin_rename_category_tag('LV Code Alpha', 'LV Code Beta', 'Clearer name for everyone', p->>'impact_token', '00000000-0000-4000-8000-000000000001');
  assert (r->>'replayed')::boolean and (r->>'open_code_followups')::int = 4, 'a retry reports the same status, no duplicate follow-ups';

  -- Code partly updated: quick picks, energy and the baseline now say Beta; the static export still says Alpha.
  r := sync_category_code_dependencies(jsonb_build_object('format', 1, 'rows', jsonb_build_array(
    jsonb_build_object('tag', 'LV Code Beta', 'file', 'src/constants/onboardingInterests.js', 'consumer', 'quick_picks', 'occurrences', 1),
    jsonb_build_object('tag', 'LV Code Beta', 'file', 'src/constants/energyLevel.js', 'consumer', 'energy', 'occurrences', 1),
    jsonb_build_object('tag', 'LV Code Beta', 'file', 'src/constants/gatheringCategories.js', 'consumer', 'baseline_taxonomy', 'occurrences', 1, 'group', 'food_drink'),
    jsonb_build_object('tag', 'LV Code Alpha', 'file', 'docs/business.html', 'consumer', 'static_signup_export', 'occurrences', 1, 'group', 'food_drink'))), 'test-commit-3');
  assert (r->>'resolved')::int = 3, 'syncing updated code resolved 3 follow-ups';
  assert (select count(*) from admin_get_taxonomy_followups() where current_tag = 'LV Code Beta') = 1, 'the stale signup export stays open';
  assert (select resolved_by_commit from category_code_followups where source_file = 'src/constants/energyLevel.js' and name = 'LV Code Alpha') = 'test-commit-3',
    'resolution records the commit';

  -- Waiver: only an admin, only with a reason, and the row stays.
  select followup_id into fid from admin_get_taxonomy_followups() where current_tag = 'LV Code Beta';
  begin perform admin_waive_taxonomy_followup(fid, 'meh'); ok := false; exception when others then ok := sqlerrm ilike '%say why%'; end;
  assert ok, 'a waiver needs a reason';
  perform set_config('request.jwt.claims', json_build_object('sub', user_id, 'role', 'authenticated')::text, true);
  begin perform admin_waive_taxonomy_followup(fid, 'I would like to skip this'); ok := false; exception when others then ok := sqlerrm ilike '%only an admin%'; end;
  assert ok, 'a non-admin cannot waive';
  begin perform admin_get_taxonomy_followups(); ok := false; exception when others then ok := sqlerrm ilike '%only an admin%'; end;
  assert ok, 'a non-admin cannot list follow-ups';
  perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
  r := admin_waive_taxonomy_followup(fid, 'Export is regenerated at the next release');
  assert (r->>'complete')::boolean, 'with the last one waived, the change is complete';
  begin delete from category_code_followups where id = fid; ok := false; exception when others then ok := sqlerrm ilike '%append-only%'; end;
  assert ok, 'follow-ups are never deleted';
  begin update category_code_followups set status = 'open' where id = fid; ok := false; exception when others then ok := sqlerrm ilike '%closed%'; end;
  assert ok, 'a closed follow-up cannot reopen';

  -- Move: only files that PLACE the tag in a group are stale.
  p := admin_preview_category_change('move', 'LV Code Beta', null, 'entertainment_nightlife');
  assert jsonb_array_length(p->'code'->'dependencies') = 1
     and p->'code'->'dependencies'->0->>'file' = 'src/constants/gatheringCategories.js', 'move flags the baseline placement only (energy/quick picks unaffected)';
  r := admin_move_category_tag('LV Code Beta', 'entertainment_nightlife', 'It is a nightlife thing', p->>'impact_token', gen_random_uuid());
  assert not (r->>'complete')::boolean and r->'code_followups'->0->>'kind' = 'move_group', 'move is incomplete until the baseline moves';
  r := sync_category_code_dependencies(jsonb_build_object('format', 1, 'rows', jsonb_build_array(
    jsonb_build_object('tag', 'LV Code Beta', 'file', 'src/constants/onboardingInterests.js', 'consumer', 'quick_picks', 'occurrences', 1),
    jsonb_build_object('tag', 'LV Code Beta', 'file', 'src/constants/gatheringCategories.js', 'consumer', 'baseline_taxonomy', 'occurrences', 1, 'group', 'entertainment_nightlife'))), 'test-commit-4');
  assert (select count(*) from admin_get_taxonomy_followups() where current_tag = 'LV Code Beta') = 0, 'moved in code -> resolved';

  -- Retire keeping rows: only places that OFFER it must stop (quick picks, the baseline list); interpreting maps may stay.
  update gatherings set interest_tag = 'LV Code Beta' where id = (select id from gatherings order by created_at limit 1);
  p := admin_preview_category_change('retire', 'LV Code Beta', null, null, null, true);
  assert jsonb_array_length(p->'code'->'dependencies') = 2
     and (select bool_and(d->>'kind' = 'stop_offering') from jsonb_array_elements(p->'code'->'dependencies') d),
    'retire flags the places that offer it: the quick pick and the baseline list';
  r := admin_retire_category_tag('LV Code Beta', null, true, 'Nobody should pick this now', p->>'impact_token', gen_random_uuid());
  assert not (r->>'complete')::boolean, 'retirement incomplete while the app still offers it';

  assert not has_function_privilege('authenticated', 'sync_category_code_dependencies(jsonb,text)', 'execute'), 'clients cannot sync';
  assert not has_function_privilege('anon', 'sync_category_code_dependencies(jsonb,text)', 'execute'), 'anon cannot sync';
  assert not has_table_privilege('authenticated', 'category_code_followups', 'select'), 'clients cannot read follow-ups directly';
end $$;
select 'ALL OK' as result;
rollback;

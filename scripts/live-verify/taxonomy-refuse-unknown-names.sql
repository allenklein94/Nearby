-- AI suggests, the canonical taxonomy governs (migration 20270235). ROLLED BACK; runs on prod or a replay database.
-- Every registered category-name column refuses a name that is not a category when it is newly written; real names
-- (any case) are accepted and written in canonical case; a value a row already carried is kept.
begin;
do $$
declare r record; n int; ok boolean; q text; tested int := 0;
  g_id uuid := (select id from gatherings order by created_at limit 1);
  p_id uuid := (select id from profiles order by created_at limit 1);
begin
  perform set_config('app.trusted_update', 'true', true);

  -- the trigger is on every table that has a registered, normalized column
  assert (select count(distinct table_name) from category_tag_references where normalize_on_write)
       = (select count(*) from pg_trigger where tgname = 'a_taxonomy_normalize_tags' and not tgisinternal),
    'every registered table carries the normalize trigger';

  -- an invented name is refused on every registered column that has a row to test
  for r in select table_name t, column_name c, is_array a from category_tag_references where normalize_on_write loop
    execute format('select count(*) from %I', r.t) into n;
    continue when n = 0;
    q := format('update %I set %I = %s where ctid = (select ctid from %I limit 1)', r.t, r.c,
                case when r.a then 'array[''Zzq Invented Cat'']' else '''Zzq Invented Cat''' end, r.t);
    begin execute q; ok := false;
    exception when others then ok := sqlerrm ilike '%not a Nearby category%' or sqlerrm ilike '%foreign key%' or sqlerrm ilike '%invalid category%'; end;
    assert ok, format('%s.%s refuses an invented category', r.t, r.c);
    tested := tested + 1;
  end loop;
  assert tested >= 10, format('tested %s columns', tested);

  -- real names are accepted, in any case, and stored in canonical case
  update gatherings set interest_tag = 'live music' where id = g_id;
  assert (select interest_tag from gatherings where id = g_id) = 'Live Music', 'case normalized to the canonical name';
  update profiles set interests = array['coffee', 'Pickleball'] where id = p_id;
  assert (select interests from profiles where id = p_id) = array['Coffee', 'Pickleball'], 'array names normalized';

  -- a value a row already carried is kept (the rule never rewrites or blocks existing rows)
  alter table profiles disable trigger a_taxonomy_normalize_tags;
  update profiles set interests = array['Zzq Legacy'] where id = p_id;
  alter table profiles enable trigger a_taxonomy_normalize_tags;
  update profiles set interests = array['Zzq Legacy', 'Coffee'] where id = p_id;
  assert (select interests from profiles where id = p_id) = array['Zzq Legacy', 'Coffee'], 'existing value kept, real one added';
  update profiles set display_name = display_name where id = p_id;   -- unrelated edit of that row still works
  begin update profiles set interests = array['Zzq Legacy', 'Zzq Another'] where id = p_id; ok := false;
  exception when others then ok := sqlerrm ilike '%"Zzq Another" is not a Nearby category%'; end;
  assert ok, 'a second invented name is refused even beside a kept one';
  begin update profiles set interests = array['Zzq Another'] where id = p_id; ok := false;
  exception when others then ok := sqlerrm ilike '%not a Nearby category%'; end;
  assert ok, 'dropping the kept value does not open the door to a new one';
end $$;
select 'ALL OK' as result;
rollback;

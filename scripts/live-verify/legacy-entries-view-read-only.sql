-- Live verification for 20270140 (Management API; final RAISE rolls back). Expected: anon SELECT/UPDATE/DELETE refused; authenticated SELECT ok (1), UPDATE/DELETE refused; base table SELECT still closed (0).
-- Pre-fix proof (run before the migration): anon UPDATE and DELETE through the view each affected 1 row.
do $$
declare res text:=''; rid uuid; n int; m uuid; u uuid;
begin
  select id, user_a into m, u from matches limit 1;
  insert into relationship_legacy_entries(match_id, submitted_by, what_surprised_us) values (m, u, 'original') returning id into rid;
  -- anon
  perform set_config('request.jwt.claims','{"role":"anon"}',true);
  set local role anon;
  begin select count(*) into n from relationship_legacy_entries_public; res:=res||'anon SELECT: rows '||n||E'\n'; exception when others then res:=res||'anon SELECT refused: '||sqlerrm||E'\n'; end;
  begin update relationship_legacy_entries_public set what_surprised_us='x' where id=rid; res:=res||E'anon UPDATE: ALLOWED (bad)\n'; exception when others then res:=res||'anon UPDATE refused: '||sqlerrm||E'\n'; end;
  begin delete from relationship_legacy_entries_public where id=rid; res:=res||E'anon DELETE: ALLOWED (bad)\n'; exception when others then res:=res||'anon DELETE refused: '||sqlerrm||E'\n'; end;
  reset role;
  -- authenticated
  perform set_config('request.jwt.claims', json_build_object('sub',u,'role','authenticated')::text, true);
  set local role authenticated;
  begin select count(*) into n from relationship_legacy_entries_public where id=rid; res:=res||'authenticated SELECT (anonymized view still works): '||n||E'\n'; exception when others then res:=res||'authenticated SELECT ERROR: '||sqlerrm||E'\n'; end;
  begin update relationship_legacy_entries_public set what_surprised_us='x' where id=rid; res:=res||E'authenticated UPDATE: ALLOWED (bad)\n'; exception when others then res:=res||'authenticated UPDATE refused: '||sqlerrm||E'\n'; end;
  begin delete from relationship_legacy_entries_public where id=rid; res:=res||E'authenticated DELETE: ALLOWED (bad)\n'; exception when others then res:=res||'authenticated DELETE refused: '||sqlerrm||E'\n'; end;
  begin select count(*) into n from relationship_legacy_entries where id=rid; res:=res||'authenticated base-table SELECT (still closed): '||n||E'\n'; exception when others then res:=res||'authenticated base SELECT: '||sqlerrm||E'\n'; end;
  reset role;
  raise exception E'RESULT\n%', res;
end $$;

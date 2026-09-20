-- Live verification for 20270143 (Management API; the final RAISE rolls back).
-- Expected: authenticated TRUNCATE refused; read/update own profile OK; SECURITY DEFINER RPCs still run.
-- NOTE: LOCK TABLE stays ALLOWED for authenticated (Postgres lets UPDATE/DELETE holders take ACCESS EXCLUSIVE); VACUUM cannot be tested inside a transaction -- use has_table_privilege(...,'maintain') = false instead.
do $$
declare res text:=''; n int; u uuid := '0d7cecd9-721f-4632-8b1f-44b866d1892b'; gid uuid;
begin
  perform set_config('request.jwt.claims', json_build_object('sub',u,'role','authenticated')::text, true);
  set local role authenticated;
  begin truncate table gathering_interest; res:=res||E'authenticated TRUNCATE: ALLOWED (bad)\n'; exception when others then res:=res||'authenticated TRUNCATE refused: '||sqlerrm||E'\n'; end;
  begin lock table profiles in access exclusive mode; res:=res||E'authenticated LOCK TABLE: ALLOWED (bad)\n'; exception when others then res:=res||'authenticated LOCK TABLE refused: '||sqlerrm||E'\n'; end;
  begin vacuum profiles; res:=res||E'authenticated VACUUM: ALLOWED (bad)\n'; exception when others then res:=res||'authenticated VACUUM refused: '||sqlerrm||E'\n'; end;
  begin select count(*) into n from profiles where id=u; update profiles set display_name=display_name where id=u; res:=res||E'authenticated read+update own profile: OK\n'; exception when others then res:=res||'authenticated profile ERROR: '||sqlerrm||E'\n'; end;
  begin select count(*) into n from gathering_interest; res:=res||'authenticated read gathering_interest: OK ('||n||E')\n'; exception when others then res:=res||'authenticated read ERROR: '||sqlerrm||E'\n'; end;
  begin select id into gid from gatherings limit 1; perform get_gathering_interested_count(gid); res:=res||E'authenticated SECURITY DEFINER RPC: OK\n'; exception when others then res:=res||'authenticated RPC ERROR: '||sqlerrm||E'\n'; end;
  reset role;
  begin truncate table _nonexistent_ok; exception when others then null; end;
  raise exception E'RESULT\n%', res;
end $$;

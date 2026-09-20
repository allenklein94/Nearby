-- Live verification for 20270141/20270142 (Management API; the final RAISE rolls everything back).
-- Expected: anon acquisition insert OK; anon insert/update/TRUNCATE/LOCK refused; anon SELECT still ok; anon RPC callable; authenticated own-profile read+update OK.
do $$
declare res text:=''; n int; e uuid; u uuid := '0d7cecd9-721f-4632-8b1f-44b866d1892b';
begin
  perform set_config('request.jwt.claims','{"role":"anon"}',true);
  set local role anon;
  begin insert into business_acquisition_events(session_id,event) values (gen_random_uuid(),'landing_viewed'); res:=res||E'anon insert business_acquisition_events (public landing page): OK\n'; exception when others then res:=res||'anon acquisition insert FAILED: '||sqlerrm||E'\n'; end;
  begin insert into reports(reporter_id,reported_id,reason) values (u,u,'x'); res:=res||E'anon insert reports: ALLOWED (bad)\n'; exception when others then res:=res||'anon insert reports refused: '||sqlerrm||E'\n'; end;
  begin update profiles set display_name='x'; res:=res||E'anon update profiles: ALLOWED (bad)\n'; exception when others then res:=res||'anon update profiles refused: '||sqlerrm||E'\n'; end;
  begin truncate table gathering_interest; res:=res||E'anon TRUNCATE: ALLOWED (bad)\n'; exception when others then res:=res||'anon TRUNCATE refused: '||sqlerrm||E'\n'; end;
  begin lock table profiles in access exclusive mode; res:=res||E'anon LOCK TABLE: ALLOWED (bad)\n'; exception when others then res:=res||'anon LOCK TABLE refused: '||sqlerrm||E'\n'; end;
  begin select count(*) into n from gathering_messages; res:=res||'anon SELECT still ok (cross-table policies): '||n||E'\n'; exception when others then res:=res||'anon SELECT ERROR: '||sqlerrm||E'\n'; end;
  reset role;
  -- public anon-callable RPCs still work (SECURITY DEFINER)
  perform set_config('request.jwt.claims','{"role":"anon"}',true);
  set local role anon;
  begin perform get_public_gathering_invite_preview('00000000-0000-0000-0000-000000000000'); res:=res||E'anon RPC get_public_gathering_invite_preview: callable\n'; exception when others then res:=res||'anon RPC error: '||sqlerrm||E'\n'; end;
  reset role;
  -- signed-in privileges untouched
  perform set_config('request.jwt.claims', json_build_object('sub',u,'role','authenticated')::text, true);
  set local role authenticated;
  begin select count(*) into n from profiles where id=u; update profiles set display_name=display_name where id=u; res:=res||E'authenticated read+update own profile: OK\n'; exception when others then res:=res||'authenticated ERROR: '||sqlerrm||E'\n'; end;
  reset role;
  raise exception E'RESULT\n%', res;
end $$;

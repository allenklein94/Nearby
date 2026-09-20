-- Live verification for 20270139 (Management API; the final RAISE rolls back and returns the result lines).
-- Expected: anon insert/delete refused (permission denied); gathering_messages ok 0. stories/storage.objects errors for anon are pre-existing (other functions).
do $$
declare res text := ''; n int;
begin
  perform set_config('request.jwt.claims','{"role":"anon"}',true);
  set local role anon;
  begin insert into gathering_interest(gathering_id,user_id,status) select gathering_id,user_id,'approved' from gathering_interest limit 1; res:=res||E'anon insert: ALLOWED (bad)\n';
  exception when others then res:=res||'anon insert: refused ('||sqlerrm||E')\n'; end;
  begin delete from gathering_interest; get diagnostics n = row_count; res:=res||'anon delete: no error, rows='||n||E'\n';
  exception when others then res:=res||'anon delete: refused ('||sqlerrm||E')\n'; end;
  begin select count(*) into n from gathering_messages; res:=res||'anon gathering_messages: ok '||n||E'\n';
  exception when others then res:=res||'anon gathering_messages ERROR '||sqlerrm||E'\n'; end;
  begin select count(*) into n from stories; res:=res||'anon stories: ok '||n||E'\n';
  exception when others then res:=res||'anon stories ERROR '||sqlerrm||E'\n'; end;
  begin select count(*) into n from storage.objects; res:=res||'anon storage.objects: ok '||n||E'\n';
  exception when others then res:=res||'anon storage.objects ERROR '||sqlerrm||E'\n'; end;
  reset role;
  raise exception E'RESULT\n%', res;
end $$;

-- Live verification for 20270138 (run via the Management API; the final RAISE rolls everything back and returns the result lines).
-- Expected: no block 1 / C blocked B: C sees B 0, B sees C 0 / B blocked C: C sees B 0 / own row 1 / host sees all 2 / anon read no error.
do $$
declare
  a uuid := '0d7cecd9-721f-4632-8b1f-44b866d1892b'; -- host
  b uuid := 'd15758e7-63d0-450c-9475-9188f26a50ec'; -- attendee
  c uuid := 'e9f74b5a-d1df-4a82-968c-a0f6a73c128a'; -- viewer
  gid uuid; res text := ''; n int;
begin
  -- clone an existing gathering as a disposable one hosted by a
  create temp table _g on commit drop as select * from gatherings limit 1;
  gid := gen_random_uuid();
  update _g set id = gid, host_id = a;
  insert into gatherings select * from _g;
  delete from gathering_interest where gathering_id = gid;
  insert into gathering_interest(gathering_id,user_id,status) values (gid,b,'approved'),(gid,c,'approved');

  perform set_config('request.jwt.claims', json_build_object('sub',c,'role','authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from gathering_interest where gathering_id=gid and user_id=b; res := res||'no block, C sees B: '||n||E'\n';
  reset role;

  insert into blocks(blocker_id,blocked_id) values (c,b);       -- C blocked B
  perform set_config('request.jwt.claims', json_build_object('sub',c,'role','authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from gathering_interest where gathering_id=gid and user_id=b; res := res||'C blocked B, C sees B: '||n||E'\n';
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub',b,'role','authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from gathering_interest where gathering_id=gid and user_id=c; res := res||'C blocked B, B sees C: '||n||E'\n';
  reset role;

  delete from blocks where blocker_id=c and blocked_id=b;
  insert into blocks(blocker_id,blocked_id) values (b,c);       -- B blocked C (the case the client could not see)
  perform set_config('request.jwt.claims', json_build_object('sub',c,'role','authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from gathering_interest where gathering_id=gid and user_id=b; res := res||'B blocked C, C sees B: '||n||E'\n';
  select count(*) into n from gathering_interest where gathering_id=gid and user_id=c; res := res||'C sees own row: '||n||E'\n';
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub',a,'role','authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from gathering_interest where gathering_id=gid; res := res||'host sees all: '||n||E'\n';
  reset role;
  set local role anon;
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  select count(*) into n from gathering_interest where gathering_id=gid; res := res||'anon read (no error): '||n||E'\n';
  reset role;
  raise exception E'RESULT\n%', res;
end $$;

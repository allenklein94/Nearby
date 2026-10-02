-- Community chat hides a sender's messages from a viewer when EITHER of them blocked the other (migration
-- 20270264). Reads run as real users under the authenticated role, through the same RLS every client read uses (chat
-- history, the by-id fetch a realtime arrival triggers, Home's recent-message count). Always rolls back: append
-- `rollback;`. Every row must read ok = true.
begin;
create temp table out(k text, v text) on commit drop;
grant all on out to authenticated;
do $$
declare a uuid; b uuid; c uuid; d uuid; cid uuid; cm uuid;
begin
  select id into a from profiles order by id limit 1;                                   -- viewer
  select id into b from profiles where id <> a order by id limit 1;                      -- member, never blocked
  select id into c from profiles where id not in (a, b) order by id limit 1;             -- member in the block pair
  select id into d from profiles where id not in (a, b, c) order by id limit 1;          -- non-member
  delete from blocks where blocker_id in (a, b, c) and blocked_id in (a, b, c);
  insert into communities (name, creator_id) values ('Chat block test', a) returning id into cid;
  insert into community_members (community_id, user_id)
    select cid, u from unnest(array[a, b, c]) u
     where not exists (select 1 from community_members x where x.community_id = cid and x.user_id = u);
  insert into community_messages (community_id, sender_id, body) values (cid, a, 'a'), (cid, b, 'b1'), (cid, b, 'b2');
  insert into community_messages (community_id, sender_id, body) values (cid, c, 'c1') returning id into cm;
  insert into community_messages (community_id, sender_id, body) values (cid, c, 'c2');
  perform set_config('t.cid', cid::text, true); perform set_config('t.cm', cm::text, true);
  perform set_config('t.a', a::text, true); perform set_config('t.b', b::text, true);
  perform set_config('t.c', c::text, true); perform set_config('t.d', d::text, true);
end $$;

-- per viewer: total visible, last-24h count (Home's path), visible from c, c's message by id, visible from a
create or replace function pg_temp.snap(label text, viewer text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', current_setting(viewer), 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  insert into out select label || '.total', count(*)::text from community_messages where community_id = current_setting('t.cid')::uuid;
  insert into out select label || '.recent', count(*)::text from community_messages
    where community_id = current_setting('t.cid')::uuid and created_at >= now() - interval '24 hours';
  insert into out select label || '.from_c', count(*)::text from community_messages
    where community_id = current_setting('t.cid')::uuid and sender_id = current_setting('t.c')::uuid;
  insert into out select label || '.c_by_id', count(*)::text from community_messages where id = current_setting('t.cm')::uuid;
  insert into out select label || '.from_a', count(*)::text from community_messages
    where community_id = current_setting('t.cid')::uuid and sender_id = current_setting('t.a')::uuid;
  execute 'reset role';
end $$;
grant execute on function pg_temp.snap(text, text) to authenticated;

-- 3 + 8. no block: every member sees all 5; a non-member sees nothing, not even by id
select pg_temp.snap('noblock_a', 't.a');
select pg_temp.snap('noblock_b', 't.b');
select pg_temp.snap('nonmember', 't.d');

-- 1 + 4. the viewer blocks c: c's 2 messages leave a's chat and counts; b's stay; c no longer sees a
insert into blocks (blocker_id, blocked_id) values (current_setting('t.a')::uuid, current_setting('t.c')::uuid);
select pg_temp.snap('ablocks_a', 't.a');
select pg_temp.snap('ablocks_b', 't.b');
select pg_temp.snap('ablocks_c', 't.c');

-- 2. c blocks the viewer instead: same result for a (the direction that leaked before 20270264)
delete from blocks where blocker_id = current_setting('t.a')::uuid and blocked_id = current_setting('t.c')::uuid;
insert into blocks (blocker_id, blocked_id) values (current_setting('t.c')::uuid, current_setting('t.a')::uuid);
select pg_temp.snap('cblocks_a', 't.a');
select pg_temp.snap('cblocks_b', 't.b');
select pg_temp.snap('cblocks_c', 't.c');

-- 7. unblock: back to the no-block view
delete from blocks where blocker_id = current_setting('t.c')::uuid and blocked_id = current_setting('t.a')::uuid;
select pg_temp.snap('unblocked_a', 't.a');

-- 9. the policy uses the shared helper, never an inline blocks read; one SELECT policy; no server function reads the table
insert into out select 'policy_uses_helper', (qual ilike '%viewer_blocked_either_way(sender_id)%')::text
  from pg_policies where tablename = 'community_messages' and cmd = 'SELECT';
insert into out select 'policy_reads_blocks_inline', (qual ~* 'from\s+blocks')::text
  from pg_policies where tablename = 'community_messages' and cmd = 'SELECT';
insert into out select 'select_policies', count(*)::text from pg_policies where tablename = 'community_messages' and cmd = 'SELECT';
insert into out select 'functions_reading_table', count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prokind = 'f' and pg_get_functiondef(p.oid) ilike '%community_messages%';

-- a right join, so an expected check that recorded nothing shows up as a failure instead of disappearing
select e.k, o.v, e.v as expected, coalesce(o.v = e.v, false) as ok
  from out o right join (values
    ('noblock_a.total','5'), ('noblock_a.recent','5'), ('noblock_a.from_c','2'), ('noblock_a.c_by_id','1'),
    ('noblock_b.total','5'), ('nonmember.total','0'), ('nonmember.recent','0'), ('nonmember.c_by_id','0'),
    ('ablocks_a.total','3'), ('ablocks_a.recent','3'), ('ablocks_a.from_c','0'), ('ablocks_a.c_by_id','0'), ('ablocks_a.from_a','1'),
    ('ablocks_b.total','5'), ('ablocks_b.from_c','2'),
    ('ablocks_c.total','4'), ('ablocks_c.from_a','0'),
    ('cblocks_a.total','3'), ('cblocks_a.recent','3'), ('cblocks_a.from_c','0'), ('cblocks_a.c_by_id','0'),
    ('cblocks_b.total','5'), ('cblocks_b.from_c','2'),
    ('cblocks_c.total','4'), ('cblocks_c.from_a','0'),
    ('unblocked_a.total','5'), ('unblocked_a.recent','5'), ('unblocked_a.from_c','2'), ('unblocked_a.c_by_id','1'),
    ('policy_uses_helper','true'), ('policy_reads_blocks_inline','false'), ('select_policies','1'), ('functions_reading_table','0')
  ) e(k, v) on e.k = o.k
 order by ok, e.k;

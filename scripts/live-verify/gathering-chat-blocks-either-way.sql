-- Gathering group chat hides a sender's messages from a viewer when EITHER of them blocked the other
-- (migration 20270263). Reads run as real users under the authenticated role, through the same RLS every client read
-- uses (chat history, single-message fetch, the host's count-only read). Always rolls back: append `rollback;`.
-- Every row must read ok = true.
begin;
create temp table out(k text, v text) on commit drop;
grant all on out to authenticated;
do $$
declare a uuid; b uuid; c uuid; d uuid; g uuid; cm uuid;
begin
  select id into a from profiles order by id limit 1;                                   -- host
  select id into b from profiles where id <> a order by id limit 1;                      -- attendee, never blocked
  select id into c from profiles where id not in (a, b) order by id limit 1;             -- attendee in the block pair
  select id into d from profiles where id not in (a, b, c) order by id limit 1;          -- stranger
  delete from blocks where blocker_id in (a, b, c) and blocked_id in (a, b, c);
  insert into gatherings (host_id, title, scheduled_at, precise_lat, precise_lng, interest_tag, area, visibility)
    values (a, 'Chat block test', now() + interval '2 days', 40, -75, 'Coffee', 'journey', 'everyone') returning id into g;
  insert into gathering_interest (gathering_id, user_id, status) values (g, b, 'approved'), (g, c, 'approved');
  insert into gathering_messages (gathering_id, sender_id, body) values (g, a, 'host'), (g, b, 'b1'), (g, b, 'b2');
  insert into gathering_messages (gathering_id, sender_id, body) values (g, c, 'c1') returning id into cm;
  insert into gathering_messages (gathering_id, sender_id, body) values (g, c, 'c2');
  perform set_config('t.g', g::text, true); perform set_config('t.cm', cm::text, true);
  perform set_config('t.a', a::text, true); perform set_config('t.b', b::text, true);
  perform set_config('t.c', c::text, true); perform set_config('t.d', d::text, true);
end $$;

-- read(label, viewer): total visible, visible from c, the c message by id, visible from the host
create or replace function pg_temp.snap(label text, viewer text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', current_setting(viewer), 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  insert into out select label || '.total', count(*)::text from gathering_messages where gathering_id = current_setting('t.g')::uuid;
  insert into out select label || '.from_c', count(*)::text from gathering_messages
    where gathering_id = current_setting('t.g')::uuid and sender_id = current_setting('t.c')::uuid;
  insert into out select label || '.c_by_id', count(*)::text from gathering_messages where id = current_setting('t.cm')::uuid;
  insert into out select label || '.from_host', count(*)::text from gathering_messages
    where gathering_id = current_setting('t.g')::uuid and sender_id = current_setting('t.a')::uuid;
  execute 'reset role';
end $$;
grant execute on function pg_temp.snap(text, text) to authenticated;

-- 3. no block: everyone in the chat sees all 5
select pg_temp.snap('noblock_host', 't.a');
select pg_temp.snap('noblock_b', 't.b');
select pg_temp.snap('stranger', 't.d');

-- 1 + 4 + 8. the HOST blocks c: c's 2 messages leave the host's chat (and count); b is unaffected; c no longer sees the host
insert into blocks (blocker_id, blocked_id) values (current_setting('t.a')::uuid, current_setting('t.c')::uuid);
select pg_temp.snap('hostblocks_host', 't.a');
select pg_temp.snap('hostblocks_b', 't.b');
select pg_temp.snap('hostblocks_c', 't.c');

-- 2 + 8. c blocks the HOST instead: same result for the host (the case that leaked before 20270263)
delete from blocks where blocker_id = current_setting('t.a')::uuid and blocked_id = current_setting('t.c')::uuid;
insert into blocks (blocker_id, blocked_id) values (current_setting('t.c')::uuid, current_setting('t.a')::uuid);
select pg_temp.snap('cblocks_host', 't.a');
select pg_temp.snap('cblocks_b', 't.b');
select pg_temp.snap('cblocks_c', 't.c');

-- 7. unblock: back to the no-block view
delete from blocks where blocker_id = current_setting('t.c')::uuid and blocked_id = current_setting('t.a')::uuid;
select pg_temp.snap('unblocked_host', 't.a');

-- 9. direct chat (messages) policy untouched: still its own is_blocked() rule
insert into out select 'dm_policy_uses_is_blocked', (qual ilike '%is_blocked(m.user_a, m.user_b)%')::text
  from pg_policies where tablename = 'messages' and policyname = 'Users can view messages in their own matches';
insert into out select 'chat_policy_uses_helper', (qual ilike '%viewer_blocked_either_way(sender_id)%')::text
  from pg_policies where tablename = 'gathering_messages' and cmd = 'SELECT';
insert into out select 'chat_select_policies', count(*)::text from pg_policies where tablename = 'gathering_messages' and cmd = 'SELECT';

-- a right join, so an expected check that recorded nothing shows up as a failure instead of disappearing
select e.k, o.v, e.v as expected, coalesce(o.v = e.v, false) as ok
  from out o right join (values
    ('noblock_host.total','5'), ('noblock_host.from_c','2'), ('noblock_host.c_by_id','1'),
    ('noblock_b.total','5'), ('stranger.total','0'), ('stranger.c_by_id','0'),
    ('hostblocks_host.total','3'), ('hostblocks_host.from_c','0'), ('hostblocks_host.c_by_id','0'), ('hostblocks_host.from_host','1'),
    ('hostblocks_b.total','5'), ('hostblocks_b.from_c','2'),
    ('hostblocks_c.total','4'), ('hostblocks_c.from_host','0'),
    ('cblocks_host.total','3'), ('cblocks_host.from_c','0'), ('cblocks_host.c_by_id','0'),
    ('cblocks_b.total','5'), ('cblocks_b.from_c','2'),
    ('cblocks_c.total','4'), ('cblocks_c.from_host','0'),
    ('unblocked_host.total','5'), ('unblocked_host.from_c','2'), ('unblocked_host.c_by_id','1'),
    ('dm_policy_uses_is_blocked','true'), ('chat_policy_uses_helper','true'), ('chat_select_policies','1')
  ) e(k, v) on e.k = o.k
 order by ok, e.k;

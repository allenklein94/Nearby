-- Host command center: the Message action's count (getGatheringMessageCount = a count-only read of gathering_messages
-- through RLS), run as real users under the authenticated role. Always rolls back. Usage: append `rollback;`.
-- Expect: host_count 2 (own + attendee; the attendee the HOST blocked is excluded), stranger_count 0,
-- host_count_after_new_message 3, host_count_reverse_block 3 (the ATTENDEE blocked the host: that attendee's message is
-- hidden too, since 20270263 the chat policy uses viewer_blocked_either_way; was 4 before, the leak reported 2026-10-02).
begin;
create temp table out(k text, v text) on commit drop;
grant all on out to authenticated;
do $$
declare a uuid; b uuid; c uuid; d uuid; g uuid;
begin
  select id into a from profiles order by id limit 1;
  select id into b from profiles where id <> a order by id limit 1;
  select id into c from profiles where id not in (a, b) order by id limit 1;
  select id into d from profiles where id not in (a, b, c) order by id limit 1;
  insert into gatherings (host_id, title, scheduled_at, precise_lat, precise_lng, interest_tag, area, visibility)
    values (a, 'HMC test', now() + interval '2 days', 40, -75, 'Coffee', 'journey', 'everyone') returning id into g;
  insert into gathering_interest (gathering_id, user_id, status) values (g, b, 'approved'), (g, c, 'approved');
  delete from blocks where (blocker_id = a and blocked_id = c) or (blocker_id = c and blocked_id = a);
  insert into blocks (blocker_id, blocked_id) values (a, c);           -- the host blocked c: c's messages leave the host's chat
  insert into gathering_messages (gathering_id, sender_id, body) values (g, a, 'host'), (g, b, 'attendee'), (g, c, 'blocked attendee');
  perform set_config('hmc.g', g::text, true);
  perform set_config('hmc.a', a::text, true); perform set_config('hmc.b', b::text, true); perform set_config('hmc.d', d::text, true);
end $$;

-- the host, through RLS: exactly the messages the host's chat shows
select set_config('request.jwt.claims', json_build_object('sub', current_setting('hmc.a'), 'role', 'authenticated')::text, true);
set local role authenticated;
insert into out select 'host_count', count(*)::text from gathering_messages where gathering_id = current_setting('hmc.g')::uuid;
reset role;

-- a stranger (not host, not an approved attendee) gets nothing
select set_config('request.jwt.claims', json_build_object('sub', current_setting('hmc.d'), 'role', 'authenticated')::text, true);
set local role authenticated;
insert into out select 'stranger_count', count(*)::text from gathering_messages where gathering_id = current_setting('hmc.g')::uuid;
reset role;

-- a new message from the attendee: the host's re-count rises by one
insert into gathering_messages (gathering_id, sender_id, body) values (current_setting('hmc.g')::uuid, current_setting('hmc.b')::uuid, 'another');
select set_config('request.jwt.claims', json_build_object('sub', current_setting('hmc.a'), 'role', 'authenticated')::text, true);
set local role authenticated;
insert into out select 'host_count_after_new_message', count(*)::text from gathering_messages where gathering_id = current_setting('hmc.g')::uuid;
reset role;

-- the reverse direction: c blocked the host instead
do $$ begin
  delete from blocks where blocker_id = current_setting('hmc.a')::uuid;
  insert into blocks (blocker_id, blocked_id)
    select gi.user_id, current_setting('hmc.a')::uuid from gathering_interest gi
     where gi.gathering_id = current_setting('hmc.g')::uuid and gi.user_id <> current_setting('hmc.b')::uuid;
end $$;
set local role authenticated;
insert into out select 'host_count_reverse_block', count(*)::text from gathering_messages where gathering_id = current_setting('hmc.g')::uuid;
reset role;

select * from out order by k;

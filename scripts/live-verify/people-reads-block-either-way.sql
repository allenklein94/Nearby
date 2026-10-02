-- People reads hide a blocked pair in BOTH directions, decided by the server (migration 20270265): the community member
-- list + count, the friends list + pending requests + creating a friend request, and discovery (Crossed Paths'
-- gathering partners, its sightings, the profile reads Browse / Crossed Paths / the profile screen use). Reads run as
-- the viewer under the authenticated role through the same RLS / RPC / view the app uses. Always rolls back: append
-- `rollback;`. Every row must read ok = true.
begin;
create temp table out(k text, v text) on commit drop;
grant all on out to authenticated;
do $$
declare a uuid; b uuid; c uuid; d uuid; cid uuid; g uuid;
begin
  select id into a from profiles order by id limit 1;                                   -- viewer
  select id into b from profiles where id <> a order by id limit 1;                      -- unrelated person, never blocked
  select id into c from profiles where id not in (a, b) order by id limit 1;             -- the block partner
  select id into d from profiles where id not in (a, b, c) order by id limit 1;          -- friend-request target
  perform set_config('app.trusted_update', 'true', true);
  update profiles set photo_verified = true, profile_hidden = false, wide_area = '40.0,-75.0' where id in (a, b, c, d);
  delete from blocks where blocker_id in (a, b, c, d) and blocked_id in (a, b, c, d);
  delete from friendships where user_a in (a, b, c, d) and user_b in (a, b, c, d);
  delete from sightings where user_a in (a, b, c, d) and user_b in (a, b, c, d);
  -- community: a, b, c members of a public community created by b
  insert into communities (name, creator_id, is_public) values ('Block reads test', b, true) returning id into cid;
  insert into community_members (community_id, user_id)
    select cid, u from unnest(array[a, b, c]) u
     where not exists (select 1 from community_members x where x.community_id = cid and x.user_id = u);
  -- friends: a is friends with b and c
  insert into friendships (user_a, user_b, status, requested_by) values
    (least(a, b), greatest(a, b), 'accepted', a), (least(a, c), greatest(a, c), 'accepted', a);
  -- discovery: a past gathering a, b, c all attended; a sighting between a and c and between a and b
  insert into gatherings (host_id, title, scheduled_at, precise_lat, precise_lng, interest_tag, area, visibility)
    values (d, 'Block reads past', now() - interval '3 days', 40, -75, 'Coffee', 'journey', 'everyone') returning id into g;
  insert into gathering_interest (gathering_id, user_id, status) values (g, a, 'approved'), (g, b, 'approved'), (g, c, 'approved');
  insert into sightings (user_a, user_b, last_seen_at) values (least(a, c), greatest(a, c), now()), (least(a, b), greatest(a, b), now());
  perform set_config('t.cid', cid::text, true);
  perform set_config('t.a', a::text, true); perform set_config('t.b', b::text, true);
  perform set_config('t.c', c::text, true); perform set_config('t.d', d::text, true);
end $$;

-- everything the viewer (a) can see about b and c, through the app's own read paths
create or replace function pg_temp.snap(label text) returns void language plpgsql as $$
declare v_err text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', current_setting('t.a'), 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  -- 1. community member list + count
  insert into out select label || '.members_has_c', (count(*) filter (where user_id = current_setting('t.c')::uuid))::text
    from community_members where community_id = current_setting('t.cid')::uuid;
  insert into out select label || '.members_has_b', (count(*) filter (where user_id = current_setting('t.b')::uuid))::text
    from community_members where community_id = current_setting('t.cid')::uuid;
  insert into out select label || '.member_count', count(*)::text from community_members where community_id = current_setting('t.cid')::uuid;
  -- 2. friends list
  insert into out select label || '.friend_rows', count(*)::text from friendships
    where status = 'accepted' and (user_a = current_setting('t.a')::uuid or user_b = current_setting('t.a')::uuid);
  insert into out select label || '.friend_c', count(*)::text from friendships
    where (user_a = current_setting('t.c')::uuid or user_b = current_setting('t.c')::uuid);
  -- 3. discovery: gathering partners, sightings, profile reads by id and by area
  insert into out select label || '.partners_has_c', (count(*) filter (where other_user_id = current_setting('t.c')::uuid))::text from get_shared_gathering_partners();
  insert into out select label || '.partners_has_b', (count(*) filter (where other_user_id = current_setting('t.b')::uuid))::text from get_shared_gathering_partners();
  insert into out select label || '.sighting_c', count(*)::text from sightings
    where current_setting('t.c')::uuid in (user_a, user_b);
  insert into out select label || '.visible_c_by_id', count(*)::text from people_visible_to_me where id = current_setting('t.c')::uuid;
  insert into out select label || '.visible_b_by_id', count(*)::text from people_visible_to_me where id = current_setting('t.b')::uuid;
  insert into out select label || '.browse_has_c', (count(*) filter (where id = current_setting('t.c')::uuid))::text
    from people_visible_to_me where wide_area = '40.0,-75.0';
  insert into out select label || '.browse_self', (count(*) filter (where id = current_setting('t.a')::uuid))::text
    from people_visible_to_me where wide_area = '40.0,-75.0';
  execute 'reset role';
end $$;
grant execute on function pg_temp.snap(text) to authenticated;

-- a friend request from the viewer to d, recorded as ok / the error code (one savepoint per attempt)
create or replace function pg_temp.try_request(label text) returns void language plpgsql as $$
declare v_result text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', current_setting('t.a'), 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    insert into friendships (user_a, user_b, status, requested_by)
      values (least(current_setting('t.a')::uuid, current_setting('t.d')::uuid), greatest(current_setting('t.a')::uuid, current_setting('t.d')::uuid), 'pending', current_setting('t.a')::uuid);
    v_result := 'ok';
    raise exception 'undo' using errcode = 'P0099';   -- undo the request; v_result survives the rollback
  exception
    when sqlstate 'P0099' then null;
    when others then v_result := sqlstate;
  end;
  insert into out values (label || '.request', v_result);
  execute 'reset role';
end $$;
grant execute on function pg_temp.try_request(text) to authenticated;

-- 3. neither blocks: c and b present everywhere
select pg_temp.snap('none');
select pg_temp.try_request('none');

-- 1. viewer blocks c (a direct block row, as if made around block_and_unmatch, so the friendship row still exists)
insert into blocks (blocker_id, blocked_id) values (current_setting('t.a')::uuid, current_setting('t.c')::uuid);
select pg_temp.snap('viewer_blocks');

-- 2. c blocks the viewer: the direction the client filters could never see
delete from blocks where blocker_id = current_setting('t.a')::uuid;
insert into blocks (blocker_id, blocked_id) values (current_setting('t.c')::uuid, current_setting('t.a')::uuid);
select pg_temp.snap('person_blocks');

-- friend request across a block: refused with the same generic error code whichever side blocked
insert into blocks (blocker_id, blocked_id) values (current_setting('t.d')::uuid, current_setting('t.a')::uuid);
select pg_temp.try_request('d_blocks_viewer');
delete from blocks where blocker_id = current_setting('t.d')::uuid;
insert into blocks (blocker_id, blocked_id) values (current_setting('t.a')::uuid, current_setting('t.d')::uuid);
select pg_temp.try_request('viewer_blocks_d');
delete from blocks where blocker_id = current_setting('t.a')::uuid and blocked_id = current_setting('t.d')::uuid;

-- unblock: back to the no-block view
delete from blocks where blocker_id = current_setting('t.c')::uuid;
select pg_temp.snap('unblocked');

-- the viewer still cannot read the block rows other people made (nothing new exposed)
insert into blocks (blocker_id, blocked_id) values (current_setting('t.c')::uuid, current_setting('t.a')::uuid);
select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.a'), 'role', 'authenticated')::text, true);
set local role authenticated;
insert into out select 'incoming_block_rows_readable', count(*)::text from blocks where blocked_id = current_setting('t.a')::uuid;
insert into out select 'anon_view_grant', has_table_privilege('anon', 'public.people_visible_to_me', 'select')::text;
reset role;
insert into out select 'view_security_invoker', (reloptions @> array['security_invoker=true'])::text from pg_class where oid = 'public.people_visible_to_me'::regclass;

-- a right join, so an expected check that recorded nothing shows up as a failure instead of disappearing
select e.k, o.v, e.v as expected, coalesce(o.v = e.v, false) as ok
  from out o right join (values
    ('none.members_has_c','1'), ('none.members_has_b','1'), ('none.member_count','3'),
    ('none.friend_rows','2'), ('none.friend_c','1'),
    ('none.partners_has_c','1'), ('none.partners_has_b','1'), ('none.sighting_c','1'),
    ('none.visible_c_by_id','1'), ('none.visible_b_by_id','1'), ('none.browse_has_c','1'), ('none.browse_self','1'),
    ('none.request','ok'),
    ('viewer_blocks.members_has_c','0'), ('viewer_blocks.members_has_b','1'), ('viewer_blocks.member_count','2'),
    ('viewer_blocks.friend_rows','1'), ('viewer_blocks.friend_c','0'),
    ('viewer_blocks.partners_has_c','0'), ('viewer_blocks.partners_has_b','1'), ('viewer_blocks.sighting_c','0'),
    ('viewer_blocks.visible_c_by_id','0'), ('viewer_blocks.visible_b_by_id','1'), ('viewer_blocks.browse_has_c','0'), ('viewer_blocks.browse_self','1'),
    ('person_blocks.members_has_c','0'), ('person_blocks.members_has_b','1'), ('person_blocks.member_count','2'),
    ('person_blocks.friend_rows','1'), ('person_blocks.friend_c','0'),
    ('person_blocks.partners_has_c','0'), ('person_blocks.partners_has_b','1'), ('person_blocks.sighting_c','0'),
    ('person_blocks.visible_c_by_id','0'), ('person_blocks.visible_b_by_id','1'), ('person_blocks.browse_has_c','0'), ('person_blocks.browse_self','1'),
    ('d_blocks_viewer.request','42501'), ('viewer_blocks_d.request','42501'),
    ('unblocked.members_has_c','1'), ('unblocked.member_count','3'), ('unblocked.friend_rows','2'),
    ('unblocked.partners_has_c','1'), ('unblocked.sighting_c','1'), ('unblocked.visible_c_by_id','1'), ('unblocked.browse_has_c','1'),
    ('incoming_block_rows_readable','0'), ('anon_view_grant','false'), ('view_security_invoker','true')
  ) e(k, v) on e.k = o.k
 order by ok, e.k;

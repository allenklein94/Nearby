-- Host approval review row (owner item 144, option 1) + default auto-accept (owner item 145). The app saves Everyone,
-- Friends and Community gatherings with is_public = true (only invite-only is false), so each auto-accepts unless the host
-- turned Require approval on. A pending request exists exactly where the host chose to decide (Everyone / Friends /
-- Community + Require approval, Invite-only), the host reads it through the same gathering_interest read
-- getGatheringRequestsForHost uses, so the Review row appears for all four; with approval off nothing is pending (no
-- row); approving the last request empties the pending set.
-- Real join_gathering / approve_gathering_interest as real users under the authenticated role. Always rolls back:
-- append `rollback;`. Every row must read ok = true.
begin;
create temp table out(k text, v text) on commit drop;
grant all on out to authenticated;
do $$
declare a uuid; b uuid; cid uuid; gid uuid; kind text;
begin
  select id into a from profiles order by id limit 1;                       -- host
  select id into b from profiles where id <> a order by id limit 1;          -- person asking to join
  delete from blocks where blocker_id in (a, b) and blocked_id in (a, b);
  perform set_config('t.a', a::text, true); perform set_config('t.b', b::text, true);
  insert into communities (name, creator_id, is_public) values ('Review row test', a, true) returning id into cid;
  foreach kind in array array['public_approval', 'friends', 'community', 'invite_only', 'public_open', 'friends_open', 'community_open'] loop
    insert into gatherings (host_id, title, scheduled_at, precise_lat, precise_lng, interest_tag, area,
                            visibility, is_public, requires_approval, community_id)
      values (a, 'Review row ' || kind, now() + interval '2 days', 40, -75, 'Coffee', 'journey',
              case kind when 'public_approval' then 'everyone' when 'public_open' then 'everyone'
                        when 'friends_open' then 'friends' when 'community_open' then 'community' else kind end,
              kind <> 'invite_only',                                      -- what CreateGatheringScreen saves
              kind in ('public_approval', 'friends', 'community'),        -- Require approval chosen
              case when kind in ('community', 'community_open') then cid end)
      returning id into gid;
    if kind = 'invite_only' then
      insert into social_invites (inviter_id, invitee_id, invite_type, target_id, status) values (a, b, 'gathering', gid, 'accepted');
    end if;
    perform set_config('t.g_' || kind, gid::text, true);
  end loop;
end $$;

create or replace function pg_temp.as_user(who text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', current_setting(who), 'role', 'authenticated')::text, true);
end $$;

-- the person asks to join each gathering
select pg_temp.as_user('t.b');
set local role authenticated;
insert into out select 'join.' || k, (join_gathering(current_setting('t.g_' || k)::uuid) ->> 'status')
  from unnest(array['public_approval', 'friends', 'community', 'invite_only', 'public_open', 'friends_open', 'community_open']) k;
reset role;

-- the host's own read (the source of both the Review count and its list): pending rows per gathering
select pg_temp.as_user('t.a');
set local role authenticated;
insert into out select 'host_pending.' || k, (select count(*) from gathering_interest
    where gathering_id = current_setting('t.g_' || k)::uuid and status = 'pending')::text
  from unnest(array['public_approval', 'friends', 'community', 'invite_only', 'public_open', 'friends_open', 'community_open']) k;
-- approving the last pending request empties the set (the row disappears)
select approve_gathering_interest(id) from gathering_interest
  where gathering_id = current_setting('t.g_friends')::uuid and status = 'pending';
insert into out select 'after_approve.friends', (select count(*) from gathering_interest
    where gathering_id = current_setting('t.g_friends')::uuid and status = 'pending')::text;
reset role;

-- a right join, so an expected check that recorded nothing shows up as a failure instead of disappearing
select e.k, o.v, e.v as expected, coalesce(o.v = e.v, false) as ok
  from out o right join (values
    ('join.public_approval','pending'), ('join.friends','pending'), ('join.community','pending'),
    ('join.invite_only','pending'), ('join.public_open','approved'),
    ('join.friends_open','approved'), ('join.community_open','approved'),
    ('host_pending.public_approval','1'), ('host_pending.friends','1'), ('host_pending.community','1'),
    ('host_pending.invite_only','1'), ('host_pending.public_open','0'),
    ('host_pending.friends_open','0'), ('host_pending.community_open','0'),
    ('after_approve.friends','0')
  ) e(k, v) on e.k = o.k
 order by ok, e.k;

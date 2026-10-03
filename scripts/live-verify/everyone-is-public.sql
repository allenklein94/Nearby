-- Owner item 145 follow-up (migration 20270266): the legacy "visible to everyone but not public" gathering is fixed and
-- the state cannot return. Checks: the one row is now everyone + public + no approval; no gathering anywhere is in the old
-- state; inserting or updating into it is refused; and join behavior follows the canonical rules (public / friends /
-- community with approval off = one tap, with approval on = pending, invite-only = pending, a full gathering waitlists).
-- Always rolls back: append `rollback;`. Every row must read ok = true.
begin;
create temp table out(k text, v text) on commit drop;
grant all on out to authenticated;

insert into out select 'legacy_row', concat_ws('/', visibility, is_public, requires_approval)
  from gatherings where id = '7b152168-d981-4b9a-a947-d168ec9b05c1';
insert into out select 'rows_in_old_state', count(*)::text from gatherings where visibility = 'everyone' and is_public is not true;

do $$
declare a uuid; b uuid; c uuid; cid uuid; gid uuid; kind text;
begin
  select id into a from profiles order by id limit 1;
  select id into b from profiles where id <> a order by id limit 1;
  select id into c from profiles where id not in (a, b) order by id limit 1;
  delete from blocks where blocker_id in (a, b, c) and blocked_id in (a, b, c);
  perform set_config('t.b', b::text, true); perform set_config('t.c', c::text, true);

  -- the old state is refused on insert and on update
  begin
    insert into gatherings (host_id, title, scheduled_at, precise_lat, precise_lng, interest_tag, area, visibility, is_public)
      values (a, 'old state', now() + interval '2 days', 40, -75, 'Coffee', 'journey', 'everyone', false);
    insert into out values ('insert_old_state', 'accepted');
  exception when check_violation then insert into out values ('insert_old_state', 'refused');
  end;
  insert into gatherings (host_id, title, scheduled_at, precise_lat, precise_lng, interest_tag, area, visibility, is_public)
    values (a, 'ok', now() + interval '2 days', 40, -75, 'Coffee', 'journey', 'everyone', true) returning id into gid;
  begin
    update gatherings set is_public = false where id = gid;
    insert into out values ('update_old_state', 'accepted');
  exception when check_violation then insert into out values ('update_old_state', 'refused');
  end;

  -- one gathering per canonical rule, saved the way the app saves it (only invite-only is not public)
  insert into communities (name, creator_id, is_public) values ('Everyone is public test', a, true) returning id into cid;
  foreach kind in array array['public_open', 'public_approval', 'friends_open', 'friends_approval',
                              'community_open', 'community_approval', 'invite_only', 'full'] loop
    insert into gatherings (host_id, title, scheduled_at, precise_lat, precise_lng, interest_tag, area,
                            visibility, is_public, requires_approval, community_id, capacity)
      values (a, 'Rule ' || kind, now() + interval '2 days', 40, -75, 'Coffee', 'journey',
              case when kind like 'friends%' then 'friends' when kind like 'community%' then 'community'
                   when kind = 'invite_only' then 'invite_only' else 'everyone' end,
              kind <> 'invite_only', kind like '%_approval',
              case when kind like 'community%' then cid end,
              case when kind = 'full' then 2 end)
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

select pg_temp.as_user('t.b');
set local role authenticated;
insert into out select 'join.' || k, (join_gathering(current_setting('t.g_' || k)::uuid) ->> 'status')
  from unnest(array['public_open', 'public_approval', 'friends_open', 'friends_approval',
                    'community_open', 'community_approval', 'invite_only', 'full']) k;
reset role;
-- capacity 2 = host + 1 guest: b took the one spot, so c waitlists although approval is off
select pg_temp.as_user('t.c');
set local role authenticated;
insert into out select 'join.full_second', (join_gathering(current_setting('t.g_full')::uuid) ->> 'status');
reset role;

select e.k, o.v, e.v as expected, coalesce(o.v = e.v, false) as ok
  from out o right join (values
    ('legacy_row', 'everyone/t/f'), ('rows_in_old_state', '0'),
    ('insert_old_state', 'refused'), ('update_old_state', 'refused'),
    ('join.public_open', 'approved'), ('join.public_approval', 'pending'),
    ('join.friends_open', 'approved'), ('join.friends_approval', 'pending'),
    ('join.community_open', 'approved'), ('join.community_approval', 'pending'),
    ('join.invite_only', 'pending'), ('join.full', 'approved'), ('join.full_second', 'waitlisted')
  ) e(k, v) on e.k = o.k
 order by ok, e.k;

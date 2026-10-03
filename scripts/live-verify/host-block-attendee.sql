-- Owner item 146: the host's Block in Manage attendees = host_remove_gathering_attendee (take them off this gathering)
-- then block_and_unmatch, as the real host under the authenticated role. Checks: an approved attendee and a pending
-- requester are both off the gathering and blocked; the host's request list no longer shows them; they cannot rejoin.
-- Always rolls back: append `rollback;`. Every row must read ok = true.
begin;
create temp table out(k text, v text) on commit drop;
grant all on out to authenticated;
do $$
declare a uuid; b uuid; c uuid; g1 uuid; g2 uuid;
begin
  select id into a from profiles order by id limit 1;
  select id into b from profiles where id <> a order by id limit 1;
  select id into c from profiles where id not in (a, b) order by id limit 1;
  delete from blocks where blocker_id in (a, b, c) and blocked_id in (a, b, c);
  insert into gatherings (host_id, title, scheduled_at, precise_lat, precise_lng, interest_tag, area, visibility, is_public)
    values (a, 'Block test open', now() + interval '2 days', 40, -75, 'Coffee', 'journey', 'everyone', true) returning id into g1;
  insert into gatherings (host_id, title, scheduled_at, precise_lat, precise_lng, interest_tag, area, visibility, is_public, requires_approval)
    values (a, 'Block test approval', now() + interval '2 days', 40, -75, 'Coffee', 'journey', 'everyone', true, true) returning id into g2;
  insert into gathering_interest (gathering_id, user_id, status) values (g1, b, 'approved'), (g2, c, 'pending');
  perform set_config('t.a', a::text, true); perform set_config('t.b', b::text, true); perform set_config('t.c', c::text, true);
  perform set_config('t.g1', g1::text, true); perform set_config('t.g2', g2::text, true);
end $$;

create or replace function pg_temp.as_user(who text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', current_setting(who), 'role', 'authenticated')::text, true);
end $$;

select pg_temp.as_user('t.a');
set local role authenticated;
select host_remove_gathering_attendee(id) from gathering_interest where gathering_id = current_setting('t.g1')::uuid and user_id = current_setting('t.b')::uuid;
select block_and_unmatch(current_setting('t.b')::uuid);
select host_remove_gathering_attendee(id) from gathering_interest where gathering_id = current_setting('t.g2')::uuid and user_id = current_setting('t.c')::uuid;
select block_and_unmatch(current_setting('t.c')::uuid);
insert into out select 'host_sees.approved_attendee', count(*)::text from gathering_interest
  where gathering_id = current_setting('t.g1')::uuid and user_id = current_setting('t.b')::uuid and status in ('approved', 'pending', 'waitlisted');
insert into out select 'host_sees.requester', count(*)::text from gathering_interest
  where gathering_id = current_setting('t.g2')::uuid and user_id = current_setting('t.c')::uuid and status in ('approved', 'pending', 'waitlisted');
insert into out select 'blocked', count(*)::text from blocks where blocker_id = current_setting('t.a')::uuid and blocked_id in (current_setting('t.b')::uuid, current_setting('t.c')::uuid);
reset role;

-- the blocked attendee cannot get back in
select pg_temp.as_user('t.b');
set local role authenticated;
do $$ begin
  begin
    perform join_gathering(current_setting('t.g1')::uuid);
    insert into out select 'rejoin', coalesce((select status from gathering_interest where gathering_id = current_setting('t.g1')::uuid and user_id = current_setting('t.b')::uuid), 'none');
  exception when others then insert into out values ('rejoin', 'refused');
  end;
end $$;
reset role;

select e.k, o.v, e.v as expected, coalesce(o.v = e.v, false) as ok
  from out o right join (values
    ('host_sees.approved_attendee', '0'), ('host_sees.requester', '0'), ('blocked', '2'), ('rejoin', 'refused')
  ) e(k, v) on e.k = o.k
 order by ok, e.k;

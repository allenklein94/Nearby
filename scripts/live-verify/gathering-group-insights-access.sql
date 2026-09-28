-- Verifies migration 20270253 (item 131): group insights only for accounts allowed to see the gathering; shared interests at
-- 2+ attendees for a person, 5+ (demand_min_people()) for a business account; aggregate only. Management API; ALWAYS rolled
-- back. Prod has 4 profiles, so the business floor is also checked with demand_min_people() lowered to 3 in the transaction.
begin;
create temp table r(check_name text, got text, want text);
do $t$
declare v_o uuid; v_a uuid; v_b uuid; v_c uuid; v_g1 uuid; v_g2 uuid; v_res text;
  function_res text;
begin
  perform set_config('app.trusted_update', 'true', true);
  select id into v_o from profiles where managed_partner_id is not null limit 1;            -- a business account
  select id into v_a from profiles where id <> v_o order by id limit 1;
  select id into v_b from profiles where id not in (v_o, v_a) order by id limit 1;
  select id into v_c from profiles where id not in (v_o, v_a, v_b) order by id limit 1;
  select id into v_g1 from gatherings order by id limit 1;
  select id into v_g2 from gatherings where id <> v_g1 order by id limit 1;
  delete from gathering_interest where gathering_id in (v_g1, v_g2);
  delete from social_invites where target_id in (v_g1, v_g2);
  delete from blocks where blocker_id in (v_a, v_c) and blocked_id in (v_a, v_c);
  delete from friendships where (user_a in (v_a, v_c) and user_b in (v_a, v_c));
  update profiles set interests = array['Coffee','Yoga','Hiking'], gender = 'male' where id = v_a;
  update profiles set interests = array['Coffee','Yoga'] where id = v_b;
  update profiles set interests = array['Coffee'], gender = 'male' where id = v_c;
  -- G1: hosted by the business account, public; A, B, C attending. Coffee x3, Yoga x2, Hiking x1.
  update gatherings set host_id = v_o, visibility = 'everyone', discoverable = true, women_only = false, community_id = null,
    scheduled_at = now() + interval '3 days', capacity = null where id = v_g1;
  insert into gathering_interest(gathering_id, user_id, status) values (v_g1, v_a, 'approved'), (v_g1, v_b, 'approved'), (v_g1, v_c, 'approved');
  -- G2: hosted by A; B attending; C is the outsider.
  update gatherings set host_id = v_a, visibility = 'everyone', discoverable = true, women_only = false, community_id = null,
    scheduled_at = now() + interval '3 days', capacity = null where id = v_g2;
  insert into gathering_interest(gathering_id, user_id, status) values (v_g2, v_b, 'approved');

  -- people at 2+
  perform set_config('request.jwt.claims', json_build_object('sub', v_a, 'role', 'authenticated')::text, true);
  select array_to_string(interest_names, ',') into v_res from get_gathering_group_insights(v_g1);
  insert into r values ('person: shared by 2+ only (Hiking held by 1 is hidden)', v_res, 'Coffee,Yoga');
  -- business at the real floor (5): 3 attendees -> none
  perform set_config('request.jwt.claims', json_build_object('sub', v_o, 'role', 'authenticated')::text, true);
  select array_to_string(interest_names, ',') into v_res from get_gathering_group_insights(v_g1);
  insert into r values ('business, floor 5, 3 attendees: nothing', coalesce(v_res, 'NO ROW'), '');
  -- business with the floor lowered to 3: at floor (Coffee 3) shown, below (Yoga 2) hidden
  execute 'create or replace function public.demand_min_people() returns integer language sql immutable as $f$ select 3 $f$';
  select array_to_string(interest_names, ',') into v_res from get_gathering_group_insights(v_g1);
  insert into r values ('business, floor 3: at floor shown, below hidden', v_res, 'Coffee');
  execute 'create or replace function public.demand_min_people() returns integer language sql immutable as $f$ select 5 $f$';
  -- never names contributors: the payload has no user id / name
  insert into r values ('payload has no identity columns', (select count(*)::text from information_schema.routines rt
    join information_schema.parameters pa on pa.specific_name = rt.specific_name
    where rt.routine_name = 'get_gathering_group_insights' and pa.parameter_mode = 'OUT' and pa.parameter_name ~ '(user|name$|display|photo)'
    and pa.parameter_name <> 'interest_names'), '0');

  -- access: C is an outsider to G2
  perform set_config('request.jwt.claims', json_build_object('sub', v_c, 'role', 'authenticated')::text, true);
  insert into r values ('public gathering: any signed-in viewer', (select count(*)::text from get_gathering_group_insights(v_g2)), '1');
  update gatherings set visibility = 'everyone', discoverable = false where id = v_g2;
  insert into r values ('link-only: reachable by link', (select count(*)::text from get_gathering_group_insights(v_g2)), '1');
  update gatherings set visibility = 'invite_only', discoverable = true where id = v_g2;
  insert into r values ('invite-only, not invited: no row', (select count(*)::text from get_gathering_group_insights(v_g2)), '0');
  insert into social_invites(inviter_id, invitee_id, invite_type, target_id, status) values (v_a, v_c, 'gathering', v_g2, 'pending');
  insert into r values ('invite-only, invited: row', (select count(*)::text from get_gathering_group_insights(v_g2)), '1');
  delete from social_invites where target_id = v_g2;
  update gatherings set visibility = 'friends' where id = v_g2;
  insert into r values ('friends-only, not a friend: no row', (select count(*)::text from get_gathering_group_insights(v_g2)), '0');
  insert into friendships(user_a, user_b, status, requested_by) values (least(v_a, v_c), greatest(v_a, v_c), 'accepted', v_a);
  insert into r values ('friends-only, friend of host: row', (select count(*)::text from get_gathering_group_insights(v_g2)), '1');
  update gatherings set visibility = 'community', community_id = null where id = v_g2;
  insert into r values ('community, not a member: no row', (select count(*)::text from get_gathering_group_insights(v_g2)), '0');
  update gatherings set visibility = 'everyone', women_only = true where id = v_g2;
  insert into r values ('women-only, viewer not a woman: no row', (select count(*)::text from get_gathering_group_insights(v_g2)), '0');
  update gatherings set women_only = false where id = v_g2;
  insert into blocks(blocker_id, blocked_id) values (v_a, v_c);
  insert into r values ('blocked by the host: no row', (select count(*)::text from get_gathering_group_insights(v_g2)), '0');
  -- the attendee still sees it on invite-only
  update gatherings set visibility = 'invite_only' where id = v_g2;
  perform set_config('request.jwt.claims', json_build_object('sub', v_b, 'role', 'authenticated')::text, true);
  insert into r values ('invite-only, attendee: row', (select count(*)::text from get_gathering_group_insights(v_g2)), '1');
  -- signed out
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  insert into r values ('no signed-in user: no row', (select count(*)::text from get_gathering_group_insights(v_g2)), '0');

  insert into r values ('single overload', (select count(*)::text from pg_proc where proname = 'get_gathering_group_insights'), '1');
  insert into r values ('helper not callable by clients', (has_function_privilege('authenticated', 'public._viewer_can_see_gathering(uuid)', 'execute')
    or has_function_privilege('anon', 'public._viewer_can_see_gathering(uuid)', 'execute'))::text, 'false');
  insert into r values ('anon cannot call insights', has_function_privilege('anon', 'public.get_gathering_group_insights(uuid)', 'execute')::text, 'false');
end $t$;
select check_name, got, want, (coalesce(got,'') = want) as ok from r;
rollback;

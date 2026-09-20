-- Item 75. Rolled back, run under the real `authenticated` role so RLS is what decides what a viewer receives (the same
-- rows PostgREST would return for the feed/detail embed). Host, friend, unrelated viewer; one stranger attendee, several,
-- and mixed friend + stranger attendees.
begin;
do $$
declare
  h uuid := gen_random_uuid(); s uuid := gen_random_uuid(); f uuid := gen_random_uuid();
  x uuid := gen_random_uuid(); y uuid := gen_random_uuid(); w uuid := gen_random_uuid();
  g1 uuid; g2 uuid; g3 uuid; n int; ids uuid[]; u uuid;
begin
  foreach u in array array[h, s, f, x, y, w] loop
    insert into auth.users (id, aud, role, email) values (u, 'authenticated', 'authenticated', u || '@example.invalid');
    insert into profiles (id, display_name, birthdate) values (u, 'T-' || left(u::text, 4), date '1990-01-01');
  end loop;
  insert into friendships (user_a, user_b, status, requested_by) values (least(s,f), greatest(s,f), 'accepted', s);

  insert into gatherings (host_id, title, area, wide_area, interest_tag, scheduled_at, visibility, is_public) values (h, 'one', 'x', 'zz', 'Coffee', now() + interval '2 days', 'everyone', true) returning id into g1;
  insert into gatherings (host_id, title, area, wide_area, interest_tag, scheduled_at, visibility, is_public) values (h, 'multi', 'x', 'zz', 'Coffee', now() + interval '2 days', 'everyone', true) returning id into g2;
  insert into gatherings (host_id, title, area, wide_area, interest_tag, scheduled_at, visibility, is_public) values (h, 'mixed', 'x', 'zz', 'Coffee', now() + interval '2 days', 'everyone', true) returning id into g3;
  insert into gathering_interest (gathering_id, user_id, status) values
    (g1, x, 'approved'),
    (g2, x, 'approved'), (g2, y, 'approved'),
    (g3, f, 'approved'), (g3, x, 'approved'), (g3, y, 'approved'), (g3, w, 'pending');

  -- ===== unrelated viewer s =====
  perform set_config('request.jwt.claims', json_build_object('sub', s, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from gathering_interest where gathering_id = g1;
  assert n = 0, 'single stranger attendee: no row (no name, no user id) reaches the stranger';
  select count(*) into n from gathering_interest where gathering_id = g2;
  assert n = 0, 'several stranger attendees: no rows';
  select array_agg(user_id) into ids from gathering_interest where gathering_id = g3;
  assert ids = array[f], 'mixed: only the accepted friend is returned';
  select count(*) into n from gathering_interest where user_id in (x, y, w);
  assert n = 0, 'no direct query returns any stranger''s row';
  -- counts still work for everyone (no identities)
  assert (select approved_count from public.get_gathering_approved_counts(array[g1]) r where r.gathering_id = g1) = 1, 'count for one stranger attendee';
  assert (select approved_count from public.get_gathering_approved_counts(array[g2]) r where r.gathering_id = g2) = 2, 'count for several';
  assert (select approved_count from public.get_gathering_approved_counts(array[g3]) r where r.gathering_id = g3) = 3, 'count for mixed = friend + strangers, pending excluded';
  -- "New here": ids are member-only, the count is an aggregate for any viewer
  assert (select count(*) from public.get_gathering_first_timer_ids(g3)) = 0, 'non-member gets no first-timer identities';
  assert public.get_gathering_first_timer_count(g3) = 3, 'non-member still gets the aggregate first-timer count';
  -- a block hides even a friend
  reset role;
  insert into blocks (blocker_id, blocked_id) values (s, f);
  perform set_config('request.jwt.claims', json_build_object('sub', s, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from gathering_interest where gathering_id = g3;
  assert n = 0, 'blocked friend hidden';
  reset role;
  delete from blocks where blocker_id = s and blocked_id = f;

  -- ===== friend f (not attending g1): friend sees only their friend's rows; strangers' rows stay hidden =====
  perform set_config('request.jwt.claims', json_build_object('sub', f, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from gathering_interest where gathering_id = g1;
  assert n = 0, 'friend does not see strangers either';
  reset role;

  -- ===== host h manages everything, including a pending request =====
  perform set_config('request.jwt.claims', json_build_object('sub', h, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from gathering_interest where gathering_id = g3;
  assert n = 4, 'host sees approved and pending';
  assert (select host_id from gatherings where id = g3) = h, 'host identity readable on the gathering itself';
  reset role;

  -- ===== approved attendee x sees the whole approved list (Hub / Who You''ll Meet) =====
  perform set_config('request.jwt.claims', json_build_object('sub', x, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from gathering_interest where gathering_id = g3 and status = 'approved';
  assert n = 3, 'approved attendee sees fellow attendees';
  assert (select count(*) from gathering_interest where gathering_id = g3 and status = 'pending') = 0, 'pending rows still private';
  assert (select count(*) from public.get_gathering_first_timer_ids(g3)) = 3, 'member gets first-timer ids';
  reset role;

  -- ===== a pending or waitlisted person is NOT a member =====
  perform set_config('request.jwt.claims', json_build_object('sub', w, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from gathering_interest where gathering_id = g3 and status = 'approved';
  assert n = 0, 'pending requester sees no attendees';
  reset role;

  -- join/leave rules are untouched: a stranger can still join (server function, definer)
  perform set_config('request.jwt.claims', json_build_object('sub', s, 'role', 'authenticated')::text, true);
  perform public.join_gathering(g1);
  assert (select status from gathering_interest where gathering_id = g1 and user_id = s) = 'approved', 'join still works';
  set local role authenticated;
  assert (select count(*) from gathering_interest where gathering_id = g1) = 2, 'after joining the viewer is a member and sees fellow attendees';
  reset role;
  raise notice 'attendee-identity-friends-only ok';
end $$;
rollback;

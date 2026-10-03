// Item 154 (2026-10-03): gathering social conversion (gathering_social_people / _conversion / _summary), gatherings
// only. One gathering with every kind of person (a friend before joining, a non-friend, a friend requested after
// joining, an invited-then-joined friend invited three times, an invited-and-declined friend, an invited pending
// requester, a person invited after joining, a friend whose friendship was later removed), a real failed invitation send,
// post-gathering friendships (one current, one removed, one still pending), a gathering created on a Sunday night whose
// joins land the next week, and an empty gathering (rates stay NULL). Fixture gatherings are created in 2020 weeks so
// the week rows are the fixture alone. Rolled back.
// Not covered: the app (no client code reads these views).
const { runJourney, stepMap, hasToken } = require('./journeyHarness');

const d = hasToken ? describe : describe.skip;

d('journey: gatherings -> friends joined, invitations converted, friendships formed after', () => {
  let s;
  beforeAll(async () => {
    const log = await runJourney(`
      h uuid := gen_random_uuid(); f uuid := gen_random_uuid(); n uuid := gen_random_uuid(); l uuid := gen_random_uuid();
      i1 uuid := gen_random_uuid(); j uuid := gen_random_uuid(); q uuid := gen_random_uuid(); p uuid := gen_random_uuid();
      r uuid := gen_random_uuid(); u uuid; g1 uuid; g2 uuid; g3 uuid; v_n int; v_failed boolean := false;
      c record; w record; x record; e record;`, `
  foreach u in array array[h, f, n, l, i1, j, q, p, r] loop
    insert into auth.users (id, aud, role, email) values (u, 'authenticated', 'authenticated', u || '@social.test');
    insert into profiles (id, display_name, birthdate) values (u, 'S-' || left(u::text, 4), date '1990-01-01');
  end loop;

  insert into gatherings (host_id, title, area, wide_area, interest_tag, scheduled_at, visibility, is_public)
    values (h, 'one', 'x', 'zz', 'Coffee', now() + interval '2 days', 'everyone', true) returning id into g1;
  insert into gatherings (host_id, title, area, wide_area, interest_tag, scheduled_at, visibility, is_public)
    values (h, 'crossing', 'x', 'zz', 'Coffee', now() + interval '2 days', 'everyone', true) returning id into g2;
  insert into gatherings (host_id, title, area, wide_area, interest_tag, scheduled_at, visibility, is_public)
    values (h, 'empty', 'x', 'zz', 'Coffee', now() + interval '2 days', 'everyone', true) returning id into g3;

  -- friendships that existed before anyone joined
  insert into friendships (user_a, user_b, status, requested_by, created_at) values
    (least(h, f), greatest(h, f), 'accepted', h, timestamptz '2020-01-07 12:00+00'),
    (least(h, r), greatest(h, r), 'accepted', h, timestamptz '2020-01-07 12:00+00') on conflict do nothing;

  -- a real failed send: the host may only invite friends, so this raises and leaves no row
  perform set_config('request.jwt.claims', json_build_object('sub', h, 'role', 'authenticated')::text, true);
  begin perform send_social_invite(n, 'gathering', g1); exception when others then v_failed := true; end;
  perform set_config('request.jwt.claims', '', true);

  -- invitations (sent rows only)
  insert into social_invites (inviter_id, invitee_id, invite_type, target_id, status, created_at) values
    (h, i1, 'gathering', g1, 'declined', timestamptz '2020-01-08 13:00+00'),   -- i1: three sends, counted once
    (h, i1, 'gathering', g1, 'accepted', timestamptz '2020-01-08 13:30+00'),
    (f, i1, 'gathering', g1, 'pending',  timestamptz '2020-01-08 14:00+00'),
    (h, j,  'gathering', g1, 'declined', timestamptz '2020-01-08 15:00+00'),   -- j: invited, never joined
    (h, q,  'gathering', g1, 'accepted', timestamptz '2020-01-08 15:00+00'),   -- q: invited, only asked to join
    (h, p,  'gathering', g1, 'pending',  timestamptz '2020-01-09 12:00+00'),   -- p: invited AFTER joining
    (h, i1, 'gathering', g2, 'accepted', timestamptz '2020-01-13 09:00+00');

  -- joins (approved = joined; pending is not)
  insert into gathering_interest (gathering_id, user_id, status, created_at) values
    (g1, p,  'approved', timestamptz '2020-01-09 09:00+00'),
    (g1, f,  'approved', timestamptz '2020-01-09 10:00+00'),
    (g1, n,  'approved', timestamptz '2020-01-09 10:05+00'),   -- no invitation: joined independently
    (g1, l,  'approved', timestamptz '2020-01-09 10:10+00'),
    (g1, i1, 'approved', timestamptz '2020-01-09 11:00+00'),
    (g1, r,  'approved', timestamptz '2020-01-09 12:00+00'),
    (g1, q,  'pending',  timestamptz '2020-01-09 12:30+00'),
    (g2, f,  'approved', timestamptz '2020-01-13 10:00+00'),
    (g2, i1, 'approved', timestamptz '2020-01-13 11:00+00');

  -- after the gathering
  insert into friendships (user_a, user_b, status, requested_by, created_at) values
    (least(h, l), greatest(h, l), 'accepted', l, timestamptz '2020-01-11 09:00+00'),   -- l: requested after joining (and after the event)
    (least(n, i1), greatest(n, i1), 'accepted', n, timestamptz '2020-01-12 09:00+00'),
    (least(r, n), greatest(r, n), 'accepted', r, timestamptz '2020-01-12 10:00+00'),   -- removed below
    (least(p, n), greatest(p, n), 'pending', p, timestamptz '2020-01-12 11:00+00') on conflict do nothing;
  -- friendships later removed (unfriend): no history is kept, so they drop out
  delete from friendships where (user_a, user_b) in ((least(h, r), greatest(h, r)), (least(r, n), greatest(r, n)));

  update gatherings set created_at = timestamptz '2020-01-08 12:00+00', scheduled_at = timestamptz '2020-01-10 18:00+00' where id = g1;
  update gatherings set created_at = timestamptz '2020-01-12 23:30+00', scheduled_at = timestamptz '2020-01-14 18:00+00' where id = g2;
  update gatherings set created_at = timestamptz '2020-01-13 00:30+00', scheduled_at = timestamptz '2020-01-16 18:00+00' where id = g3;

  log := log || jsonb_build_array(jsonb_build_object('step','failed_send_leaves_no_row','ok',
     v_failed and not exists (select 1 from social_invites where target_id = g1 and invitee_id = n)));

  select * into c from gathering_social_conversion where gathering_id = g1;
  log := log || jsonb_build_array(jsonb_build_object('step','attendees_exclude_host_and_pending','ok',
     c.attendees = 6 and c.gathering_week = date '2020-01-06', 'data', to_jsonb(c)));
  log := log || jsonb_build_array(jsonb_build_object('step','friend_joined_only_existing_current_friends','ok',
     c.friends_joined = 1 and c.first_friend_join_at = timestamptz '2020-01-09 10:00+00'
     and (select friend_joined from gathering_social_people sp where sp.gathering_id = g1 and sp.joined_at = timestamptz '2020-01-09 10:00+00')   -- f
     and not (select friend_joined from gathering_social_people sp where sp.gathering_id = g1 and sp.joined_at = timestamptz '2020-01-09 10:05+00')  -- n: not a friend
     and not (select friend_joined from gathering_social_people sp where sp.gathering_id = g1 and sp.joined_at = timestamptz '2020-01-09 10:10+00')  -- l: requested after joining
     and not (select friend_joined from gathering_social_people sp where sp.gathering_id = g1 and sp.joined_at = timestamptz '2020-01-09 12:00+00')  -- r: friendship removed
     and not (select friend_joined from gathering_social_people sp where sp.gathering_id = g1 and sp.joined_at = timestamptz '2020-01-09 11:00+00')));
  log := log || jsonb_build_array(jsonb_build_object('step','invitation_denominator','ok',
     c.invited_recipients = 3 and c.invited_joined = 1 and c.first_invited_at = timestamptz '2020-01-08 13:00+00'
     and c.first_invited_join_at = timestamptz '2020-01-09 11:00+00'
     and (select invitations_received = 3 and invited_recipient and invited_joined from gathering_social_people sp
          where sp.gathering_id = g1 and sp.joined_at = timestamptz '2020-01-09 11:00+00')                                      -- duplicate sends count once
     and (select invited_recipient and not invited_joined from gathering_social_people sp where sp.gathering_id = g1 and sp.first_invited_at = timestamptz '2020-01-08 15:00+00' and sp.joined_at is null limit 1)
     and (select count(*) from gathering_social_people sp where sp.gathering_id = g1 and sp.invited_recipient and not sp.is_attendee) = 2  -- j declined, q only pending
     and (select not invited_recipient and not invited_joined from gathering_social_people sp where sp.gathering_id = g1 and sp.joined_at = timestamptz '2020-01-09 09:00+00')  -- p: invited after joining
     and (select first_invited_at is null and not invited_recipient from gathering_social_people sp where sp.gathering_id = g1 and sp.joined_at = timestamptz '2020-01-09 10:05+00')));  -- n: independent
  log := log || jsonb_build_array(jsonb_build_object('step','became_friends_after','ok',
     c.became_friends_after = 2 and c.first_became_friends_at = timestamptz '2020-01-11 09:00+00'));   -- h+l and n+i1; r+n removed, p+n pending, h+f before

  select * into x from gathering_social_conversion where gathering_id = g2;
  log := log || jsonb_build_array(jsonb_build_object('step','week_boundary_cohort','ok',
     x.gathering_week = date '2020-01-06' and x.attendees = 2 and x.friends_joined = 1 and x.invited_recipients = 1 and x.invited_joined = 1
     and x.first_join_at = timestamptz '2020-01-13 10:00+00' and x.became_friends_after = 0
     and (select gathering_week from gathering_social_conversion where gathering_id = g3) = date '2020-01-13', 'data', to_jsonb(x)));

  select * into w from gathering_social_conversion_summary where dimension = 'week' and value = '2020-01-06';
  log := log || jsonb_build_array(jsonb_build_object('step','week_summary','ok',
     w.gatherings = 2 and w.attendees = 8 and w.friends_joined = 2 and w.gatherings_with_friend_joined = 2
     and w.friends_joined_share = 0.25
     and w.invited_recipients = 4 and w.invited_joined = 2 and w.invited_not_joined = 2 and w.invitation_conversion_rate = 0.5
     and w.became_friends_after = 2 and w.gatherings_with_new_friendship = 1, 'data', to_jsonb(w)));

  -- no double counting: h+f (friends before f joined) is an attended pair with a current friendship but only counts as
  -- a friend who joined; h+l (requested after l joined and after the event) only counts as became friends after
  log := log || jsonb_build_array(jsonb_build_object('step','no_double_counting','ok',
     c.friends_joined = 1 and c.became_friends_after = 2
     and (select host_friend_requested_at = timestamptz '2020-01-11 09:00+00' and not friend_joined from gathering_social_people sp
          where sp.gathering_id = g1 and sp.joined_at = timestamptz '2020-01-09 10:10+00')
     and w.friends_joined + w.became_friends_after = 4));

  select * into e from gathering_social_conversion_summary where dimension = 'week' and value = '2020-01-13';
  log := log || jsonb_build_array(jsonb_build_object('step','empty_denominators_are_null','ok',
     e.gatherings = 1 and e.attendees = 0 and e.invited_recipients = 0
     and e.friends_joined_share is null and e.invitation_conversion_rate is null, 'data', to_jsonb(e)));

  log := log || jsonb_build_array(jsonb_build_object('step','weeks_partition_overall','ok',
     (select count(*) from gathering_social_conversion_summary where dimension = 'overall') = 1
     and (select gatherings from gathering_social_conversion_summary where dimension = 'overall')
       = (select sum(gatherings) from gathering_social_conversion_summary where dimension = 'week')
     and (select attendees from gathering_social_conversion_summary where dimension = 'overall')
       = (select sum(attendees) from gathering_social_conversion_summary where dimension = 'week')
     and not exists (select 1 from gathering_social_conversion_summary where invited_joined > invited_recipients
                     or friends_joined > attendees or invitation_conversion_rate > 1 or friends_joined_share > 1)));

  -- internal only, and no person ids anywhere in the views
  v_n := 0;
  set local role authenticated;
  begin perform 1 from gathering_social_people limit 1; exception when insufficient_privilege then v_n := v_n + 1; end;
  begin perform 1 from gathering_social_conversion limit 1; exception when insufficient_privilege then v_n := v_n + 1; end;
  begin perform 1 from gathering_social_conversion_summary limit 1; exception when insufficient_privilege then v_n := v_n + 1; end;
  reset role;
  set local role anon;
  begin perform 1 from gathering_social_people limit 1; exception when insufficient_privilege then v_n := v_n + 1; end;
  begin perform 1 from gathering_social_conversion limit 1; exception when insufficient_privilege then v_n := v_n + 1; end;
  begin perform 1 from gathering_social_conversion_summary limit 1; exception when insufficient_privilege then v_n := v_n + 1; end;
  reset role;
  log := log || jsonb_build_array(jsonb_build_object('step','internal_only','ok', v_n = 6
     and has_table_privilege('service_role', 'public.gathering_social_conversion_summary', 'select')
     and not exists (select 1 from information_schema.columns where table_schema = 'public'
                     and table_name in ('gathering_social_people', 'gathering_social_conversion', 'gathering_social_conversion_summary')
                     and column_name in ('user_id', 'host_id', 'inviter_id', 'invitee_id', 'user_a', 'user_b', 'requested_by'))));
`);
    s = stepMap(log);
  }, 120000);

  test.each([
    'failed_send_leaves_no_row', 'attendees_exclude_host_and_pending', 'friend_joined_only_existing_current_friends',
    'invitation_denominator', 'became_friends_after', 'week_boundary_cohort', 'week_summary', 'no_double_counting',
    'empty_denominators_are_null', 'weeks_partition_overall', 'internal_only',
  ])('step %s', (name) => {
    expect(s[name]).toBeDefined();
    expect(s[name].ok).toBe(true);
  });
});

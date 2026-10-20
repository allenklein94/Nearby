// Item 122 (owner, 2026-10-16, LOCKED): a completed gathering can keep memories, seen ONLY by the people who were there,
// proven on the live database (one rolled-back transaction; before 20270315 is live, run with
// JOURNEY_PRELUDE_FILE=supabase/migrations/20270315_gathering_memories_attendees_only.sql).
// H hosts a gathering that is over; A attended (approved); K attended but blocked A. F was not there: F is A's accepted
// friend AND A's match AND only has a pending request to join (the database holds 4 people, so one person carries all three
// relations; none of them may grant access, so any one leaking fails the journey). Steps:
//   1  A adds a memory (a photo attached to the gathering); F, who wasn't there, cannot attach one to it
//   2  the memory row: A and H see it; F (friend + match + pending) and K (blocked either way) do not
//   3  its media in storage follows the row: H can read the object, F cannot
//   4  a gathering-linked story marked public is still only for the people who were there (table + map RPC)
//   5  A's ordinary story keeps its rule (F sees it while unexpired; never after expiry)
//   6  the memory sends no "posted a new story" push to F; A's ordinary story still does
//   7  the gathering is deleted: the orphaned memory (gathering_id null, past its 24 h) is visible to no one but A
//   8  item 123: the count read Plans -> Past uses (stories by gathering_id) gives the host/attendee the real number and
//      F (not there) nothing, so F's card could never say "📸 N memories"
// Then Jest runs the client rule the screens use (gatheringMemoryState) on the gathering the database returned.
// Not covered (device only): the Memories section, the photo picker, the viewer, Plans -> Past on a phone.
const { runJourney, stepMap, hasToken, actorsSql, journeyPeople } = require('./journeyHarness');
const { gatheringMemoryState, memoryCountFor } = require('../utils/gatheringCompletion');

const d = hasToken ? describe : describe.skip;

const as = (who) => `perform set_config('request.jwt.claims', json_build_object('sub', ${who}, 'role', 'authenticated')::text, true); set local role authenticated;`;
const asOwner = 'reset role;';
const sees = (step, who, storyVar) => `${as(who)}
  log := log || jsonb_build_array(jsonb_build_object('step', '${step}', 'ok', exists (select 1 from stories where id = ${storyVar})));
  ${asOwner}`;

d('journey: a completed gathering keeps memories only the people who were there can see', () => {
  let s;
  let ids;
  beforeAll(async () => {
    const people = journeyPeople(4);
    ids = { h: people[0].id, a: people[1].id, k: people[2].id, f: people[3].id };
    const log = await runJourney(`
      v_h uuid := '${ids.h}'; v_a uuid := '${ids.a}'; v_k uuid := '${ids.k}'; v_f uuid := '${ids.f}';
      g uuid; mem uuid; pub uuid; ord uuid; v_ok boolean; v_n int;`, `
  ${actorsSql({ people: ['v_h', 'v_a', 'v_k', 'v_f'] })}
  -- setup: only the relations this journey names
  delete from friendships where user_a in (v_h, v_a, v_k, v_f) and user_b in (v_h, v_a, v_k, v_f);
  delete from matches where user_a in (v_h, v_a, v_k, v_f) and user_b in (v_h, v_a, v_k, v_f);
  delete from blocks where blocker_id in (v_h, v_a, v_k, v_f) and blocked_id in (v_h, v_a, v_k, v_f);
  delete from stories where user_id = v_a;
  insert into friendships (user_a, user_b, status, requested_by) values (v_a, v_f, 'accepted', v_a);
  insert into matches (user_a, user_b) values (v_a, v_f);
  insert into blocks (blocker_id, blocked_id) values (v_k, v_a);
  perform set_config('app.trusted_update', 'on', true);
  update profiles set notify_social = true, stories_posted_today = 0 where id in (v_a, v_f);
  insert into gatherings (host_id, title, scheduled_at, precise_lat, precise_lng, interest_tag, area, visibility)
    values (v_h, 'Beach Volleyball', now() + interval '1 day', 26.4, -80.1, 'Volleyball', 'x', 'everyone') returning id into g;
  update gatherings set scheduled_at = now() - interval '1 day', duration_minutes = 120 where id = g;
  insert into gathering_interest (gathering_id, user_id, status) values (g, v_a, 'approved'), (g, v_f, 'pending'), (g, v_k, 'approved');
  log := log || jsonb_build_array(jsonb_build_object('step', 'gathering', 'ok', true, 'data', (select to_jsonb(x) from (select id, host_id, scheduled_at, duration_minutes from gatherings where id = g) x)));

  -- 1: A adds a memory; F (not there) cannot attach one
  ${as('v_a')}
  insert into stories (user_id, media_path, media_type, gathering_id) values (v_a, v_a::text || '/memory-122.jpg', 'image', g) returning id into mem;
  ${asOwner}
  log := log || jsonb_build_array(jsonb_build_object('step', 'added', 'ok', mem is not null));
  begin
    ${as('v_f')}
    insert into stories (user_id, media_path, media_type, gathering_id) values (v_f, v_f::text || '/intruder-122.jpg', 'image', g);
    v_ok := false;
  exception when insufficient_privilege or check_violation then v_ok := true; end;
  ${asOwner}
  log := log || jsonb_build_array(jsonb_build_object('step', 'outsiderAttachRefused', 'ok', v_ok));

  -- 6 (first half): pushes caused by the memory
  log := log || jsonb_build_array(jsonb_build_object('step', 'memoryPush', 'ok', true, 'data', (select count(*) from push_outbox where recipient_id = v_f and data->>'type' = 'new_story' and created_at >= now())));

  -- 2: who sees the memory row
  ${sees('seenByAttendee', 'v_a', 'mem')}
  ${sees('seenByHost', 'v_h', 'mem')}
  ${sees('seenByFriend', 'v_f', 'mem')}
    ${sees('seenByBlocked', 'v_k', 'mem')}

  -- 3: the media object follows the row
  insert into storage.objects (bucket_id, name, owner) values ('stories', v_a::text || '/memory-122.jpg', v_a);
  ${as('v_h')}
  log := log || jsonb_build_array(jsonb_build_object('step', 'mediaHost', 'ok', exists (select 1 from storage.objects where bucket_id = 'stories' and name = v_a::text || '/memory-122.jpg')));
  ${asOwner}
  ${as('v_f')}
  log := log || jsonb_build_array(jsonb_build_object('step', 'mediaFriend', 'ok', exists (select 1 from storage.objects where bucket_id = 'stories' and name = v_a::text || '/memory-122.jpg')));
  ${asOwner}

  -- 4: a gathering-linked story marked public stays with the people who were there
  ${as('v_a')}
  insert into stories (user_id, media_path, media_type, gathering_id, is_public, latitude, longitude) values (v_a, v_a::text || '/public-122.jpg', 'image', g, true, 26.4, -80.1) returning id into pub;
  ${asOwner}
  ${sees('publicMemoryFriend', 'v_f', 'pub')}
  ${as('v_f')}
  log := log || jsonb_build_array(jsonb_build_object('step', 'publicMemoryOnMap', 'ok', exists (select 1 from get_public_stories_with_fuzzed_coords() r where r.id = pub)));
  ${asOwner}

  -- 8: the Plans -> Past count read (getGatheringMemoryCounts), with two memories on the gathering
  ${as('v_h')}
  log := log || jsonb_build_array(jsonb_build_object('step', 'countHost', 'ok', true, 'data', (select count(*) from stories where gathering_id = g)));
  ${asOwner}
  ${as('v_a')}
  log := log || jsonb_build_array(jsonb_build_object('step', 'countAttendee', 'ok', true, 'data', (select count(*) from stories where gathering_id = g)));
  ${asOwner}
  ${as('v_f')}
  log := log || jsonb_build_array(jsonb_build_object('step', 'countOutsider', 'ok', true, 'data', (select count(*) from stories where gathering_id = g)));
  ${asOwner}

  -- 5: A's ordinary story keeps its rule
  ${as('v_a')}
  insert into stories (user_id, media_path, media_type) values (v_a, v_a::text || '/ordinary-122.jpg', 'image') returning id into ord;
  ${asOwner}
  log := log || jsonb_build_array(jsonb_build_object('step', 'ordinaryPush', 'ok', true, 'data', (select count(*) from push_outbox where recipient_id = v_f and data->>'type' = 'new_story' and created_at >= now())));
  ${sees('ordinaryFriend', 'v_f', 'ord')}
    ${sees('ordinaryHost', 'v_h', 'ord')}
  update stories set expires_at = now() - interval '1 minute' where id = ord;
  ${sees('expiredOrdinaryFriend', 'v_f', 'ord')}
  ${sees('expiredOrdinaryOwn', 'v_a', 'ord')}

  -- 7: the gathering is deleted; the orphaned memory never becomes a story for friends
  update stories set expires_at = now() - interval '1 hour' where id = mem;
  delete from gathering_interest where gathering_id = g;
  delete from gatherings where id = g;
  log := log || jsonb_build_array(jsonb_build_object('step', 'orphaned', 'ok', (select gathering_id is null from stories where id = mem)));
  ${sees('orphanFriend', 'v_f', 'mem')}
  ${sees('orphanOwn', 'v_a', 'mem')}

  -- the rule's function is not callable by anon
  log := log || jsonb_build_array(jsonb_build_object('step', 'anonGrant', 'ok', has_function_privilege('anon', 'public.viewer_was_at_gathering(uuid)', 'execute')));
`);
    s = stepMap(log);
  });

  test('1: an attendee adds a memory; someone who was not there cannot attach one', () => {
    expect(s.added.ok).toBe(true);
    expect(s.outsiderAttachRefused.ok).toBe(true);
  });

  test('2: only the host and approved attendees see it (not a friend + match + pending requester, not a blocked pair)', () => {
    expect(s.seenByAttendee.ok).toBe(true);
    expect(s.seenByHost.ok).toBe(true);
    expect(s.seenByFriend.ok).toBe(false);
    expect(s.seenByBlocked.ok).toBe(false);
  });

  test('3: the photo file follows the same rule (no direct storage read by a friend)', () => {
    expect(s.mediaHost.ok).toBe(true);
    expect(s.mediaFriend.ok).toBe(false);
  });

  test('4: marking a memory public changes nothing (table and map)', () => {
    expect(s.publicMemoryFriend.ok).toBe(false);
    expect(s.publicMemoryOnMap.ok).toBe(false);
  });

  test('5: ordinary stories keep their rule, and only while unexpired', () => {
    expect(s.ordinaryFriend.ok).toBe(true);
    expect(s.ordinaryHost.ok).toBe(false);
    expect(s.expiredOrdinaryFriend.ok).toBe(false);
    expect(s.expiredOrdinaryOwn.ok).toBe(true);
  });

  test('6: a memory announces nothing; an ordinary story still notifies friends', () => {
    expect(Number(s.memoryPush.data)).toBe(0);
    expect(Number(s.ordinaryPush.data)).toBe(1);
  });

  test('7: a deleted gathering\'s memory is seen by no one but its poster', () => {
    expect(s.orphaned.ok).toBe(true);
    expect(s.orphanFriend.ok).toBe(false);
    expect(s.orphanOwn.ok).toBe(true);
    expect(s.anonGrant.ok).toBe(false);
  });

  test('8 (item 123): the memory count follows the same rule; the card line only for a completed gathering with memories', () => {
    expect(Number(s.countHost.data)).toBe(2);
    expect(Number(s.countAttendee.data)).toBe(2);
    expect(Number(s.countOutsider.data)).toBe(0);
    const g = s.gathering.data;
    expect(memoryCountFor({ ...g, isHost: true }, Number(s.countHost.data))).toBe(2);
    expect(memoryCountFor({ ...g, myStatus: 'approved' }, Number(s.countAttendee.data))).toBe(2);
    expect(memoryCountFor({ ...g, myStatus: 'approved' }, Number(s.countOutsider.data))).toBe(null);
    expect(memoryCountFor({ ...g }, Number(s.countHost.data))).toBe(null);
  });

  test('client: the screens call it Completed and offer memories only to the people who were there, once it is over', () => {
    const g = s.gathering.data;
    const later = new Date();
    expect(gatheringMemoryState({ ...g, isHost: true }, later)).toEqual({ completed: true, showMemories: true });
    expect(gatheringMemoryState({ ...g, myStatus: 'approved' }, later)).toEqual({ completed: true, showMemories: true });
    expect(gatheringMemoryState({ ...g, myStatus: 'pending' }, later)).toEqual({ completed: false, showMemories: false });
    expect(gatheringMemoryState({ ...g }, later)).toEqual({ completed: false, showMemories: false });
    // still going (1 h into its 2 h): not Completed, no memories yet
    const during = new Date(new Date(g.scheduled_at).getTime() + 60 * 60 * 1000);
    expect(gatheringMemoryState({ ...g, myStatus: 'approved' }, during)).toEqual({ completed: false, showMemories: false });
  });
});

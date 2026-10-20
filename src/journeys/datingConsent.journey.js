// Item 121 follow-up (owner, 2026-10-16): Dating discovery consent, cards AND counts, proven on the live database (one
// rolled-back transaction; before 20270314 is live, run with JOURNEY_PRELUDE_FILE=supabase/migrations/20270314_dating_discovery_consent.sql).
// A is the viewer. B chose Dating; C chose Friends only; D answered nothing. A shared a past gathering with B and C and was
// sighted near B and D, so every Dating card source (Crossed Paths sightings + shared gatherings, Browse by area) holds a
// non-opted-in person. Steps:
//   1  the raw sources still hold B, C and D (nothing about Friends discovery or sightings changes)
//   2  the Dating read (dating_candidates_visible_to_me) returns only B, flagged dating_opted_in; never A itself
//   3  the generic people read (people_visible_to_me) is unchanged (C and D are still people A may see elsewhere)
//   4  C chooses Both -> C appears; B switches to Friends only -> B disappears (consent can be withdrawn)
//   5  a block either way hides an opted-in person from the Dating read
// The view inherits profiles' own rule too (photo-verified, not hidden): the fixtures make all four verified.
//   6  anon is refused; the view exposes no tokens, settings or motivations
// Then Jest runs the client helpers the screens use (merge -> isDatingOptedIn -> countTonightSupply / countNewDatingPeople /
// Home's crossed-paths row / orderForTonight) on the very rows the database returned.
// Not covered (device only): how the Dating deck, Home row and Activity rows look on a phone.
const { runJourney, stepMap, hasToken, actorsSql, journeyPeople } = require('./journeyHarness');
const { mergeCrossedPathsSignals } = require('../services/crossedPathsSignals');
const { isDatingOptedIn, countNewDatingPeople } = require('../utils/datingCountConsent');
const { countTonightSupply, orderForTonight } = require('../utils/meetTonight');
const { homeQuickStatRows } = require('../utils/homeQuiet');

const d = hasToken ? describe : describe.skip;

const as = (who) => `perform set_config('request.jwt.claims', json_build_object('sub', ${who}, 'role', 'authenticated')::text, true); set local role authenticated;`;
const asOwner = 'reset role;';
const datingRead = (step) => `${as('v_a')}
  log := log || jsonb_build_array(jsonb_build_object('step', '${step}', 'ok', true, 'data', coalesce((select jsonb_agg(to_jsonb(r) order by r.id) from dating_candidates_visible_to_me r where r.id in (v_a, v_b, v_c, v_d)), '[]'::jsonb)));
  ${asOwner}`;
const motivations = (who, list) => `perform set_config('app.trusted_update', 'on', true); update profiles set onboarding_motivations = ${list} where id = ${who};`;

d('journey: Dating discovery shows and counts only people who chose Dating', () => {
  let s;
  let ids;
  beforeAll(async () => {
    const people = journeyPeople(4);
    ids = { a: people[0].id, b: people[1].id, c: people[2].id, d: people[3].id };
    const log = await runJourney(`
      v_a uuid := '${ids.a}'; v_b uuid := '${ids.b}'; v_c uuid := '${ids.c}'; v_d uuid := '${ids.d}'; g uuid; v_ok boolean;`, `
  ${actorsSql({ people: ['v_a', 'v_b', 'v_c', 'v_d'] })}
  -- setup: no friendships, matches or blocks among them; B Dating, C Friends only, D nothing; A Dating too
  delete from friendships where user_a in (v_a, v_b, v_c, v_d) and user_b in (v_a, v_b, v_c, v_d);
  delete from matches where user_a in (v_a, v_b, v_c, v_d) and user_b in (v_a, v_b, v_c, v_d);
  delete from blocks where blocker_id in (v_a, v_b, v_c, v_d) and blocked_id in (v_a, v_b, v_c, v_d);
  delete from sightings where user_a in (v_a, v_b, v_c, v_d) and user_b in (v_a, v_b, v_c, v_d);
  ${motivations('v_a', "array['Go on dates']")}
  ${motivations('v_b', "array['Meet people', 'Go on dates']")}
  ${motivations('v_c', "array['Make new friends']")}
  ${motivations('v_d', "array[]::text[]")}
  update profiles set wide_area = '40.3,-75.2', photo_verified = true, profile_hidden = false where id in (v_a, v_b, v_c, v_d);
  -- a past gathering (hosted by D) A, B and C all attended (shared attendance is NOT consent)
  insert into gatherings (host_id, title, scheduled_at, precise_lat, precise_lng, interest_tag, area, visibility)
    values (v_d, 'Trivia night', now() + interval '1 day', 40.3, -75.2, 'Trivia', 'x', 'everyone') returning id into g;
  update gatherings set scheduled_at = now() - interval '2 days' where id = g;
  insert into gathering_interest (gathering_id, user_id, status) values (g, v_a, 'approved'), (g, v_b, 'approved'), (g, v_c, 'approved');
  -- sightings: A near B and near D, an hour ago
  insert into sightings (user_a, user_b, last_seen_at) values (v_a, v_b, now() - interval '1 hour'), (v_a, v_d, now() - interval '1 hour');

  -- 1: raw sources (unchanged)
  ${as('v_a')}
  log := log || jsonb_build_array(jsonb_build_object('step', 'partners', 'ok', true, 'data', coalesce((select jsonb_agg(to_jsonb(r)) from get_shared_gathering_partners() r where r.other_user_id in (v_b, v_c, v_d)), '[]'::jsonb)));
  log := log || jsonb_build_array(jsonb_build_object('step', 'sightings', 'ok', true, 'data', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'user_a', x.user_a, 'user_b', x.user_b, 'last_seen_at', x.last_seen_at)) from sightings x where (x.user_a = v_a or x.user_b = v_a) and (x.user_a in (v_b, v_c, v_d) or x.user_b in (v_b, v_c, v_d))), '[]'::jsonb)));
  log := log || jsonb_build_array(jsonb_build_object('step', 'peopleView', 'ok', true, 'data', (select count(*) from people_visible_to_me where id in (v_b, v_c, v_d))));
  log := log || jsonb_build_array(jsonb_build_object('step', 'browseArea', 'ok', true, 'data', coalesce((select jsonb_agg(r.id) from dating_candidates_visible_to_me r where r.wide_area = '40.3,-75.2' and r.id in (v_a, v_b, v_c, v_d)), '[]'::jsonb)));
  ${asOwner}

  -- 2: the Dating read
  ${datingRead('dating')}

  -- 4: consent given / withdrawn
  ${motivations('v_c', "array['Make new friends', 'Go on dates']")}
  ${datingRead('cOptsIn')}
  ${motivations('v_b', "array['Make new friends']")}
  ${datingRead('bWithdraws')}
  ${motivations('v_b', "array['Go on dates']")}

  -- 5: a block either way
  insert into blocks (blocker_id, blocked_id) values (v_b, v_a);
  ${datingRead('blocked')}
  delete from blocks where blocker_id = v_b and blocked_id = v_a;

  -- 6: anon refused; columns
  begin
    perform set_config('request.jwt.claims', '{"role":"anon"}', true); set local role anon;
    perform * from dating_candidates_visible_to_me; v_ok := false;
  exception when insufficient_privilege then v_ok := true; end;
  ${asOwner}
  log := log || jsonb_build_array(jsonb_build_object('step', 'anonRefused', 'ok', v_ok));
  log := log || jsonb_build_array(jsonb_build_object('step', 'columns', 'ok', true, 'data', (select jsonb_agg(column_name::text order by ordinal_position) from information_schema.columns where table_schema = 'public' and table_name = 'dating_candidates_visible_to_me')));
  log := log || jsonb_build_array(jsonb_build_object('step', 'writeGrants', 'ok', true, 'data', (select count(*) from information_schema.role_table_grants where table_name = 'dating_candidates_visible_to_me' and grantee in ('authenticated', 'anon', 'public') and privilege_type <> 'SELECT')));
`);
    s = stepMap(log);
  });

  const idsOf = (step) => (s[step].data ?? []).map((r) => r.id);

  test('1: the raw sources still hold the non-opted-in people (Friends discovery and sightings unchanged)', () => {
    expect(s.partners.data.map((r) => r.other_user_id).sort()).toEqual([ids.b, ids.c].sort());
    expect(s.sightings.data).toHaveLength(2);
    expect(Number(s.peopleView.data)).toBe(3);
  });

  test('2: the Dating read returns only the opted-in person, flagged, never the viewer', () => {
    expect(idsOf('dating')).toEqual([ids.b]);
    expect(s.dating.data[0].dating_opted_in).toBe(true);
    expect(s.browseArea.data).toEqual([ids.b]);
  });

  test('4: consent can be given and withdrawn', () => {
    expect(idsOf('cOptsIn').sort()).toEqual([ids.b, ids.c].sort());
    expect(idsOf('bWithdraws')).toEqual([ids.c]);
  });

  test('5: a block either way hides an opted-in person', () => {
    expect(idsOf('blocked')).toEqual([ids.c]);
  });

  test('6: anon refused, read-only, and no tokens, settings or motivations exposed', () => {
    expect(s.anonRefused.ok).toBe(true);
    expect(Number(s.writeGrants.data)).toBe(0);
    expect(s.columns.data).toEqual(['id', 'display_name', 'photo_url', 'bio', 'discovery_gender', 'birthdate', 'ethnicity', 'interests', 'basics',
      'height_inches', 'photo_verified', 'relationship_intention', 'gender_identity', 'interested_in_genders', 'show_me', 'wide_area', 'dating_opted_in']);
  });

  test('client: cards and both counts built from these rows contain only the opted-in person', () => {
    const sightingSignals = s.sightings.data.map((x) => ({ otherUserId: x.user_a === ids.a ? x.user_b : x.user_a, last_seen_at: x.last_seen_at, sightingId: x.id }));
    const merged = mergeCrossedPathsSignals(sightingSignals, s.partners.data);
    expect(merged.map((m) => m.otherUserId).sort()).toEqual([ids.b, ids.c, ids.d].sort());
    const byId = Object.fromEntries(s.dating.data.map((p) => [p.id, p]));
    // what getNearbyMatches returns: a profile only from the Dating read, then the verdict re-checked
    const cards = merged.map((m) => ({ ...m, profiles: byId[m.otherUserId] ?? null })).filter((i) => i.profiles !== null && isDatingOptedIn(i));
    expect(cards.map((c) => c.otherUserId)).toEqual([ids.b]);
    expect(countTonightSupply({ subMode: 'dating', list: cards })).toBe(1);
    expect(countNewDatingPeople(cards, new Date(Date.now() - 3 * 3600 * 1000).toISOString())).toBe(1);
    expect(orderForTonight(cards, { subMode: 'dating' }).map((c) => c.otherUserId)).toEqual([ids.b]);
    const crossed = homeQuickStatRows({ mostRecentSighting: cards[0] }).find((r) => r.key === 'crossed');
    expect(crossed?.params).toEqual({ userId: ids.b });
  });
});

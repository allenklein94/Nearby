// Owner item 145 (2026-10-17, approved): "Get directions" on a gathering's meet-up point, for the people who may know the exact
// spot. Played against the database the way the app does it (join_gathering as each person), then the client's link builder
// (buildDirectionsUrl, after the service's own number check) is applied to what get_gathering_meetup_point returns:
//   host                                   -> the exact point -> a directions link to it
//   approved attendee (open gathering)     -> the exact point -> a directions link to it
//   requested (approval needed, pending)   -> nothing         -> no link
//   waitlisted (full gathering)            -> nothing         -> no link
//   a stranger who never joined it         -> nothing         -> no link (the requester, on the open gathering)
//   anon cannot call the lookup at all.
// Rolled back. No migration: the lookup is the existing host/attendee-only RPC. NOT covered (found while building, reported to
// the owner 2026-10-17, pre-existing): `gatherings.precise_lat/lng` are selectable by anon/authenticated through the table's own
// grants + RLS (a direct read of a visible gathering returns them); the app never selects them (SAFE_GATHERING_FIELDS).
const { runSql } = require('../../scripts/live-verify/lib/db');
const { runJourney, stepMap, hasToken } = require('./journeyHarness');
import { buildDirectionsUrl, isValidCoordinate } from '../utils/planLogisticsActions';

const d = hasToken ? describe : describe.skip;

// The service's own reading of the RPC row (services/gatherings.js getGatheringMeetupPoint), then the link builder.
function linkFor(rows) {
  const p = Array.isArray(rows) ? rows[0] : null;
  if (!p || p.lat == null || p.lng == null) return null;
  const latitude = Number(p.lat);
  const longitude = Number(p.lng);
  if (!isValidCoordinate(latitude, longitude)) return null;
  return buildDirectionsUrl({ latitude, longitude });
}

d('journey: Get directions only for the host and approved attendees', () => {
  let s;
  beforeAll(async () => {
    const people = await runSql(`select id from profiles order by created_at limit 4;`);
    const log = await runJourney(`
      v_host uuid := '${people[0].id}'; v_fan uuid := '${people[1].id}'; v_req uuid := '${people[2].id}';
      v_wait uuid := '${people[3].id}';
      v_open uuid; v_appr uuid; v_full uuid;`, `
  perform set_config('request.jwt.claims', json_build_object('sub', v_host, 'role', 'authenticated')::text, true);
  insert into gatherings (host_id, title, scheduled_at, precise_lat, precise_lng, interest_tag, area, capacity, visibility)
    values (v_host, 'J145 open', now() + interval '1 hour', 26.4615, -80.0728, 'Coffee', 'journey', 10, 'everyone') returning id into v_open;
  insert into gatherings (host_id, title, scheduled_at, precise_lat, precise_lng, interest_tag, area, capacity, visibility)
    values (v_host, 'J145 approval', now() + interval '1 hour', 26.4615, -80.0728, 'Coffee', 'journey', 10, 'everyone') returning id into v_appr;
  insert into gatherings (host_id, title, scheduled_at, precise_lat, precise_lng, interest_tag, area, capacity, visibility)
    values (v_host, 'J145 full', now() + interval '1 hour', 26.4615, -80.0728, 'Coffee', 'journey', 2, 'everyone') returning id into v_full;
  update gatherings set wide_area = '26.46,-80.07', is_public = true where id in (v_open, v_appr, v_full);
  update gatherings set requires_approval = true where id = v_appr;

  log := log || jsonb_build_array(jsonb_build_object('step','host','ok', true,
    'data', (select coalesce(jsonb_agg(jsonb_build_object('lat', latitude, 'lng', longitude)), '[]'::jsonb) from get_gathering_meetup_point(v_open))));

  perform set_config('request.jwt.claims', json_build_object('sub', v_fan, 'role', 'authenticated')::text, true);
  perform join_gathering(v_open);
  perform join_gathering(v_full); -- takes the full gathering's one guest spot
  log := log || jsonb_build_array(jsonb_build_object('step','approved','ok', true,
    'data', jsonb_build_object('status', (select status from gathering_interest where gathering_id = v_open and user_id = v_fan),
      'rows', (select coalesce(jsonb_agg(jsonb_build_object('lat', latitude, 'lng', longitude)), '[]'::jsonb) from get_gathering_meetup_point(v_open)))));

  perform set_config('request.jwt.claims', json_build_object('sub', v_req, 'role', 'authenticated')::text, true);
  perform join_gathering(v_appr);
  log := log || jsonb_build_array(jsonb_build_object('step','requested','ok', true,
    'data', jsonb_build_object('status', (select status from gathering_interest where gathering_id = v_appr and user_id = v_req),
      'rows', (select coalesce(jsonb_agg(jsonb_build_object('lat', latitude, 'lng', longitude)), '[]'::jsonb) from get_gathering_meetup_point(v_appr)))));

  perform set_config('request.jwt.claims', json_build_object('sub', v_wait, 'role', 'authenticated')::text, true);
  perform join_gathering(v_full);
  log := log || jsonb_build_array(jsonb_build_object('step','waitlisted','ok', true,
    'data', jsonb_build_object('status', (select status from gathering_interest where gathering_id = v_full and user_id = v_wait),
      'rows', (select coalesce(jsonb_agg(jsonb_build_object('lat', latitude, 'lng', longitude)), '[]'::jsonb) from get_gathering_meetup_point(v_full)))));

  -- the requester never joined the open gathering: there, they are a stranger
  perform set_config('request.jwt.claims', json_build_object('sub', v_req, 'role', 'authenticated')::text, true);
  log := log || jsonb_build_array(jsonb_build_object('step','stranger','ok', true,
    'data', jsonb_build_object(
      'rows', (select coalesce(jsonb_agg(jsonb_build_object('lat', latitude, 'lng', longitude)), '[]'::jsonb) from get_gathering_meetup_point(v_open)),
      'anon_can_call', has_function_privilege('anon', 'public.get_gathering_meetup_point(uuid)', 'execute'))));`);
    s = stepMap(log);
  }, 120000);

  const data = (k) => s[k].data;
  const exact = 'https://www.google.com/maps/dir/?api=1&destination=26.4615,-80.0728';

  test('host: the exact meet-up point -> a directions link to it', () => {
    expect(linkFor(data('host'))).toBe(exact);
  });

  test('approved attendee: the exact meet-up point -> a directions link to it', () => {
    expect(data('approved').status).toBe('approved');
    expect(linkFor(data('approved').rows)).toBe(exact);
  });

  test('requested on an approval-needed gathering: no point, no link', () => {
    expect(data('requested')).toEqual({ status: 'pending', rows: [] });
    expect(linkFor(data('requested').rows)).toBeNull();
  });

  test('waitlisted on a full gathering: no point, no link', () => {
    expect(data('waitlisted')).toEqual({ status: 'waitlisted', rows: [] });
    expect(linkFor(data('waitlisted').rows)).toBeNull();
  });

  test('a stranger gets nothing; anon cannot call the lookup', () => {
    expect(data('stranger')).toEqual({ rows: [], anon_can_call: false });
    expect(linkFor(data('stranger').rows)).toBeNull();
  });
});

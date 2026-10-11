// Owner item 43 (2026-10-11): Create -> publish -> the formation. The host creates a gathering as the app does (authenticated,
// RLS), invites a friend through the real send_social_invite, and the row is read back as the host; Jest then builds the
// formation's pieces (utils/gatheringFormation.js) from exactly what the database returned -- never from the form.
// One rolled-back transaction. Not covered (device only): the look of the motion, Reduce Motion, the haptic.
jest.mock('../services/supabase', () => ({ supabase: {} }));
const { runSql } = require('../../scripts/live-verify/lib/db');
const { runJourney, stepMap, hasToken } = require('./journeyHarness');
const { formationPieces } = require('../utils/gatheringFormation');
const { displayGatheringWhen } = require('../i18n/display');
const { tr } = require('../i18n/translate');

const d = hasToken ? describe : describe.skip;
const t = (k, p) => tr(k, p);

d('journey: create a gathering -> the published formation shows what was really stored', () => {
  let s;
  beforeAll(async () => {
    const [f] = await runSql(`select user_a, user_b from friendships where status = 'accepted' limit 1;`);
    const log = await runJourney(`v_a uuid := '${f.user_a}'; v_b uuid := '${f.user_b}'; v_g uuid; v_inv uuid;`, `
  perform set_config('request.jwt.claims', json_build_object('sub', v_a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  -- 1. the host publishes (the app's own insert, under RLS)
  insert into gatherings (host_id, title, scheduled_at, precise_lat, precise_lng, interest_tag, area, capacity, visibility, duration_minutes)
    values (v_a, 'J43 Sunday pickleball', date_trunc('hour', now()) + interval '3 days', 40.3, -75.2, 'Pickleball', 'journey', 8, 'friends', 90)
    returning id into v_g;
  -- 2. and invites a friend at publish (item 109)
  perform send_social_invite('gathering', v_g, v_b);
  select id into v_inv from social_invites where inviter_id = v_a and invitee_id = v_b and target_id = v_g;
  -- 3. the gathering screen reads the stored row back as the host
  log := log || jsonb_build_array(jsonb_build_object('step', 'stored', 'ok', true, 'data', (
    select jsonb_build_object('id', x.id, 'title', x.title, 'interest_tag', x.interest_tag, 'visibility', x.visibility,
      'scheduled_at', x.scheduled_at, 'duration_minutes', x.duration_minutes, 'host_id', x.host_id)
    from gatherings x where x.id = v_g)));
  log := log || jsonb_build_array(jsonb_build_object('step', 'invite', 'ok', v_inv is not null));
  reset role;`);
    s = stepMap(log);
  }, 90000);

  test('the stored row came back to the host, and the invite really went out', () => {
    expect(s.stored.data.title).toBe('J43 Sunday pickleball');
    expect(s.invite.ok).toBe(true);
  });
  test('the formation is built from the stored row: what, when (the one when engine), who (+ the real invite), where', () => {
    const g = s.stored.data;
    const pieces = formationPieces({ gathering: g, whenLabel: displayGatheringWhen(g, 'en'), placeName: null, customLocation: false, preInviteResult: { sent: 1, total: 1 }, t });
    expect(pieces.map((p) => p.key)).toEqual(['what', 'when', 'who', 'where']);
    expect(pieces[0].text).toBe('J43 Sunday pickleball');
    expect(pieces[1].text).toBe(displayGatheringWhen(g, 'en'));
    expect(pieces[1].text).toBeTruthy();
    expect(pieces[2].text).toBe(tr('ui.gatheringVocab.visibility.friends.label'));
    expect(pieces[2].note).toBe(tr('ui.gatheringConfirmation.weInvited', { sent: 1, count: 1 }));
    expect(pieces[3].text).toBe(tr('ui.gatheringForm.currentLocation'));
  });
});

// Journey (item 87 audit): a RECOMMENDATION travels from creation to completion. A friend hosts a coffee gathering ->
// the viewer can see it -> the recommendation is built (one card, real reasons) with the right CTA -> the viewer marks
// it Interested (private) -> joins (Interested clears, attendance is the one state) -> the event passes and the same
// object reads "View Past Event", never Join. Rolled back. The real UI is not driven: the client helpers the screens
// call (`mergeHomeGatheringSignals`, `gatheringPrimaryAction`, `gatheringViewerState`) run on the rows the DB produced.
const { runSql } = require('../../scripts/live-verify/lib/db');
const { runJourney, stepMap, hasToken } = require('./journeyHarness');
import { gatheringPrimaryAction } from '../utils/primaryAction';
import { mergeHomeGatheringSignals } from '../utils/homeSignalMerge';
import { gatheringViewerState } from '../utils/objectState';

const d = hasToken ? describe : describe.skip;

d('journey: friend hosts -> recommendation -> interested -> join -> event passes', () => {
  let s; let host; let viewer;
  beforeAll(async () => {
    const [f] = await runSql(`select user_a, user_b from friendships where status = 'accepted' limit 1;`);
    host = f.user_a; viewer = f.user_b;
    const log = await runJourney(`
      v_h uuid := '${host}'; v_v uuid := '${viewer}'; v_g uuid; v_n int; v_res jsonb; v_row record; v_cnt int;`, `
  perform set_config('request.jwt.claims', json_build_object('sub', v_h, 'role', 'authenticated')::text, true);
  insert into gatherings (host_id, title, scheduled_at, precise_lat, precise_lng, interest_tag, area, capacity, visibility)
    values (v_h, 'Journey rec coffee', now() + interval '2 days', 40.0, -75.0, 'Coffee', 'journey', 6, 'everyone') returning id into v_g;
  update gatherings set wide_area = '40.0,-75.0', is_public = true where id = v_g;
  log := log || jsonb_build_array(jsonb_build_object('step','host_creates','ok', v_g is not null));

  -- the viewer can see it (this is what feeds the recommendation)
  perform set_config('request.jwt.claims', json_build_object('sub', v_v, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_n from gatherings where id = v_g;
  reset role;
  log := log || jsonb_build_array(jsonb_build_object('step','viewer_sees_it','ok', v_n = 1));

  -- Interested: private. The host gets a count only and cannot read the row.
  perform set_gathering_interested(v_g, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_h, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_n from gathering_interested where gathering_id = v_g;
  reset role;
  v_cnt := get_gathering_interested_count(v_g);
  log := log || jsonb_build_array(jsonb_build_object('step','interested_is_private','ok', v_n = 0 and v_cnt = 1,
     'data', jsonb_build_object('rows_host_can_read', v_n, 'count', v_cnt)));

  -- join: the person becomes an attendee, Interested is cleared (one state, not two)
  perform set_config('request.jwt.claims', json_build_object('sub', v_v, 'role', 'authenticated')::text, true);
  v_res := join_gathering(v_g);
  select count(*) into v_n from gathering_interested where gathering_id = v_g and user_id = v_v;
  log := log || jsonb_build_array(jsonb_build_object('step','join_clears_interested','ok', v_n = 0 and v_res->>'status' = 'approved',
     'data', jsonb_build_object('status', v_res->>'status')));

  -- the event passes
  update gatherings set scheduled_at = now() - interval '1 day' where id = v_g;
  select id, host_id, title, scheduled_at, capacity, visibility, is_public, interest_tag into v_row from gatherings where id = v_g;
  log := log || jsonb_build_array(jsonb_build_object('step','row','ok', true, 'data', to_jsonb(v_row)));
`);
    s = stepMap(log);
  }, 60000);

  test.each(['host_creates', 'viewer_sees_it', 'interested_is_private', 'join_clears_interested'])('step %s', (n) => {
    expect(s[n]).toBeDefined();
    expect(s[n].ok).toBe(true);
  });

  test('the client turns the same row into ONE card with real reasons and the right CTA at each stage', () => {
    const row = s.row.data;
    const upcoming = { ...row, scheduled_at: new Date(Date.now() + 2 * 864e5).toISOString(), attendees: [], profiles: { display_name: 'Sam' } };
    // recommended twice (interest + friend hosting) -> one card, both reasons, nothing generic
    const merged = mergeHomeGatheringSignals({
      becauseYouLike: [upcoming], friends: [upcoming], friendIds: new Set([host]),
      declaredInterests: ['Coffee'], activityCategories: [],
    });
    expect(merged.cards.length).toBe(1);
    const texts = merged.cards[0].signals.map((x) => x.text).join(' | ');
    expect(texts).toMatch(/Because you like Coffee/);
    expect(texts).toMatch(/Sam is hosting this/);

    // before joining: the viewer is offered Join; low-commitment surfaces offer private Interested
    expect(gatheringPrimaryAction(upcoming, viewer).kind).toBe('join');
    expect(gatheringPrimaryAction(upcoming, viewer, Date.now(), { lowCommitment: true, interestedIds: new Set() }).kind).toBe('interested');
    // the host never gets Join on their own gathering
    expect(gatheringPrimaryAction(upcoming, host).kind).toBe('view_plan');

    // after joining: View Plan, never Join again
    const joined = { ...upcoming, attendees: [{ user_id: viewer, status: 'approved' }] };
    expect(gatheringPrimaryAction(joined, viewer).kind).toBe('view_plan');

    // after the event: the same object reads as a finished event with no action
    const past = { ...joined, scheduled_at: row.scheduled_at };
    const a = gatheringPrimaryAction(past, viewer);
    expect(a.kind).toBe('view');
    expect(a.label).toBe('View Past Event');
    expect(gatheringViewerState({ myStatus: 'approved', scheduled_at: row.scheduled_at }).actionable).toBe(false);
  });
});

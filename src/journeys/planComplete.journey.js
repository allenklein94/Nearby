// Owner item 34 (2026-10-11): "Plan complete". One person (fan) attends gatherings that end, then Home's ONE rule
// (services/gatherings.js getMostRecentUnratedGathering + utils/gatheringCompletion.js completedPlanFor) is applied to the
// rows the database actually holds:
//   A. approved, over (start 3 h ago, 60 min)         -> offered once newer ones are answered; rated "Loved it" -> gone
//   B. approved, still going (10 min ago, 120 min)    -> never Completed while it is happening
//   C. approved, over (90 min ago, no duration)       -> the card shown first (most recent that is over); Skip -> gone
//   D. join request still pending, over               -> not attended, never offered
// Each answer writes the one gathering_feedback row (Skip = an honest empty row, no rating invented), so the card never
// comes back or duplicates. Item 35: the answer then feeds the next recommendations (get_my_experience_feedback, read through
// utils/experienceFeedback.js): Loved it lifts that host and kind, a later Not for me lowers. Rolled back. The move (once per gathering, Reduce Motion) and the Home wiring are checked in
// utils/gatheringCompletion.test.js. Not covered: rendering on a device.
const { runJourney, stepMap, hasToken, actorsSql, journeyPeople } = require('./journeyHarness');
import { completedPlanFor } from '../utils/gatheringCompletion';
import { SATISFACTION_SCALE } from '../constants/satisfactionScale';
import { experienceFeedbackFromRow, feedbackFor } from '../utils/experienceFeedback';

const d = hasToken ? describe : describe.skip;

// The service's query, as SQL: the fan's approved attendances that started in the last 3 days, newest first, no feedback row.
const CANDIDATES = `(select coalesce(jsonb_agg(jsonb_build_object('id', g.id, 'title', g.title, 'scheduled_at', g.scheduled_at,
    'duration_minutes', g.duration_minutes) order by g.scheduled_at desc), '[]'::jsonb)
  from gathering_interest gi join gatherings g on g.id = gi.gathering_id
  where gi.user_id = v_fan and gi.status = 'approved' and g.scheduled_at < now() and g.scheduled_at > now() - interval '3 days'
    and g.id in (v_a, v_b, v_c, v_d)
    and not exists (select 1 from gathering_feedback f where f.gathering_id = g.id and f.reviewer_id = v_fan))`;

d('journey: an attended gathering ends -> Completed on Your Plans -> How was it? -> answered once', () => {
  let s;
  beforeAll(async () => {
    const people = journeyPeople(2);
    const log = await runJourney(`
      v_host uuid := '${people[0].id}'; v_fan uuid := '${people[1].id}';
      v_a uuid; v_b uuid; v_c uuid; v_d uuid; v_e uuid; v_res jsonb;`, `
  ${actorsSql({ people: ['v_host', 'v_fan'] })}
  perform set_config('request.jwt.claims', json_build_object('sub', v_host, 'role', 'authenticated')::text, true);
  insert into gatherings (host_id, title, scheduled_at, precise_lat, precise_lng, interest_tag, area, capacity, visibility)
    values (v_host, 'J34 over', now() + interval '3 days', 40.3, -75.2, 'Coffee', 'journey', 10, 'everyone') returning id into v_a;
  insert into gatherings (host_id, title, scheduled_at, precise_lat, precise_lng, interest_tag, area, capacity, visibility)
    values (v_host, 'J34 live', now() + interval '3 days', 40.3, -75.2, 'Coffee', 'journey', 10, 'everyone') returning id into v_b;
  insert into gatherings (host_id, title, scheduled_at, precise_lat, precise_lng, interest_tag, area, capacity, visibility)
    values (v_host, 'J34 skip', now() + interval '3 days', 40.3, -75.2, 'Coffee', 'journey', 10, 'everyone') returning id into v_c;
  insert into gatherings (host_id, title, scheduled_at, precise_lat, precise_lng, interest_tag, area, capacity, visibility)
    values (v_host, 'J34 pending', now() + interval '3 days', 40.3, -75.2, 'Coffee', 'journey', 10, 'everyone') returning id into v_d;
  update gatherings set wide_area = '40.3,-75.2', is_public = true where id in (v_a, v_b, v_c, v_d);
  update gatherings set requires_approval = true where id = v_d;

  perform set_config('request.jwt.claims', json_build_object('sub', v_fan, 'role', 'authenticated')::text, true);
  perform join_gathering(v_a);
  perform join_gathering(v_b);
  perform join_gathering(v_c);
  v_res := join_gathering(v_d);
  log := log || jsonb_build_array(jsonb_build_object('step','joined','ok', true, 'data', jsonb_build_object(
    'statuses', (select jsonb_object_agg(g.title, gi.status) from gathering_interest gi join gatherings g on g.id = gi.gathering_id
                 where gi.user_id = v_fan and gi.gathering_id in (v_a, v_b, v_c, v_d)))));

  -- time passes (the clock, not an actor)
  update gatherings set scheduled_at = now() - interval '3 hours', duration_minutes = 60 where id = v_a;
  update gatherings set scheduled_at = now() - interval '10 minutes', duration_minutes = 120 where id = v_b;
  update gatherings set scheduled_at = now() - interval '90 minutes', duration_minutes = null where id = v_c;
  update gatherings set scheduled_at = now() - interval '2 hours', duration_minutes = 60 where id = v_d;
  log := log || jsonb_build_array(jsonb_build_object('step','after_it_ends','ok', true, 'data', jsonb_build_object('c', ${CANDIDATES})));

  -- the fan answers on the card shown (C): Skip = the honest empty row
  insert into gathering_feedback (gathering_id, reviewer_id) values (v_c, v_fan);
  log := log || jsonb_build_array(jsonb_build_object('step','after_skip','ok', true, 'data', jsonb_build_object('c', ${CANDIDATES},
    'row', (select to_jsonb(f) - 'id' - 'created_at' from gathering_feedback f where f.gathering_id = v_c and f.reviewer_id = v_fan))));

  -- then the next card (A): Loved it, because of the people
  insert into gathering_feedback (gathering_id, reviewer_id, satisfaction_rating, great_because) values (v_a, v_fan, 'loved_it', array['people']);
  log := log || jsonb_build_array(jsonb_build_object('step','after_rate','ok', true, 'data', jsonb_build_object('c', ${CANDIDATES},
    'row', (select to_jsonb(f) - 'id' - 'created_at' from gathering_feedback f where f.gathering_id = v_a and f.reviewer_id = v_fan))));

  -- a second answer for the same gathering is refused (one row per person per gathering): the card can never duplicate
  begin
    insert into gathering_feedback (gathering_id, reviewer_id, satisfaction_rating) values (v_a, v_fan, 'good');
    log := log || jsonb_build_array(jsonb_build_object('step','second_answer','ok', true, 'data', jsonb_build_object('refused', false)));
  exception when unique_violation then
    log := log || jsonb_build_array(jsonb_build_object('step','second_answer','ok', true, 'data', jsonb_build_object('refused', true)));
  end;

  -- item 35: what the fan's next recommendations read (the fan's own call; auth.uid() inside)
  log := log || jsonb_build_array(jsonb_build_object('step','feedback_after_loved','ok', true, 'data',
    (select to_jsonb(f) from public.get_my_experience_feedback() f)));
  -- a later plan with the same host, a different kind: Not for me (a later answer = the latest word on that host)
  perform set_config('request.jwt.claims', json_build_object('sub', v_host, 'role', 'authenticated')::text, true);
  insert into gatherings (host_id, title, scheduled_at, precise_lat, precise_lng, interest_tag, area, capacity, visibility)
    values (v_host, 'J35 bowling', now() + interval '3 days', 40.3, -75.2, 'Bowling', 'journey', 10, 'everyone') returning id into v_e;
  perform set_config('request.jwt.claims', json_build_object('sub', v_fan, 'role', 'authenticated')::text, true);
  perform join_gathering(v_e);
  update gatherings set scheduled_at = now() - interval '3 hours', duration_minutes = 60 where id = v_e;
  insert into gathering_feedback (gathering_id, reviewer_id, satisfaction_rating, created_at)
    values (v_e, v_fan, 'not_for_me', now() + interval '1 minute'); -- answered later than A (one transaction = one now())
  log := log || jsonb_build_array(jsonb_build_object('step','feedback_after_not_for_me','ok', true, 'data',
    (select to_jsonb(f) from public.get_my_experience_feedback() f) || jsonb_build_object('host', v_host)));`);
    s = stepMap(log);
  }, 120000);

  const data = (k) => s[k].data;
  // Home's pick: the newest candidate that is really over (exactly the service's find()).
  const pick = (c) => c.find((g) => completedPlanFor(g)) ?? null;

  test('setup: three attendances, one join request still pending', () => {
    expect(data('joined').statuses).toEqual({ 'J34 over': 'approved', 'J34 live': 'approved', 'J34 skip': 'approved', 'J34 pending': 'pending' });
  });

  test('after it ends: a pending request is never offered; a gathering still going is never Completed', () => {
    const c = data('after_it_ends').c;
    expect(c.map((g) => g.title)).toEqual(['J34 live', 'J34 skip', 'J34 over']);
    expect(completedPlanFor(c[0])).toBeNull();
    expect(pick(c).title).toBe('J34 skip');
  });

  test('Skip writes an honest empty row and the card leaves; the next finished plan is offered', () => {
    const { c, row } = data('after_skip');
    expect(row).toMatchObject({ satisfaction_rating: null, great_because: null, felt_welcoming: null, would_attend_again: null });
    expect(c.map((g) => g.title)).not.toContain('J34 skip');
    expect(pick(c).title).toBe('J34 over');
  });

  test('a rating is stored on the shared scale and nothing is left to ask (the live one waits until it ends)', () => {
    const { c, row } = data('after_rate');
    expect(row).toMatchObject({ satisfaction_rating: 'loved_it', great_because: ['people'] });
    expect(SATISFACTION_SCALE.map((o) => o.value)).toContain(row.satisfaction_rating);
    expect(pick(c)).toBeNull();
    expect(c.map((g) => g.title)).toEqual(['J34 live']);
  });

  test('a second answer for the same gathering is refused: the card can never duplicate', () => {
    expect(data('second_answer').refused).toBe(true);
  });

  // Item 35: "How was it?" improves recommendations, both ways.
  test('Loved it (rating alone, would-go-again not asked) lifts that host and that kind of plan', () => {
    const f = experienceFeedbackFromRow(data('feedback_after_loved'));
    const host = data('feedback_after_not_for_me').host;
    expect(f.lovedHosts.has(host)).toBe(true);
    expect(f.lovedKinds.has('Coffee')).toBe(true);
    const ranked = feedbackFor({ hostId: host, category: 'Coffee' }, f);
    expect(ranked).toMatchObject({ direction: 1, reason: 'You loved a gathering with this host before' });
  });

  test('a later Not for me lowers that host and that kind; the loved kind stays loved', () => {
    const row = data('feedback_after_not_for_me');
    const f = experienceFeedbackFromRow(row);
    expect(f.notForMeHosts.has(row.host)).toBe(true);
    expect(f.lovedHosts.has(row.host)).toBe(false);
    expect(f.notForMeKinds.has('Bowling')).toBe(true);
    expect(f.lovedKinds.has('Coffee')).toBe(true);
    // the next recommendation from that host ranks down, with no reason line; another host's coffee ranks up
    expect(feedbackFor({ hostId: row.host, category: 'Coffee' }, f)).toMatchObject({ direction: -1, reason: null });
    expect(feedbackFor({ hostId: 'someone-else', category: 'Coffee' }, f).direction).toBe(1);
  });
});

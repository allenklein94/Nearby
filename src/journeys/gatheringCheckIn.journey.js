// Check-in window (owner, 2026-10-17; scope G1/G2 in PRODUCT_AUDIT/PLAN_LIFECYCLE_AND_YOURE_HERE_SCOPE_2026-10-17.md, migration
// 20270326). The server is the authority, tested here WITHOUT the app: an approved attendee calls check_in_to_gathering
// directly (as the app's JWT would) at each edge of the window, and direct writes to checked_in_at are tried too.
//   window = [start - 30 min, end), end = start + duration, else start + 30 min (the client's timeWindowParts rule)
//   A. 31 min before the start                   -> refused, nothing changes
//   B. exactly 30 min before the start           -> checked in
//   C. during (10 min in, 60 min long)           -> checked in; a second call changes nothing (idempotent)
//   D. exactly at the end (60 min in, 60 min)    -> refused
//   E. 3 days after                              -> refused
//   F. 1-hour gathering, 90 min after start      -> refused (the old 3 h "Happening now" rule would have offered it)
//   G. without a length, 29 min in -> open; H. 30 min in -> refused (end = start + 30 min)
//   I. a pending requester                       -> 'NOT_ATTENDING'
//   J. a join row inserted already checked in    -> refused; K. moving an existing check-in -> refused
// After the refusals: the "checked in" count and "plans this month" hold only the real check-ins, and no business offer or perk
// redemption changed (a check-in is never a redemption). The client helpers are applied to the same rows. Rolled back.
// Not covered: rendering on a phone (the attending section's button and countdown), a real signed-in API call.
const { runSql } = require('../../scripts/live-verify/lib/db');
const { runJourney, stepMap, hasToken } = require('./journeyHarness');
import { checkInWindowState, isGatheringOver } from '../utils/gatheringCompletion';
import { getCountdownLabel } from '../utils/gatheringAttending';

const d = hasToken ? describe : describe.skip;

// [key, start (SQL, relative to the transaction's now()), duration minutes or null]
const CASES = [
  ['a', "now() + interval '31 minutes'", 60],
  ['b', "now() + interval '30 minutes'", 60],
  ['c', "now() - interval '10 minutes'", 60],
  ['d', "now() - interval '60 minutes'", 60],
  ['e', "now() - interval '3 days'", 60],
  ['f', "now() - interval '90 minutes'", 60],
  ['g', "now() - interval '29 minutes'", null],
  ['h', "now() - interval '30 minutes'", null],
];

d('journey: check in only inside the window, enforced by the server', () => {
  let s;
  beforeAll(async () => {
    const people = await runSql(`select id from profiles order by created_at limit 3;`);
    const make = CASES.map(([k]) => `
  insert into gatherings (host_id, title, scheduled_at, precise_lat, precise_lng, interest_tag, area, capacity, visibility)
    values (v_host, 'JCI ${k}', now() + interval '3 days', 40.3, -75.2, 'Coffee', 'journey', 10, 'everyone') returning id into v_id;
  v_ids := v_ids || jsonb_build_object('${k}', v_id);`).join('');
    const move = CASES.map(([k, off, dur]) => `
  update gatherings set scheduled_at = ${off}, duration_minutes = ${dur ?? 'null'}
    where id = (v_ids->>'${k}')::uuid;`).join('');
    const tryAll = CASES.map(([k]) => `
  begin
    perform check_in_to_gathering((v_ids->>'${k}')::uuid);
    v_res := v_res || jsonb_build_object('${k}', 'ok');
  exception when others then
    v_res := v_res || jsonb_build_object('${k}', sqlerrm);
  end;`).join('');
    const log = await runJourney(`
      v_host uuid := '${people[0].id}'; v_fan uuid := '${people[1].id}'; v_third uuid := '${people[2].id}';
      v_id uuid; v_ids jsonb := '{}'::jsonb; v_res jsonb := '{}'::jsonb; v_p uuid; v_first timestamptz; v_err text;
      v_offers_before jsonb; v_perks_before jsonb;`, `
  v_offers_before := (select coalesce(jsonb_agg(jsonb_build_array(id, status, completed_at) order by id), '[]') from business_request_offers);
  v_perks_before := (select coalesce(jsonb_agg(jsonb_build_array(id, confirmed_at) order by id), '[]') from offer_redemptions);
  perform set_config('request.jwt.claims', json_build_object('sub', v_host, 'role', 'authenticated')::text, true);
  ${make}
  insert into gatherings (host_id, title, scheduled_at, precise_lat, precise_lng, interest_tag, area, capacity, visibility, requires_approval)
    values (v_host, 'JCI i', now() + interval '3 days', 40.3, -75.2, 'Coffee', 'journey', 10, 'everyone', true) returning id into v_p;
  update gatherings set wide_area = '40.3,-75.2', is_public = true where host_id = v_host and title like 'JCI %';

  perform set_config('request.jwt.claims', json_build_object('sub', v_fan, 'role', 'authenticated')::text, true);
  ${CASES.map(([k]) => `perform join_gathering((v_ids->>'${k}')::uuid);`).join(' ')}
  perform join_gathering(v_p);

  -- the clock, not an actor: each gathering moves to its edge of the window
  perform set_config('request.jwt.claims', '{}', true);
  ${move}
  update gatherings set scheduled_at = now() - interval '10 minutes', duration_minutes = 60 where id = v_p;

  -- the fan calls the RPC directly at every edge (no app involved)
  perform set_config('request.jwt.claims', json_build_object('sub', v_fan, 'role', 'authenticated')::text, true);
  ${tryAll}
  begin
    perform check_in_to_gathering(v_p);
    v_res := v_res || jsonb_build_object('i', 'ok');
  exception when others then
    v_res := v_res || jsonb_build_object('i', sqlerrm);
  end;
  log := log || jsonb_build_array(jsonb_build_object('step','rpc','ok', true, 'data', jsonb_build_object('res', v_res,
    'now', now(),
    'gatherings', (select jsonb_object_agg(substr(g.title, 5), jsonb_build_object('scheduled_at', g.scheduled_at, 'duration_minutes', g.duration_minutes))
                   from gatherings g where g.host_id = v_host and g.title like 'JCI %'),
    'checked', (select jsonb_object_agg(substr(g.title, 5), gi.checked_in_at is not null)
                from gathering_interest gi join gatherings g on g.id = gi.gathering_id where gi.user_id = v_fan and g.title like 'JCI %'))));

  -- idempotent: a second call on C keeps the first time and raises nothing
  v_first := (select checked_in_at from gathering_interest where user_id = v_fan and gathering_id = (v_ids->>'c')::uuid);
  begin
    perform check_in_to_gathering((v_ids->>'c')::uuid);
    v_err := null;
  exception when others then v_err := sqlerrm; end;
  log := log || jsonb_build_array(jsonb_build_object('step','again','ok', true, 'data', jsonb_build_object('err', v_err,
    'same', (select checked_in_at from gathering_interest where user_id = v_fan and gathering_id = (v_ids->>'c')::uuid) = v_first)));

  -- direct writes (any writer, even outside the RPC): a row arriving checked in; a check-in moved
  perform set_config('request.jwt.claims', '{}', true);
  begin
    insert into gathering_interest (gathering_id, user_id, status, checked_in_at) values ((v_ids->>'c')::uuid, v_third, 'approved', now());
    v_err := null;
  exception when others then v_err := sqlerrm; end;
  log := log || jsonb_build_array(jsonb_build_object('step','insert_checked_in','ok', true, 'data', jsonb_build_object('err', v_err)));
  begin
    update gathering_interest set checked_in_at = now() - interval '5 minutes' where user_id = v_fan and gathering_id = (v_ids->>'c')::uuid;
    v_err := null;
  exception when others then v_err := sqlerrm; end;
  log := log || jsonb_build_array(jsonb_build_object('step','move','ok', true, 'data', jsonb_build_object('err', v_err)));
  begin
    update gathering_interest set checked_in_at = now() where user_id = v_fan and gathering_id = (v_ids->>'e')::uuid;
    v_err := null;
  exception when others then v_err := sqlerrm; end;
  log := log || jsonb_build_array(jsonb_build_object('step','direct_late','ok', true, 'data', jsonb_build_object('err', v_err)));

  -- what others see and what counts: "N checked in" per gathering, plans this month, no redemption touched
  perform set_config('request.jwt.claims', json_build_object('sub', v_fan, 'role', 'authenticated')::text, true);
  log := log || jsonb_build_array(jsonb_build_object('step','after','ok', true, 'data', jsonb_build_object(
    'checked_in_counts', (select jsonb_object_agg(substr(g.title, 5), (select count(*) from gathering_interest x where x.gathering_id = g.id and x.checked_in_at is not null))
                          from gatherings g where g.host_id = v_host and g.title like 'JCI %'),
    'plans', (select coalesce(jsonb_agg(m.plan_key), '[]') from public.get_my_plans_this_month(now() - interval '30 days', now() + interval '1 day') m
              where m.plan_key = any (select 'g:' || (v_ids->>k) from jsonb_object_keys(v_ids) k)),
    'offers_same', (select coalesce(jsonb_agg(jsonb_build_array(id, status, completed_at) order by id), '[]') from business_request_offers) = v_offers_before,
    'perks_same', (select coalesce(jsonb_agg(jsonb_build_array(id, confirmed_at) order by id), '[]') from offer_redemptions) = v_perks_before,
    'ids', v_ids)));`);
    s = stepMap(log);
  }, 120000);

  const res = () => s.rpc.data.res;

  test('31 min before the start: refused, nothing changes', () => {
    expect(res().a).toBe('CHECK_IN_CLOSED');
    expect(s.rpc.data.checked.a).toBe(false);
  });
  test('exactly 30 min before the start: checked in', () => {
    expect(res().b).toBe('ok');
    expect(s.rpc.data.checked.b).toBe(true);
  });
  test('during the gathering: checked in; a second call changes nothing', () => {
    expect(res().c).toBe('ok');
    expect(s.again.data).toEqual({ err: null, same: true });
  });
  test('at the end, 3 days after, and 90 min into a 1-hour gathering: refused', () => {
    for (const k of ['d', 'e', 'f']) {
      expect(res()[k]).toBe('CHECK_IN_CLOSED');
      expect(s.rpc.data.checked[k]).toBe(false);
    }
  });
  test('no duration: open 29 min in, closed at 30 min (start + 30 min)', () => {
    expect(res().g).toBe('ok');
    expect(res().h).toBe('CHECK_IN_CLOSED');
  });
  test('a pending requester cannot check in', () => {
    expect(res().i).toBe('NOT_ATTENDING');
  });
  test('direct writes: never arrives checked in, never moved, never outside the window', () => {
    expect(s.insert_checked_in.data.err).toBe('CHECK_IN_CLOSED');
    expect(s.move.data.err).toBe('CHECK_IN_CLOSED');
    expect(s.direct_late.data.err).toBe('CHECK_IN_CLOSED');
  });
  test('refusals leave the visible count and plans this month alone; no redemption changes', () => {
    const counts = s.after.data.checked_in_counts;
    expect(counts).toEqual({ a: 0, b: 1, c: 1, d: 0, e: 0, f: 0, g: 1, h: 0, i: 0 });
    // B, C and G are not over yet, so nothing counts toward this month; the refused, over ones (D/E/F/H) never do
    expect(s.after.data.plans).toEqual([]);
    expect(s.after.data.offers_same).toBe(true);
    expect(s.after.data.perks_same).toBe(true);
  });
  test('the app agrees with the server on the same rows (the button shows exactly where the server accepts)', () => {
    const now = new Date(s.rpc.data.now);
    for (const [k] of CASES) {
      const g = s.rpc.data.gatherings[k];
      const state = checkInWindowState(g, now);
      expect([k, state === 'open']).toEqual([k, res()[k] === 'ok']);
    }
    // F (1-hour gathering at 90 min): over everywhere, never "Happening now"
    expect(isGatheringOver(s.rpc.data.gatherings.f, now)).toBe(true);
    expect(getCountdownLabel(s.rpc.data.gatherings.f, now.getTime())).toBeNull();
  });
});

// Owner idea "307" (2026-10-20): a changed understood chip (Tonight -> Tomorrow, 4 -> 6 people) is recorded on the live database
// the way the app records it: its own snapshot linked to the ORIGINAL ask's snapshot, key 'understood_when' / 'understood_people',
// action 'applied' (no migration: 20270306 already accepts both), the chosen values in the interpretation. Then the corrected
// classification is handed to the real AskBusiness handoff and stored by the real create_business_request, which keeps the
// chosen day's party size (6), never the words' 4. Rolled back; the person is created inside the run (actorsSql).
// The snapshot payloads are the client's shape (proven against the real resolver in services/understoodChipChange.test.js).
// Not covered: the chips themselves on a phone (tap, choices row, screen reader): device only.
jest.mock('../services/supabase', () => ({ supabase: {} }));
jest.mock('../services/intentOutcomes', () => ({ recordIntentSelection: () => {} }));
const { runJourney, stepMap, hasToken, actorsSql, journeyPeople } = require('./journeyHarness');
import { changeUnderstoodPiece } from '../utils/askUnderstood';
import { askBusinessParamsFromAsk } from '../services/askToBusiness';

const d = hasToken ? describe : describe.skip;
const TEXT = 'live music tonight at 7 for 4 people';

d('journey: change an understood chip -> recorded as applied -> the corrected value reaches the request', () => {
  let s; let params;
  beforeAll(async () => {
    const [u] = journeyPeople(1);
    const base = { intent: 'gathering', category: 'Live Music', dateWindow: 'tonight', partySize: 4, attributes: [] };
    const changed = changeUnderstoodPiece(changeUnderstoodPiece(base, 'when', 'tomorrow'), 'people', 6);
    params = askBusinessParamsFromAsk({ classifyResult: changed, typedText: TEXT });
    const snap = (id, extra) => JSON.stringify({ id, surface: 'home', rules_version: 'typed-ask-audit-v3', outcome: 'results', ...extra }).replace(/'/g, "''");
    const log = await runJourney(`
      v_u uuid := '${u.id}'; v_root uuid := gen_random_uuid(); v_when uuid := gen_random_uuid(); v_people uuid := gen_random_uuid(); v_res jsonb; v_req uuid;`, `
  ${actorsSql({ people: ['v_u'] })}
  perform set_config('request.jwt.claims', json_build_object('sub', v_u, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform record_typed_ask_snapshot(replace('${snap('ROOT', { interpretation: { category: 'Live Music', date_window: 'tonight', party_size: 4 } })}', 'ROOT', v_root::text)::jsonb);
  perform record_typed_ask_snapshot(replace(replace('${snap('WHEN', { interpretation: { category: 'Live Music', date_window: 'tomorrow', party_size: 4 }, refinement_key: 'understood_when', refinement_action: 'applied', parent_snapshot_id: 'ROOT' })}', 'WHEN', v_when::text), 'ROOT', v_root::text)::jsonb);
  perform record_typed_ask_snapshot(replace(replace('${snap('PEOPLE', { interpretation: { category: 'Live Music', date_window: 'tomorrow', party_size: 6 }, refinement_key: 'understood_people', refinement_action: 'applied', parent_snapshot_id: 'ROOT' })}', 'PEOPLE', v_people::text), 'ROOT', v_root::text)::jsonb);
  reset role;
  log := log || jsonb_build_array(jsonb_build_object('step', 'recorded', 'ok', true, 'data', (select jsonb_agg(jsonb_build_object('id', id, 'key', refinement_key, 'action', refinement_action,
    'parent', parent_snapshot_id, 'interp', interpretation) order by created_at, refinement_key nulls first) from typed_ask_snapshots where id in (v_root, v_when, v_people))));

  -- the corrected ask handed to AskBusiness (the real handoff above) and sent the way the screen sends it
  perform set_config('request.jwt.claims', json_build_object('sub', v_u, 'role', 'authenticated')::text, true);
  -- the screen turns the carried day (tomorrow) into its date and sends the time field as shown (empty after the day changed)
  v_res := create_business_request(raw_text_param := '${TEXT}', latitude_param := 40.0, longitude_param := -75.0,
    category_param := '${params.prefillCategory}', party_size_param := ${Number(params.prefillPartySize)}, date_param := current_date + 1,
    time_window_start_param := ${params.prefillStartMinutes == null ? 'null' : `'${Math.floor(params.prefillStartMinutes / 60)}:${String(params.prefillStartMinutes % 60).padStart(2, '0')}'::time`}, radius_miles_param := 10);
  v_req := (v_res->>'requestId')::uuid;
  log := log || jsonb_build_array(jsonb_build_object('step', 'request', 'ok', v_req is not null, 'data',
    (select jsonb_build_object('party_size', party_size, 'category', category, 'date', to_char(date, 'YYYY-MM-DD'), 'is_tomorrow', date = current_date + 1, 'time_window_start', time_window_start) from business_requests where id = v_req)));
`);
    s = stepMap(log);
  });

  test('each change is its own snapshot, linked to the original ask, recorded as applied with the chosen value', () => {
    const rows = s.recorded.data;
    expect(rows).toHaveLength(3);
    const byKey = Object.fromEntries(rows.map((r) => [r.key ?? 'root', r]));
    expect(byKey.root.interp).toMatchObject({ date_window: 'tonight', party_size: 4 });
    expect(byKey.understood_when).toMatchObject({ action: 'applied', parent: byKey.root.id });
    expect(byKey.understood_when.interp.date_window).toBe('tomorrow');
    expect(byKey.understood_people).toMatchObject({ action: 'applied', parent: byKey.root.id });
    expect(byKey.understood_people.interp.party_size).toBe(6);
  });

  test('the request stores the corrected party size; the words\' 7 PM is not carried after the day changed', () => {
    expect(params).toMatchObject({ prefillDateWindow: 'tomorrow', prefillPartySize: 6, prefillStartMinutes: null });
    expect(s.request.ok).toBe(true);
    expect(s.request.data).toMatchObject({ party_size: 6, category: 'Live Music', is_tomorrow: true, time_window_start: null });
  });
});

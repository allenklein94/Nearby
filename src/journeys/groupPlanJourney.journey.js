// Journey (item 87 audit): GROUP PLAN. Two connected people each have an open coffee request -> one proposes a shared
// plan -> the other sees the invitation and accepts -> the organizer sets a budget and confirms -> once confirmed,
// nobody can re-decide or change the budget (the lifecycle table says view only; the server, unlike the UI, still lets a person leave) -> a third person is refused throughout.
// Rolled back; the client `canDo` table is asserted against the states the DB produced. Disclosed: no business offer step.
const { runSql } = require('../../scripts/live-verify/lib/db');
const { runJourney, stepMap, hasToken } = require('./journeyHarness');
import { canDo } from '../utils/objectLifecycle';

const d = hasToken ? describe : describe.skip;

d('journey: propose -> invite -> accept -> budget re-asks -> confirm -> locked', () => {
  let s;
  beforeAll(async () => {
    const [f] = await runSql(`select user_a, user_b from friendships where status = 'accepted' limit 1;`);
    const [c] = await runSql(`select id from profiles where id not in ('${f.user_a}','${f.user_b}') limit 1;`);
    const log = await runJourney(`
      v_a uuid := '${f.user_a}'; v_b uuid := '${f.user_b}'; v_c uuid := '${c.id}';
      v_ra uuid; v_rb uuid; v_p uuid; v_res jsonb; v_msg text; v_st text; v_pst text;`, `
  update profiles set intent_visibility = 'friends_and_matches' where id in (v_a, v_b);
  perform set_config('request.jwt.claims', json_build_object('sub', v_a, 'role', 'authenticated')::text, true);
  v_res := create_business_request('journey gp a', 40.0, -75.0, 'Coffee', 1, null, 40, null, null, null, 15, null); v_ra := (v_res->>'requestId')::uuid;
  perform set_config('request.jwt.claims', json_build_object('sub', v_b, 'role', 'authenticated')::text, true);
  v_res := create_business_request('journey gp b', 40.0, -75.0, 'Coffee', 1, null, 40, null, null, null, 15, null); v_rb := (v_res->>'requestId')::uuid;

  -- 1. a proposes, b is invited
  perform set_config('request.jwt.claims', json_build_object('sub', v_a, 'role', 'authenticated')::text, true);
  v_p := propose_group_plan(v_ra, array[v_rb]);
  select status into v_pst from group_plan_participants where proposal_id = v_p and user_id = v_b;
  select status into v_st from group_plan_proposals where id = v_p;
  log := log || jsonb_build_array(jsonb_build_object('step','proposed_and_invited','ok', v_st = 'pending' and v_pst = 'invited',
     'data', jsonb_build_object('proposal', v_st, 'invitee', v_pst)));

  -- 2. a stranger cannot respond
  perform set_config('request.jwt.claims', json_build_object('sub', v_c, 'role', 'authenticated')::text, true);
  begin perform respond_to_group_plan(v_p, true); v_msg := 'NO ERROR'; exception when others then v_msg := sqlerrm; end;
  log := log || jsonb_build_array(jsonb_build_object('step','stranger_refused','ok', v_msg <> 'NO ERROR', 'data', jsonb_build_object('message', v_msg)));

  -- 3. b accepts
  perform set_config('request.jwt.claims', json_build_object('sub', v_b, 'role', 'authenticated')::text, true);
  perform respond_to_group_plan(v_p, true);
  select status into v_pst from group_plan_participants where proposal_id = v_p and user_id = v_b;
  log := log || jsonb_build_array(jsonb_build_object('step','invitee_accepts','ok', v_pst = 'accepted', 'data', jsonb_build_object('participant', v_pst)));

  -- 4. the organizer sets the budget AFTER b accepted: the group must re-agree, so b is asked again (not silently locked in)
  perform set_config('request.jwt.claims', json_build_object('sub', v_a, 'role', 'authenticated')::text, true);
  perform set_group_plan_budget(v_p, 40);
  select status into v_pst from group_plan_participants where proposal_id = v_p and user_id = v_b;
  log := log || jsonb_build_array(jsonb_build_object('step','budget_change_reasks','ok', v_pst = 'invited', 'data', jsonb_build_object('participant', v_pst)));
  perform set_config('request.jwt.claims', json_build_object('sub', v_b, 'role', 'authenticated')::text, true);
  perform respond_to_group_plan(v_p, true);

  -- 5. the organizer confirms
  perform set_config('request.jwt.claims', json_build_object('sub', v_a, 'role', 'authenticated')::text, true);
  perform confirm_group_plan(v_p);
  select status into v_st from group_plan_proposals where id = v_p;
  log := log || jsonb_build_array(jsonb_build_object('step','organizer_confirms','ok', v_st = 'confirmed', 'data', jsonb_build_object('proposal', v_st)));

  -- 6. once confirmed: re-deciding and budget changes are refused. FINDING: the server still lets a participant leave (it
  -- drops their offer confirmations); the UI offers Leave only while pending (lifecycle table), so this is a UI restriction only.
  perform set_config('request.jwt.claims', json_build_object('sub', v_b, 'role', 'authenticated')::text, true);
  begin perform leave_group_plan(v_p); v_msg := 'NO ERROR'; exception when others then v_msg := sqlerrm; end;
  log := log || jsonb_build_array(jsonb_build_object('step','leave_server_allows_after_confirm','ok', v_msg = 'NO ERROR', 'data', jsonb_build_object('message', v_msg)));
  begin perform respond_to_group_plan(v_p, false); v_msg := 'NO ERROR'; exception when others then v_msg := sqlerrm; end;
  log := log || jsonb_build_array(jsonb_build_object('step','respond_refused_after_confirm','ok', v_msg <> 'NO ERROR', 'data', jsonb_build_object('message', v_msg)));
  perform set_config('request.jwt.claims', json_build_object('sub', v_a, 'role', 'authenticated')::text, true);
  begin perform set_group_plan_budget(v_p, 99); v_msg := 'NO ERROR'; exception when others then v_msg := sqlerrm; end;
  log := log || jsonb_build_array(jsonb_build_object('step','budget_locked_after_confirm','ok', v_msg <> 'NO ERROR', 'data', jsonb_build_object('message', v_msg)));
`);
    s = stepMap(log);
  }, 90000);

  test.each([
    'proposed_and_invited', 'stranger_refused', 'invitee_accepts', 'budget_change_reasks', 'organizer_confirms',
    'leave_server_allows_after_confirm', 'respond_refused_after_confirm', 'budget_locked_after_confirm',
  ])('step %s', (n) => {
    expect(s[n]).toBeDefined();
    expect(s[n].ok).toBe(true);
  });

  test('the lifecycle table agrees with what the database allowed at each state', () => {
    const { proposal, invitee } = s.proposed_and_invited.data;
    expect(canDo('group_plan', proposal, 'respond')).toBe(true);
    expect(canDo('group_participant', invitee, 'join')).toBe(true);
    expect(canDo('group_participant', s.invitee_accepts.data.participant, 'join')).toBe(false);
    expect(canDo('group_participant', s.invitee_accepts.data.participant, 'leave')).toBe(true);
    expect(canDo('group_participant', s.budget_change_reasks.data.participant, 'join')).toBe(true); // asked again
    const confirmed = s.organizer_confirms.data.proposal;
    expect(canDo('group_plan', confirmed, 'manage')).toBe(false);
    expect(canDo('group_plan', confirmed, 'respond')).toBe(false);
  });
});

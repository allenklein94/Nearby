// Idea "360" narrow fix (owner, 2026-10-23): the gathering Invite sheet reads each friend's real state from ONE server rule
// (private._gathering_invitee_state via get_gathering_invite_states), and invite_friend_to_gathering re-checks it at send
// time. Every actor runs under the real `authenticated` role + JWT claims (grants, RLS, the visibility trigger).
//   Attendee A (a friend of host H) opens the sheet: H (host) and G (approved) = going; I (A's own pending invite) = invited;
//   X (blocks the host) = ineligible; E = invite; O (invited by H, not by A) = invite (never reveals someone else's invite).
//   Women-only gathering: M (a man) = ineligible, E (a woman) = invite.
//   Send-time: inviting G / I / X / M is refused with hint invite_state:<state>, nothing is written; E succeeds once and a
//   second send (stale sheet or a concurrent tap) is refused as invited, no second invite or event. A friend who joins after
//   the sheet loaded is refused as going. Someone who can't see the gathering gets no rows. anon is refused.
// One rolled-back transaction. Not covered (device only): the sheet itself, the labels' fit, screen reader.
const { runJourney, stepMap, hasToken, actorDeclares, actorsSql } = require('./journeyHarness');

const d = hasToken ? describe : describe.skip;

// One statement as `sub` under the real role; records 'ok' (or a value) or the error text + hint.
function as(step, sub, stmt, value = `'ok'::text`) {
  return `
  perform set_config('request.jwt.claims', json_build_object('sub', ${sub}, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin ${stmt}; v_out := to_jsonb(${value});
  exception when others then
    get stacked diagnostics v_hint = pg_exception_hint;
    v_out := jsonb_build_object('error', sqlerrm, 'hint', v_hint);
  end;
  reset role;
  log := log || jsonb_build_array(jsonb_build_object('step', '${step}', 'ok', true, 'data', v_out));`;
}

const states = (g) =>
  `(select jsonb_object_agg(case friend_id when v_h then 'h' when v_g then 'g' when v_i then 'i' when v_x then 'x'
     when v_e then 'e' when v_o then 'o' when v_m then 'm' when v_late then 'late' end, state) from get_gathering_invite_states(${g}))`;

d('journey: the Invite sheet shows real states; the server re-checks every send (idea "360")', () => {
  let s;
  beforeAll(async () => {
    const log = await runJourney(`
      ${actorDeclares(['v_h', 'v_a', 'v_g', 'v_i', 'v_x', 'v_e', 'v_o', 'v_m', 'v_late', 'v_stranger'])}
      g1 uuid; g2 uuid; v_out jsonb; v_hint text; v_n int; v_inv_before int; v_ev_before int;`, `
  ${actorsSql({
    people: ['v_h', 'v_a', 'v_g', 'v_i', 'v_x', 'v_e', 'v_o', 'v_m', 'v_late', 'v_stranger'],
    friends: [['v_a', 'v_h'], ['v_a', 'v_g'], ['v_a', 'v_i'], ['v_a', 'v_x'], ['v_a', 'v_e'], ['v_a', 'v_o'], ['v_a', 'v_m'],
      ['v_a', 'v_late'], ['v_h', 'v_o']],
  })}
  update profiles set gender = 'Woman' where id in (v_h, v_a, v_e, v_g);
  update profiles set gender = 'Man' where id = v_m;
  perform set_config('request.jwt.claims', json_build_object('sub', v_h, 'role', 'authenticated')::text, true);
  insert into gatherings (host_id, title, scheduled_at, precise_lat, precise_lng, interest_tag, area, capacity, visibility, is_public)
    values (v_h, 'JIS coffee', now() + interval '2 days', 1.5, -150.5, 'Coffee', 'journey', 10, 'everyone', true) returning id into g1;
  insert into gatherings (host_id, title, scheduled_at, precise_lat, precise_lng, interest_tag, area, capacity, visibility, is_public, women_only)
    values (v_h, 'JIS women only', now() + interval '2 days', 1.5, -150.5, 'Coffee', 'journey', 10, 'everyone', true, true) returning id into g2;
  insert into gathering_interest (gathering_id, user_id, status) values (g1, v_a, 'approved'), (g1, v_g, 'approved'),
    (g2, v_a, 'approved');
  insert into social_invites (inviter_id, invitee_id, invite_type, target_id) values (v_a, v_i, 'gathering', g1);
  insert into social_invites (inviter_id, invitee_id, invite_type, target_id) values (v_h, v_o, 'gathering', g1);
  insert into blocks (blocker_id, blocked_id) values (v_x, v_h);

  ${as('states_g1', 'v_a', 'v_n := 0', states('g1'))}
  ${as('states_g2', 'v_a', 'v_n := 0', states('g2'))}

  select count(*) into v_inv_before from social_invites where target_id in (g1, g2);
  select count(*) into v_ev_before from domain_events where type = 'INVITATION_SENT';
  ${as('send_going', 'v_a', 'perform invite_friend_to_gathering(g1, v_g)')}
  ${as('send_host', 'v_a', 'perform invite_friend_to_gathering(g1, v_h)')}
  ${as('send_invited', 'v_a', 'perform invite_friend_to_gathering(g1, v_i)')}
  ${as('send_host_blocked', 'v_a', 'perform invite_friend_to_gathering(g1, v_x)')}
  ${as('send_women_only', 'v_a', 'perform invite_friend_to_gathering(g2, v_m)')}
  log := log || jsonb_build_array(jsonb_build_object('step', 'refusals_wrote_nothing', 'ok', true, 'data', jsonb_build_object(
    'invites', (select count(*) from social_invites where target_id in (g1, g2)) - v_inv_before,
    'events', (select count(*) from domain_events where type = 'INVITATION_SENT') - v_ev_before)));

  ${as('send_eligible', 'v_a', 'perform invite_friend_to_gathering(g1, v_e)')}
  ${as('send_eligible_again', 'v_a', 'perform invite_friend_to_gathering(g1, v_e)')}
  ${as('send_eligible_wo', 'v_a', 'perform invite_friend_to_gathering(g2, v_e)')}
  log := log || jsonb_build_array(jsonb_build_object('step', 'eligible_once', 'ok', true, 'data', jsonb_build_object(
    'invites', (select count(*) from social_invites where inviter_id = v_a and invitee_id = v_e and target_id = g1),
    'events', (select count(*) from domain_events e join social_invites i on i.id = e.object_id
               where e.type = 'INVITATION_SENT' and i.inviter_id = v_a and i.invitee_id = v_e and i.target_id = g1))));
  ${as('states_after', 'v_a', 'v_n := 0', states('g1'))}

  -- stale: the sheet loaded with "late" as Invite, then they joined; the send is refused as going
  ${as('late_before', 'v_a', 'v_n := 0', states('g1') + "->>'late'")}
  insert into gathering_interest (gathering_id, user_id, status) values (g1, v_late, 'approved');
  ${as('send_late', 'v_a', 'perform invite_friend_to_gathering(g1, v_late)')}

  -- a person who can't see a friends-only gathering gets no rows
  update gatherings set visibility = 'friends', is_public = false where id = g1;
  ${as('stranger_states', 'v_stranger', 'select count(*) into v_n from get_gathering_invite_states(g1)', 'v_n')}

  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  set local role anon;
  begin perform get_gathering_invite_states(g1); v_out := '"ok"';
  exception when others then v_out := to_jsonb(sqlerrm); end;
  reset role;
  log := log || jsonb_build_array(jsonb_build_object('step', 'anon', 'ok', true, 'data', v_out));
  set local role authenticated;
  begin perform private._gathering_invitee_state(g1, v_a, v_e); v_out := '"ok"';
  exception when others then v_out := to_jsonb(sqlerrm); end;
  reset role;
  log := log || jsonb_build_array(jsonb_build_object('step', 'private_rule_not_callable', 'ok', true, 'data', v_out));`);
    s = stepMap(log);
  }, 60000);

  test('the sheet reads going / invited / ineligible / invite; someone else\'s invite stays private', () => {
    expect(s.states_g1.data).toEqual({ h: 'going', g: 'going', i: 'invited', x: 'ineligible', e: 'invite', o: 'invite', m: 'invite', late: 'invite' });
  });

  test('women-only: a friend who cannot join is ineligible, an eligible one can be invited', () => {
    expect(s.states_g2.data.m).toBe('ineligible');
    expect(s.states_g2.data.e).toBe('invite');
  });

  test('the server refuses already going / already invited / ineligible with the state hint and writes nothing', () => {
    expect(s.send_going.data).toEqual({ error: 'Already going', hint: 'invite_state:going' });
    expect(s.send_host.data).toEqual({ error: 'Already going', hint: 'invite_state:going' });
    expect(s.send_invited.data).toEqual({ error: 'Already invited', hint: 'invite_state:invited' });
    expect(s.send_host_blocked.data).toEqual({ error: 'This person cannot be invited to this gathering', hint: 'invite_state:ineligible' });
    expect(s.send_women_only.data).toEqual({ error: 'This gathering is women-only', hint: 'invite_state:ineligible' });
    expect(s.refusals_wrote_nothing.data).toEqual({ invites: 0, events: 0 });
  });

  test('an eligible friend is invited once; a second send is refused, never a second success', () => {
    expect(s.send_eligible.data).toBe('ok');
    expect(s.send_eligible_again.data).toEqual({ error: 'Already invited', hint: 'invite_state:invited' });
    expect(s.send_eligible_wo.data).toBe('ok');
    expect(s.eligible_once.data).toEqual({ invites: 1, events: 1 });
    expect(s.states_after.data.e).toBe('invited');
  });

  test('stale eligibility: a friend who joined after the sheet loaded is refused as going', () => {
    expect(s.late_before.data).toBe('invite');
    expect(s.send_late.data).toEqual({ error: 'Already going', hint: 'invite_state:going' });
  });

  test('no rows for someone who cannot see the gathering; anon and the private rule are refused', () => {
    expect(s.stranger_states.data).toBe(0);
    expect(String(s.anon.data)).toMatch(/permission denied/);
    expect(String(s.private_rule_not_callable.data)).toMatch(/permission denied/);
  });
});

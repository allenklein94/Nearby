// Gathering creation limits by trust level (migration 20270362, owner 2026-10-30; staged after 20270361, run with
// 0348-0362 as JOURNEY_PRELUDE_FILE until live). New account = 5 gatherings per 24 h, established (verified phone + 7 days)
// = 15; every visibility counts, editing never counts, cancelling / deleting never gives one back, a server-generated
// recurring occurrence never counts, joining is untouched, and reaching the limit never restricts the account.
// Every step runs as an ordinary signed-in person under the real client role, in ONE rolled-back transaction.
// Not covered: the app's alert on a phone (Jest covers the hint -> sentence mapping in recoverableError.test.js).
const { runJourney, stepMap, hasToken, actorDeclares, actorsSql } = require('./journeyHarness');

const d = hasToken ? describe : describe.skip;

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
  perform set_config('request.jwt.claims', '', true);
  log := log || jsonb_build_array(jsonb_build_object('step', '${step}', 'ok', true, 'data', v_out));`;
}
const rec = (step, value) => `log := log || jsonb_build_array(jsonb_build_object('step', '${step}', 'ok', true, 'data', to_jsonb(${value})));`;
const gathering = (v, title, visibility = 'everyone') =>
  `insert into gatherings (host_id, title, scheduled_at, precise_lat, precise_lng, interest_tag, area, visibility, is_public)
   values (${v}, '${title}', now() + interval '2 days', 10.02, -10.03, 'Pickleball', 'j', '${visibility}', ${visibility === 'everyone'})`;

d('journey: gathering creation limits (20270362)', () => {
  let s;
  beforeAll(async () => {
    s = stepMap(await runJourney(`
      ${actorDeclares(['v_new', 'v_est', 'v_guest', 'v_nophone'])}
      v_out jsonb; v_hint text; v_g uuid; i int;`, `
  ${actorsSql({ people: ['v_new', 'v_est', 'v_guest', 'v_nophone'], friends: [['v_new', 'v_guest']] })}
  perform set_config('app.trusted_update', 'false', true);
  -- v_new: account 1-4 days old = new; v_est: verified phone + 10 days = established; v_nophone: 30 days, no phone = new
  update auth.users set created_at = now() - interval '10 days' where id = v_est;
  update auth.users set created_at = now() - interval '30 days', phone = null, phone_confirmed_at = null where id = v_nophone;
  ${rec('levels', `jsonb_build_object('new', private.trust_level(v_new), 'est', private.trust_level(v_est), 'nophone', private.trust_level(v_nophone))`)}
  ${rec('rules', `(select jsonb_object_agg(trust_level, max_count) from private.rate_limit_rules where action = 'gathering_create' and window_seconds = 86400)`)}
  ${rec('old_trigger_gone', `not exists (select 1 from pg_trigger where tgname = 'on_gathering_created_enforce_limit' and tgrelid = 'public.gatherings'::regclass)`)}

  -- new account: 5 of any visibility, the 6th refused
  ${as('new_1_public', 'v_new', gathering('v_new', 'N1'))}
  ${as('new_2_friends', 'v_new', gathering('v_new', 'N2', 'friends'))}
  ${as('new_3_invite_only', 'v_new', gathering('v_new', 'N3', 'invite_only'))}
  ${as('new_4_public', 'v_new', gathering('v_new', 'N4'))}
  ${as('new_5_public', 'v_new', gathering('v_new', 'N5'))}
  ${as('new_6_refused', 'v_new', gathering('v_new', 'N6'))}
  -- editing an existing gathering still works and never counts
  ${as('new_edit', 'v_new', `update gatherings set title = 'N1 edited', description = 'more detail' where host_id = v_new and title = 'N1'`)}
  ${rec('new_logged', `(select count(*) from private.limited_action_log where user_id = v_new and field = 'gathering')`)}
  -- cancelling and deleting never give the allowance back
  select id into v_g from gatherings where host_id = v_new and title = 'N4';
  ${as('new_cancel', 'v_new', `perform cancel_gathering(v_g)`)}
  ${as('new_after_cancel', 'v_new', gathering('v_new', 'N7'))}
  ${as('new_delete', 'v_new', `delete from gatherings where host_id = v_new and title = 'N5'`)}
  ${as('new_after_delete', 'v_new', gathering('v_new', 'N8'))}
  -- a server-generated recurring occurrence (no signed-in person, like generate_next_recurring_gathering's cron) never counts
  ${gathering('v_new', 'Weekly occurrence')};
  ${rec('generated_ok', `exists (select 1 from gatherings where host_id = v_new and title = 'Weekly occurrence')`)}
  ${rec('generated_logged', `(select count(*) from private.limited_action_log where user_id = v_new and field = 'gathering')`)}
  -- reaching the limit never restricts: the person can still join someone else's gathering, and is not suspended
  ${as('guest_hosts', 'v_guest', gathering('v_guest', 'Guest picnic'))}
  select id into v_g from gatherings where host_id = v_guest and title = 'Guest picnic';
  ${as('new_joins', 'v_new', `perform join_gathering(v_g)`)}
  ${rec('new_level_after', `private.trust_level(v_new)`)}

  -- established account: 15, the 16th refused
  for i in 1..15 loop
    perform set_config('request.jwt.claims', json_build_object('sub', v_est, 'role', 'authenticated')::text, true);
    set local role authenticated;
    begin ${gathering('v_est', "E' || i || '")};
    exception when others then
      reset role;
      log := log || jsonb_build_array(jsonb_build_object('step', 'est_failed_at_' || i, 'ok', true, 'data', to_jsonb(sqlerrm)));
    end;
    reset role;
  end loop;
  perform set_config('request.jwt.claims', '', true);
  ${rec('est_created', `(select count(*) from gatherings where host_id = v_est)`)}
  ${as('est_16_refused', 'v_est', gathering('v_est', 'E16'))}

  -- age without a phone is never established (and 20270352 refuses an unverified person anyway)
  ${as('nophone_create', 'v_nophone', gathering('v_nophone', 'X1'))}
`));
  }, 180000);

  const data = (k) => s[k].data;
  const refusedAsLimit = (v) => {
    expect(v.hint).toBe('gathering_limit');
    expect(v.error).toBe("You've reached the limit for creating gatherings for now. Please try again later.");
  };

  test('trust levels and approved numbers (5 new / 15 established); the old flat 10 trigger is gone', () => {
    expect(data('levels')).toEqual({ new: 'new', est: 'established', nophone: 'new' });
    expect(data('rules')).toEqual({ new: 5, established: 15 });
    expect(data('old_trigger_gone')).toBe(true);
  });

  test('a new account creates 5 gatherings of any visibility, the 6th is refused with the gathering hint', () => {
    for (const k of ['new_1_public', 'new_2_friends', 'new_3_invite_only', 'new_4_public', 'new_5_public']) expect([k, data(k)]).toEqual([k, 'ok']);
    refusedAsLimit(data('new_6_refused'));
  });

  test('editing still works and is not counted', () => {
    expect(data('new_edit')).toBe('ok');
    expect(data('new_logged')).toBe(5);
  });

  test('cancelling or deleting a gathering does not give the allowance back', () => {
    expect(data('new_cancel')).toBe('ok');
    refusedAsLimit(data('new_after_cancel'));
    expect(data('new_delete')).toBe('ok');
    refusedAsLimit(data('new_after_delete'));
  });

  test('a server-generated recurring occurrence is created and not counted', () => {
    expect(data('generated_ok')).toBe(true);
    expect(data('generated_logged')).toBe(5);
  });

  test('reaching the limit never restricts the account: joining still works', () => {
    expect(data('guest_hosts')).toBe('ok');
    expect(data('new_joins')).toBe('ok');
    expect(data('new_level_after')).toBe('new');
  });

  test('an established account creates 15, the 16th is refused', () => {
    expect(Object.keys(s).filter((k) => k.startsWith('est_failed_at_'))).toEqual([]);
    expect(data('est_created')).toBe(15);
    refusedAsLimit(data('est_16_refused'));
  });

  test('an old account without a verified phone is not established and cannot create (20270352)', () => {
    expect(data('nophone_create').hint).toBe('phone_required');
  });
});

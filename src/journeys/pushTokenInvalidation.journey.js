// Journey (owner, 2026-11-15; migration 20270421): a push token Expo reports dead (DeviceNotRegistered) is cleared, so the
// owner's next business alerts go to the email fallback, and the alert that failed is handed back ONCE for an email.
//   * an accepted send is recorded (token as a hash only; a business alert keeps its own words, a personal push none);
//   * a receipt is asked for only after 15 minutes; ok / any other error settle with nothing cleared;
//   * DeviceNotRegistered clears the token only while it is still the failed one (a re-registered token is kept),
//     returns the alert's words once (a second settle of the same ticket returns nothing: no duplicate email);
//   * no receipt yet = kept and asked again; after 24 hours dropped; the job drops never-settled rows after 2 days;
//   * at once (the send itself refused): wrong token = nothing cleared, the current token = cleared;
//   * nothing new is reachable by a client.
// One rolled-back transaction; the job's network call is skipped (dry-run switch). Not covered: send-push's own run and a
// real Expo receipt (Jest runs the real handler: sendPushDeadToken.test.js; a real device in the post-deploy plan).
const { runJourney, stepMap, hasToken, actorDeclares, actorsSql } = require('./journeyHarness');

const d = hasToken ? describe : describe.skip;
const rec = (step, value) => `log := log || jsonb_build_array(jsonb_build_object('step', '${step}', 'ok', true, 'data', to_jsonb(${value})));`;
const tok = (v) => `(select expo_push_token from private.push_tokens where user_id = ${v})`;
const age = (id, iv) => `update private.push_receipt_checks set created_at = now() - interval '${iv}' where ticket_id = '${id}';`;
const settle = (id, outcome) => `public._settle_push_receipt('${id}', '${outcome}')`;
const ALERT = `jsonb_build_object('type', 'business_opportunity_received', 'request_id', '11111111-2222-4333-8444-555555555555')`;

d('journey: dead push tokens are cleared and the failed business alert is emailed once (20270421)', () => {
  let s;
  beforeAll(async () => {
    const log = await runJourney(`${actorDeclares(['v_owner', 'v_person'])}
      v_out jsonb; v_old text; v_err text;`, `
  perform set_config('app.push_receipt_dispatch_dry_run', 'on', true);
  ${actorsSql({ people: ['v_owner', 'v_person'] })}
  v_old := ${tok('v_owner')};

  -- recorded: a business alert with its words, a personal push without
  perform public._record_push_ticket('j421-alert', v_owner, v_old, 'New request', 'Coffee for 2 today', ${ALERT});
  perform public._record_push_ticket('j421-social', v_person, ${tok('v_person')}, null, null, jsonb_build_object('type', 'message'));
  perform public._record_push_ticket('j421-alert', v_owner, v_old, 'again', 'again', ${ALERT}); -- same ticket twice = one row
  ${rec('recorded', `(select jsonb_build_object('rows', count(*), 'hash_only', bool_and(token_sha256 ~ '^[0-9a-f]{64}$'),
      'alert_words', max(email_title) filter (where ticket_id = 'j421-alert'),
      'social_words', count(*) filter (where ticket_id = 'j421-social' and email_title is null and email_data is null))
      from private.push_receipt_checks where ticket_id like 'j421-%')`)}
  ${rec('fresh_not_due', `(select count(*) from public._push_receipts_due(1000) where ticket_id like 'j421-%')`)}
  ${age('j421-alert', '20 minutes')} ${age('j421-social', '20 minutes')}
  ${rec('due_after_15_min', `(select array_agg(ticket_id order by ticket_id) from public._push_receipts_due(1000) where ticket_id like 'j421-%')`)}
  ${rec('dispatch_when_due', `public.dispatch_push_receipt_checks()`)}

  -- ok: settled, token kept
  ${rec('ok_settle', settle('j421-social', 'ok'))}
  ${rec('ok_token_kept', `${tok('v_person')} is not null and not exists (select 1 from private.push_receipt_checks where ticket_id = 'j421-social')`)}

  -- dead device: token cleared, the alert handed back once
  ${rec('dead_settle', settle('j421-alert', 'device_not_registered'))}
  ${rec('dead_token_cleared', `(select count(*) from private.push_tokens where user_id = v_owner)`)}
  ${rec('dead_settle_again', `coalesce(${settle('j421-alert', 'device_not_registered')}, 'null'::jsonb)`)}

  -- reinstalled: a new token registered after the failed send is never removed (the alert is still handed back)
  update profiles set expo_push_token = 'ExponentPushToken[j421-new]' where id = v_owner;
  perform public._record_push_ticket('j421-old', v_owner, v_old, 'Booked', 'A customer booked', ${ALERT});
  ${age('j421-old', '20 minutes')}
  ${rec('reinstalled_settle', settle('j421-old', 'device_not_registered'))}
  ${rec('reinstalled_token_kept', tok('v_owner'))}

  -- other errors and missing receipts
  perform public._record_push_ticket('j421-rate', v_owner, 'ExponentPushToken[j421-new]', null, null, null);
  ${age('j421-rate', '20 minutes')}
  ${rec('other_error', `coalesce(${settle('j421-rate', 'other_error')}, 'null'::jsonb)`)}
  ${rec('other_error_token_kept', tok('v_owner'))}
  perform public._record_push_ticket('j421-wait', v_owner, 'ExponentPushToken[j421-new]', null, null, null);
  ${age('j421-wait', '20 minutes')}
  perform ${settle('j421-wait', 'pending')};
  ${rec('pending_kept', `(select count(*) from private.push_receipt_checks where ticket_id = 'j421-wait')`)}
  ${age('j421-wait', '25 hours')}
  perform ${settle('j421-wait', 'pending')};
  ${rec('pending_dropped_after_24h', `(select count(*) from private.push_receipt_checks where ticket_id = 'j421-wait')`)}
  begin perform ${settle('j421-x', 'whatever')}; v_err := 'allowed';
  exception when others then get stacked diagnostics v_err = pg_exception_hint; end;
  ${rec('unknown_outcome', 'v_err')}
  perform public._record_push_ticket('j421-stale', v_owner, 'ExponentPushToken[j421-new]', null, null, null);
  ${age('j421-stale', '3 days')}
  perform public.dispatch_push_receipt_checks();
  ${rec('job_drops_unsettled_after_2_days', `(select count(*) from private.push_receipt_checks where ticket_id = 'j421-stale')`)}

  -- at once: only the current token is cleared
  ${rec('now_wrong_token', `public._invalidate_push_token(v_owner, 'ExponentPushToken[someone-else]')`)}
  ${rec('now_wrong_token_kept', tok('v_owner'))}
  ${rec('now_current_token', `public._invalidate_push_token(v_owner, 'ExponentPushToken[j421-new]')`)}
  ${rec('now_cleared', `(select count(*) from private.push_tokens where user_id = v_owner)`)}

  -- nothing new for clients
  ${rec('client_grants', `(select jsonb_object_agg(f, jsonb_build_object('anon', has_function_privilege('anon', f, 'execute'),
       'authenticated', has_function_privilege('authenticated', f, 'execute'), 'service_role', has_function_privilege('service_role', f, 'execute')))
     from unnest(array['public._record_push_ticket(text,uuid,text,text,text,jsonb)', 'public._invalidate_push_token(uuid,text)',
       'public._push_receipts_due(integer)', 'public._settle_push_receipt(text,text)', 'public.dispatch_push_receipt_checks()']) f)`)}
  ${rec('table_client_access', `has_table_privilege('authenticated', 'private.push_receipt_checks', 'select')
       or has_table_privilege('anon', 'private.push_receipt_checks', 'select')`)}
  ${rec('cron', `(select jsonb_build_object('installed', to_regclass('cron.job') is not null,
       'schedule', (select schedule from cron.job where jobname = 'check-push-receipts')))`)}
`);
    s = stepMap(log);
  }, 120000);

  test('an accepted send is recorded once, the token as a hash, words only for a business alert', () => {
    expect(s.recorded.data).toEqual({ rows: 2, hash_only: true, alert_words: 'New request', social_words: 1 });
  });
  test('a receipt is asked for only after 15 minutes; the job runs only when something is due', () => {
    expect(s.fresh_not_due.data).toBe(0);
    expect(s.due_after_15_min.data).toEqual(['j421-alert', 'j421-social']);
    expect(s.dispatch_when_due.data).toBe(true);
  });
  test('ok settles with nothing cleared', () => {
    expect(s.ok_settle.data).toBeNull();
    expect(s.ok_token_kept.data).toBe(true);
  });
  test('DeviceNotRegistered clears the token and hands the alert back once (no duplicate email)', () => {
    expect(s.dead_settle.data).toEqual({ invalidated: true, recipient_id: expect.any(String),
      email: { title: 'New request', body: 'Coffee for 2 today', data: { type: 'business_opportunity_received', request_id: '11111111-2222-4333-8444-555555555555' } } });
    expect(s.dead_token_cleared.data).toBe(0);
    expect(s.dead_settle_again.data).toBeNull();
  });
  test('a token registered after the failed send is never removed', () => {
    expect(s.reinstalled_settle.data).toMatchObject({ invalidated: false, email: { title: 'Booked' } });
    expect(s.reinstalled_token_kept.data).toBe('ExponentPushToken[j421-new]');
  });
  test('other errors never clear a token; no receipt yet = asked again, dropped after 24 h; unknown outcomes refused', () => {
    expect(s.other_error.data).toBeNull();
    expect(s.other_error_token_kept.data).toBe('ExponentPushToken[j421-new]');
    expect(s.pending_kept.data).toBe(1);
    expect(s.pending_dropped_after_24h.data).toBe(0);
    expect(s.unknown_outcome.data).toBe('push_receipt_outcome');
    expect(s.job_drops_unsettled_after_2_days.data).toBe(0);
  });
  test('a send refused at once clears only the token it was sent to', () => {
    expect(s.now_wrong_token.data).toBe(false);
    expect(s.now_wrong_token_kept.data).toBe('ExponentPushToken[j421-new]');
    expect(s.now_current_token.data).toBe(true);
    expect(s.now_cleared.data).toBe(0);
  });
  test('nothing new is reachable by a client; the job is scheduled every 5 minutes', () => {
    for (const g of Object.values(s.client_grants.data)) expect(g).toMatchObject({ anon: false, authenticated: false });
    expect(s.client_grants.data['public._settle_push_receipt(text,text)'].service_role).toBe(true);
    expect(s.table_client_access.data).toBe(false);
    if (s.cron.data.installed) expect(s.cron.data.schedule).toBe('*/5 * * * *');
  });
});

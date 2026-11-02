// Screening outage alerts (migration 20270387; staged, run with 0348-0387 as JOURNEY_PRELUDE_FILE until live).
// Proves: a content verdict is never an outage (only ok / failure kinds arrive, and ok never alerts); a credit failure opens
// ONE outage at once and alerts each admin ONCE, never a non-admin or a suspended admin; repeats stay silent; one reminder
// only after 24 h of continued failures; the first success closes it and alerts once; one timeout or two overloads never
// alert, a third within 10 minutes does; the push carries no content, key, business or user; clients can't call it.
const { runJourney, stepMap, hasToken, actorDeclares, actorsSql } = require('./journeyHarness');

const d = hasToken ? describe : describe.skip;

const pushes = (filter) => `(select coalesce(jsonb_agg(jsonb_build_object('to', case recipient_id when v_a1 then 'a1' when v_a2 then 'a2'
    when v_sus then 'sus' else 'other' end, 'title', title, 'phase', data->>'phase', 'kind', data->>'kind',
    'keys', (select jsonb_agg(k order by k) from jsonb_object_keys(data) k)) order by recipient_id, id), '[]'::jsonb)
  from push_outbox where data->>'type' = 'admin_screening_outage' ${filter})`;

d('journey: screening outage alerts (20270387)', () => {
  let s;
  beforeAll(async () => {
    const log = await runJourney(`${actorDeclares(['v_a1', 'v_a2', 'v_sus', 'v_p'])} v_refused text;`, `
  ${actorsSql({ people: ['v_a1', 'v_a2', 'v_sus', 'v_p'] })}
  -- only this journey's admins are counted; any other admin in the database is ignored by the filters below
  update profiles set is_admin = true where id in (v_a1, v_a2, v_sus);
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'suspended_at') then
    perform set_config('app.trusted_update', 'true', true);
    execute 'update profiles set suspended_at = now() where id = $1' using v_sus;
    perform set_config('app.trusted_update', 'false', true);
  end if;
  delete from private.screening_outages;
  delete from private.screening_service_failures;
  delete from push_outbox where data->>'type' = 'admin_screening_outage';

  -- 1. healthy traffic: nothing recorded, nothing sent
  perform record_screening_service_result('business-content', true);
  perform record_screening_service_result('business-content', true);
  log := log || jsonb_build_array(jsonb_build_object('step', 'healthy', 'ok', true, 'data', jsonb_build_object(
    'failures', (select count(*) from private.screening_service_failures), 'outages', (select count(*) from private.screening_outages),
    'pushes', ${pushes('')})));

  -- 2. out of credit: one outage at once, one alert per (unsuspended) admin
  perform record_screening_service_result('business-content', false, 'credit', 400);
  perform record_screening_service_result('business-content', false, 'credit', 400);
  perform record_screening_service_result('business-content', false, 'credit', 400);
  log := log || jsonb_build_array(jsonb_build_object('step', 'credit', 'ok', true, 'data', jsonb_build_object(
    'open', (select count(*) from private.screening_outages where recovered_at is null),
    'failure_count', (select failure_count from private.screening_outages where recovered_at is null),
    'pushes', ${pushes(`and recipient_id in (v_a1, v_a2, v_sus, v_p)`)},
    'bodies', (select jsonb_agg(distinct body) from push_outbox where data->>'type' = 'admin_screening_outage' and recipient_id in (v_a1, v_a2)))));

  -- 3. still failing after 24 h: exactly one reminder; a further failure the same hour stays silent
  update private.screening_outages set last_alert_at = last_alert_at - interval '25 hours' where recovered_at is null;
  perform record_screening_service_result('business-content', false, 'credit', 400);
  perform record_screening_service_result('business-content', false, 'credit', 400);
  log := log || jsonb_build_array(jsonb_build_object('step', 'reminder', 'ok', true, 'data',
    ${pushes(`and recipient_id in (v_a1, v_a2) and data->>'phase' = 'reminder'`)}));

  -- 4. first success closes it, alerts once; later successes stay silent
  perform record_screening_service_result('business-content', true);
  perform record_screening_service_result('business-content', true);
  log := log || jsonb_build_array(jsonb_build_object('step', 'recovered', 'ok', true, 'data', jsonb_build_object(
    'open', (select count(*) from private.screening_outages where recovered_at is null),
    'closed', (select count(*) from private.screening_outages where recovered_at is not null),
    'pushes', ${pushes(`and recipient_id in (v_a1, v_a2) and data->>'phase' = 'recovered'`)})));

  -- 5. transient: one timeout, then a second failure: no alert; a third within 10 minutes opens a new outage
  perform record_screening_service_result('business-content', false, 'timeout', null);
  perform record_screening_service_result('business-content', false, 'provider_error', 529);
  log := log || jsonb_build_array(jsonb_build_object('step', 'transient_two', 'ok', true, 'data',
    (select count(*) from private.screening_outages where recovered_at is null)));
  perform record_screening_service_result('business-content', false, 'rate_limit', 429);
  log := log || jsonb_build_array(jsonb_build_object('step', 'transient_three', 'ok', true, 'data', jsonb_build_object(
    'open_kind', (select first_kind from private.screening_outages where recovered_at is null),
    'open_pushes', (select count(*) from push_outbox where data->>'type' = 'admin_screening_outage' and recipient_id in (v_a1, v_a2) and data->>'phase' = 'open'))));
  perform record_screening_service_result('business-content', true);

  -- 6. old transient failures don't count: two failures 11 minutes ago + one now = no outage
  update private.screening_service_failures set occurred_at = occurred_at - interval '11 minutes';
  perform record_screening_service_result('business-content', false, 'timeout', null);
  log := log || jsonb_build_array(jsonb_build_object('step', 'window', 'ok', true, 'data',
    (select count(*) from private.screening_outages where recovered_at is null)));

  -- 7. junk input is normalized, never stored as given
  perform record_screening_service_result('Robert''); drop table x;--', false, 'something else', 9999);
  log := log || jsonb_build_array(jsonb_build_object('step', 'normalized', 'ok', true, 'data',
    (select jsonb_build_object('kind', kind, 'status', http_status, 'source', source) from private.screening_service_failures order by id desc limit 1)));

  -- 8. no client can report or read
  perform set_config('request.jwt.claims', json_build_object('sub', v_p, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform record_screening_service_result('business-content', false, 'credit', 400);
    v_refused := 'allowed';
  exception when insufficient_privilege then v_refused := 'refused';
  end;
  reset role;
  log := log || jsonb_build_array(jsonb_build_object('step', 'client', 'ok', true, 'data', jsonb_build_object(
    'authenticated', v_refused,
    'anon_exec', has_function_privilege('anon', 'public.record_screening_service_result(text, boolean, text, integer)', 'execute'),
    'auth_exec', has_function_privilege('authenticated', 'public.record_screening_service_result(text, boolean, text, integer)', 'execute'),
    'auth_read_failures', has_table_privilege('authenticated', 'private.screening_service_failures', 'select'),
    'auth_read_outages', has_table_privilege('authenticated', 'private.screening_outages', 'select'))));`);
    s = stepMap(log);
  }, 120000);

  test('healthy traffic records nothing and sends nothing', () => {
    expect(s.healthy.data).toEqual({ failures: 0, outages: 0, pushes: [] });
  });

  test('a credit failure opens one outage at once and alerts each unsuspended admin exactly once; never a non-admin', () => {
    expect(s.credit.data.open).toBe(1);
    expect(s.credit.data.failure_count).toBe(3);
    const to = s.credit.data.pushes.map((p) => p.to).sort();
    expect(to).toEqual(['a1', 'a2']); // the suspended admin and the ordinary person get nothing
    for (const p of s.credit.data.pushes) {
      expect(p).toMatchObject({ title: 'Offer screening is unavailable', phase: 'open', kind: 'credit' });
      expect(p.keys).toEqual(['kind', 'phase', 'type']); // no content, business, user, request or key
    }
    expect(s.credit.data.bodies).toEqual(["The screening provider reports no remaining credit. Businesses can't send offers until it's fixed."]);
  });

  test('after 24 h of continued failures: one reminder per admin, no more that hour', () => {
    expect(s.reminder.data.map((p) => p.to).sort()).toEqual(['a1', 'a2']);
    expect(s.reminder.data[0].title).toBe('Offer screening is still unavailable');
  });

  test('the first success closes it and alerts once', () => {
    expect(s.recovered.data.open).toBe(0);
    expect(s.recovered.data.closed).toBe(1);
    expect(s.recovered.data.pushes.map((p) => p.to).sort()).toEqual(['a1', 'a2']);
    expect(s.recovered.data.pushes[0].title).toBe('Offer screening is working again');
  });

  test('transient failures alert only on the third within 10 minutes', () => {
    expect(s.transient_two.data).toBe(0);
    expect(s.transient_three.data.open_kind).toBe('rate_limit');
    expect(s.transient_three.data.open_pushes).toBe(4); // two outages so far x two admins
    expect(s.window.data).toBe(0);
  });

  test('unknown input is normalized', () => {
    expect(s.normalized.data).toEqual({ kind: 'provider_error', status: null, source: 'unknown' });
  });

  test('clients can neither report nor read', () => {
    expect(s.client.data).toEqual({ authenticated: 'refused', anon_exec: false, auth_exec: false,
      auth_read_failures: false, auth_read_outages: false });
  });
});

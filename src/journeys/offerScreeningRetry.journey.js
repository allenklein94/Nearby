// Journey (owner, 2026-11-15; migration 20270420): offer screening retries itself after a TEMPORARY failure, on the same
// saved submission, about 30 s / 2 min / 5 min later; a permanent failure is not retried; after three automatic tries
// Try again is back; nothing is sent twice; a dismissed submission or a closed request stops the retries.
// The clock can't move inside one transaction, so "the time has come" is set on the row (next_retry_at / updated_at in
// the past). One rolled-back transaction; pushes stay in the outbox (hand-off test switch), the job's network call is
// skipped (dry-run switch). Not covered (needs a deployed function + a real outage): the edge function's own run, the
// once-a-minute cron firing, the Anthropic call; those are in the post-deploy plan.
jest.mock('../services/supabase', () => ({ supabase: {} }));
const { runJourney, stepMap, hasToken, actorDeclares, actorsSql } = require('./journeyHarness');

const d = hasToken ? describe : describe.skip;
const as = (sub) => `perform set_config('request.jwt.claims', json_build_object('sub', ${sub}, 'role', 'authenticated')::text, true);`;
const ask = (v, text) => `v_res := create_business_request(raw_text_param := '${text}', latitude_param := 40.0, longitude_param := -75.0,
     category_param := 'Coffee', party_size_param := 2, date_param := current_date + 1, radius_miles_param := 10, target_partner_id_param := v_partner);
  ${v} := (v_res->>'requestId')::uuid;`;
const submit = (v, req) => `insert into business_offer_submissions (partner_id, request_id, submitted_by, status, payload)
    values (v_partner, ${req}, v_owner, 'reviewing', jsonb_build_object('requestId', ${req}, 'offerDescription', 'J420 test offer')) returning id into ${v};`;
const row = (v) => `(select jsonb_build_object('status', status, 'auto_retries', auto_retries, 'attempts', attempts,
    'pending', next_retry_at is not null, 'last_failure', last_failure, 'reason', reason, 'offer_id_set', offer_id is not null)
    from business_offer_submissions where id = ${v})`;
const ownerView = (v) => `(select jsonb_build_object('status', x.status, 'retryable', x.retryable) from get_my_offer_submissions(v_partner) x where x.id = ${v})`;
const due = (v) => `update business_offer_submissions set next_retry_at = now() - interval '1 second' where id = ${v};`;
const claimed = (v) => `(select count(*) from claim_due_offer_screening_retries(50) c where c.submission_id = ${v})`;
const delay = (ts) => `round(extract(epoch from (${ts} - now())))`;
const log = (step, data) => `log := log || jsonb_build_array(jsonb_build_object('step', '${step}', 'ok', true, 'data', ${data}));`;
const args = (req) => `jsonb_build_object('request_id_param', ${req}, 'offer_type_param', 'standard', 'offer_description_param', 'J420 test offer', 'offer_price_param', 12)`;

// 0372 (when present): an automatic try re-screens before it publishes (screen-business-content records a low-risk result
// for the submitter); this stands in for that result. A no-op before 0372 (the stand-in returns at once).
const screened = (req) => `perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  perform pg_temp._journey_screened('offer_response', 'screening_content_offer_response', array[${req}::text, 'J420 test offer', null, '{}', null, null, null, null, null]);
  perform set_config('request.jwt.claims', '', true);`;

// The stand-in itself (the same body the combined branch's journeyHarness defines; defining it here too keeps this journey
// runnable on this branch, whose harness has no 0372 stand-ins). Before 0372 it returns at once.
const STAND_IN = `execute $sd$
create or replace function pg_temp._journey_screened(p_target text, p_builder text, p_args text[]) returns void
language plpgsql security definer set search_path = public as $f$
declare p_content jsonb;
begin
  if to_regprocedure('private.require_business_screening(uuid,text,uuid,jsonb)') is null then return; end if;
  execute format('select private.%I(%s)', p_builder,
    (select string_agg(case when a is null then 'null' else quote_literal(a) end, ', ' order by o)
       from unnest(p_args) with ordinality u(a, o))) into p_content;
  insert into business_content_screening_results (partner_id, target_type, target_id, submitted_by, content_snapshot,
                                                  risk_tier, model_reasoning, source)
  select p.managed_partner_id, p_target, null, auth.uid(), p_content, 'low', 'journey stand-in for screen-business-content', 'submission'
    from profiles p where p.id = auth.uid() and p.managed_partner_id is not null;
end $f$;
$sd$;`;

d('journey: offer screening retries temporary failures by itself (20270420)', () => {
  let s;
  beforeAll(async () => {
    const rows = await runJourney(`${actorDeclares(['v_owner', 'v_cust', 'v_cust2', 'v_partner', 'v_other'])}
      v_res jsonb; v_r1 uuid; v_r2 uuid; v_r3 uuid; v_r4 uuid; v_r5 uuid; v_r6 uuid; v_r7 uuid;
      v_s1 uuid; v_s2 uuid; v_s3 uuid; v_s4 uuid; v_s5 uuid; v_s6 uuid; v_s7 uuid;
      v_t timestamptz; v_n int; v_delays jsonb := '[]'; v_claims jsonb := '[]'; v_err text; v_pub jsonb; i int;`, `
  perform set_config('app.push_handoff_test_failure', 'on', true);
  perform set_config('app.offer_retry_dispatch_dry_run', 'on', true);
  ${STAND_IN}
  ${actorsSql({ people: ['v_owner', 'v_cust', 'v_cust2', 'v_other'], business: { owner: 'v_owner', partner: 'v_partner' } })}
  ${as('v_cust')}
  ${ask('v_r1', 'J420 coffee one')} ${ask('v_r2', 'J420 coffee two')} ${ask('v_r3', 'J420 coffee three')} ${ask('v_r4', 'J420 coffee four')}
  ${as('v_cust2')}
  ${ask('v_r5', 'J420 coffee five')} ${ask('v_r6', 'J420 coffee six')} ${ask('v_r7', 'J420 coffee seven')}
  perform set_config('request.jwt.claims', '', true);
  ${submit('v_s1', 'v_r1')} ${submit('v_s2', 'v_r2')} ${submit('v_s3', 'v_r3')} ${submit('v_s4', 'v_r4')}
  ${submit('v_s5', 'v_r5')} ${submit('v_s6', 'v_r6')} ${submit('v_s7', 'v_r7')}

  -- A. a temporary failure, then the automatic try succeeds
  v_t := _record_offer_screening_unavailable(v_s1, 'transient');
  ${as('v_owner')}
  ${log('a_failed', `jsonb_build_object('delay_s', ${delay('v_t')}, 'row', ${row('v_s1')}, 'owner_sees', ${ownerView('v_s1')})`)}
  perform set_config('request.jwt.claims', '', true);
  ${log('a_not_yet_due', `jsonb_build_object('claimed', ${claimed('v_s1')})`)}
  ${due('v_s1')}
  v_n := ${claimed('v_s1')};
  ${log('a_claimed', `jsonb_build_object('claimed', v_n, 'row', ${row('v_s1')})`)}
  ${due('v_s1')}
  ${log('a_claimed_again', `jsonb_build_object('claimed', ${claimed('v_s1')})`)}
  ${screened('v_r1')}
  v_pub := _submit_business_offer_for_submission(v_s1, ${args('v_r1')}, null);
  ${log('a_published', `jsonb_build_object('offer_id_returned', v_pub ? 'offerId', 'row', ${row('v_s1')},
     'offer_status', (select status from business_request_offers where request_id = v_r1 and partner_id = v_partner))`)}
  begin
    ${screened('v_r1')}
  perform _submit_business_offer_for_submission(v_s1, ${args('v_r1')}, null); v_err := 'allowed';
  exception when others then get stacked diagnostics v_err = pg_exception_hint; end;
  ${log('a_second_publish', `jsonb_build_object('result', v_err,
     'result_pushes', (select count(*) from push_outbox where data->>'submission_id' = v_s1::text),
     'reply_pushes', (select count(*) from push_outbox where recipient_id = v_cust and data->>'type' = 'business_offer_received' and data->>'request_id' = v_r1::text))`)}

  -- B. three temporary failures in a row: 30 s, 2 min, 5 min, then Try again only
  for i in 1..3 loop
    v_t := _record_offer_screening_unavailable(v_s2, 'transient');
    v_delays := v_delays || to_jsonb(${delay('v_t')});
    ${due('v_s2')}
    v_claims := v_claims || to_jsonb(${claimed('v_s2')});
  end loop;
  v_t := _record_offer_screening_unavailable(v_s2, 'transient');
  ${as('v_owner')}
  ${log('b_exhausted', `jsonb_build_object('delays', v_delays, 'claims', v_claims, 'next_after_third', v_t, 'row', ${row('v_s2')}, 'owner_sees', ${ownerView('v_s2')})`)}
  perform set_config('request.jwt.claims', '', true);
  update business_offer_submissions set next_retry_at = null where id = v_s2;
  ${log('b_not_claimed', `jsonb_build_object('claimed', ${claimed('v_s2')})`)}

  -- C. a permanent failure (billing, key, bad request): never retried
  v_t := _record_offer_screening_unavailable(v_s3, 'permanent');
  ${as('v_owner')}
  ${log('c_permanent', `jsonb_build_object('next', v_t, 'row', ${row('v_s3')}, 'owner_sees', ${ownerView('v_s3')})`)}

  -- D. the business dismisses it while an automatic try is pending
  perform set_config('request.jwt.claims', '', true);
  perform _record_offer_screening_unavailable(v_s4, 'transient');
  ${as('v_owner')}
  perform dismiss_offer_submission(v_s4);
  perform set_config('request.jwt.claims', '', true);
  ${log('d_dismissed_row', row('v_s4'))}
  ${due('v_s4')}
  ${log('d_not_claimed', `jsonb_build_object('claimed', ${claimed('v_s4')})`)}

  -- E. the request closes while a try is pending: never screened again, marked not sent
  perform _record_offer_screening_unavailable(v_s5, 'transient');
  update business_requests set status = 'cancelled' where id = v_r5;
  ${due('v_s5')}
  v_n := ${claimed('v_s5')};
  ${log('e_closed', `jsonb_build_object('claimed', v_n, 'row', ${row('v_s5')})`)}
  update business_requests set status = 'cancelled' where id = v_r7;
  ${log('e_record_after_close', `jsonb_build_object('next', _record_offer_screening_unavailable(v_s7, 'transient'))`)}

  -- F. a run that died (still 'reviewing' after 3 minutes) is picked up while tries are left, never after
  update business_offer_submissions set updated_at = now() - interval '4 minutes' where id = v_s6;
  v_n := ${claimed('v_s6')};
  ${log('f_stalled', `jsonb_build_object('claimed', v_n, 'row', ${row('v_s6')})`)}
  update business_offer_submissions set updated_at = now() - interval '4 minutes', auto_retries = 3 where id = v_s6;
  ${log('f_stalled_no_tries_left', `jsonb_build_object('claimed', ${claimed('v_s6')})`)}

  -- G. the wrapper's own guards
  update business_offer_submissions set status = 'reviewing', updated_at = now() where id = v_s6;
  begin
    ${screened('v_r1')}
  perform _submit_business_offer_for_submission(v_s6, ${args('v_r1')}, null); v_err := 'allowed';
  exception when others then get stacked diagnostics v_err = pg_exception_hint; end;
  ${log('g_other_request', `jsonb_build_object('result', v_err)`)}
  update business_offer_submissions set submitted_by = v_other where id = v_s6;  -- someone who manages no business
  begin
    ${screened('v_r6')}
  perform _submit_business_offer_for_submission(v_s6, ${args('v_r6')}, null); v_err := 'allowed';
  exception when others then v_err := 'refused'; end;
  ${log('g_no_longer_manager', `jsonb_build_object('result', v_err, 'offer_status', (select status from business_request_offers where request_id = v_r6 and partner_id = v_partner))`)}
  update business_offer_submissions set submitted_by = v_owner where id = v_s6;

  -- H. the job, and who may call what
  update business_offer_submissions set status = 'unavailable', next_retry_at = now() - interval '1 second', auto_retries = 0 where id = v_s6;
  v_n := dispatch_offer_screening_retries();
  ${log('h_dispatch', `jsonb_build_object('handed_off_at_least', v_n >= 1, 'row', ${row('v_s6')})`)}
  ${log('h_grants', `(select jsonb_object_agg(f, jsonb_build_object('authenticated', has_function_privilege('authenticated', f, 'execute'), 'anon', has_function_privilege('anon', f, 'execute')))
     from unnest(array['public._record_offer_screening_unavailable(uuid,text)', 'public.claim_due_offer_screening_retries(integer)',
                       'public._submit_business_offer_for_submission(uuid,jsonb,uuid)', 'public.dispatch_offer_screening_retries()']) f)`)}
  ${log('h_cron', `jsonb_build_object('scheduled', exists (select 1 from cron.job where jobname = 'retry-offer-screening' and schedule = '* * * * *'))`)}`);
    s = stepMap(rows);
  }, 90000);

  test('a temporary failure is retried about 30 s later, and the owner sees it as still being checked', () => {
    expect(s.a_failed.data.delay_s).toBe(30);
    expect(s.a_failed.data.row).toMatchObject({ status: 'unavailable', pending: true, last_failure: 'transient', auto_retries: 0 });
    expect(s.a_failed.data.owner_sees).toEqual({ status: 'reviewing', retryable: false });
    expect(s.a_not_yet_due.data.claimed).toBe(0);
  });

  test('the job claims the same saved submission once (a second claim gets nothing)', () => {
    expect(s.a_claimed.data.claimed).toBe(1);
    expect(s.a_claimed.data.row).toMatchObject({ status: 'reviewing', auto_retries: 1, attempts: 2, pending: false });
    expect(s.a_claimed_again.data.claimed).toBe(0);
  });

  test('a cleared retry sends the offer and marks it published together; a second send is refused, one push each', () => {
    expect(s.a_published.data.offer_id_returned).toBe(true);
    expect(s.a_published.data.row).toMatchObject({ status: 'published', offer_id_set: true });
    expect(s.a_published.data.offer_status).toBe('offered');
    expect(s.a_second_publish.data.result).toBe('submission_not_reviewing');
    expect(s.a_second_publish.data.result_pushes).toBe(1);
    expect(s.a_second_publish.data.reply_pushes).toBeLessThanOrEqual(1);
  });

  test('three temporary failures: 30 s, 2 min, 5 min, then Try again only', () => {
    expect(s.b_exhausted.data.delays).toEqual([30, 120, 300]);
    expect(s.b_exhausted.data.claims).toEqual([1, 1, 1]);
    expect(s.b_exhausted.data.next_after_third).toBeNull();
    expect(s.b_exhausted.data.row).toMatchObject({ status: 'unavailable', pending: false, auto_retries: 3 });
    expect(s.b_exhausted.data.owner_sees).toEqual({ status: 'unavailable', retryable: true });
    expect(s.b_not_claimed.data.claimed).toBe(0);
  });

  test('a permanent failure is never retried and offers Try again at once', () => {
    expect(s.c_permanent.data.next).toBeNull();
    expect(s.c_permanent.data.row).toMatchObject({ status: 'unavailable', pending: false, last_failure: 'permanent' });
    expect(s.c_permanent.data.owner_sees).toEqual({ status: 'unavailable', retryable: true });
  });

  test('dismissing cancels a pending try', () => {
    expect(s.d_dismissed_row.data.pending).toBe(false);
    expect(s.d_not_claimed.data.claimed).toBe(0);
  });

  test('a request that closed is never screened again: the submission reads not sent', () => {
    expect(s.e_closed.data.claimed).toBe(0);
    expect(s.e_closed.data.row).toMatchObject({ status: 'not_sent', pending: false, reason: 'This request is no longer open.' });
    expect(s.e_record_after_close.data.next).toBeNull();
  });

  test('a run that died is picked up while tries are left, never after', () => {
    expect(s.f_stalled.data.claimed).toBe(1);
    expect(s.f_stalled.data.row).toMatchObject({ status: 'reviewing', auto_retries: 1 });
    expect(s.f_stalled_no_tries_left.data.claimed).toBe(0);
  });

  test('the wrapper sends only for its own request and only for a submitter who manages the business', () => {
    expect(s.g_other_request.data.result).toBe('submission_request_mismatch');
    expect(s.g_no_longer_manager.data.result).toBe('refused');
    expect(s.g_no_longer_manager.data.offer_status).toBe('pending');
  });

  test('the once-a-minute job hands due rows off; no client can call any of it', () => {
    expect(s.h_dispatch.data.handed_off_at_least).toBe(true);
    expect(s.h_dispatch.data.row).toMatchObject({ status: 'reviewing', auto_retries: 1 });
    Object.values(s.h_grants.data).forEach((g) => expect(g).toEqual({ authenticated: false, anon: false }));
    expect(s.h_cron.data.scheduled).toBe(true);
  });
});

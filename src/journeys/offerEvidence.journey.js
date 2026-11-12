// Offer evidence outlives a deletion while under report, investigation or legal hold + admin offer history (owner idea 39,
// 2026-11-12; migration 20270416). Customers report under the real `authenticated` role; deletions run as the server, the way
// delete-account (customer) or a service-role delete (business) remove rows. One rolled-back transaction.
//   1. A customer deletes their account: an offer under an UNRESOLVED report is kept (business side only); an unreported
//      offer, an offer whose report was resolved, and a routed request the business never answered are not; a resolved
//      report under a legal hold keeps its offer. The account itself is deleted as before.
//   2. Also kept: an offer of a business that is itself reported, of a business whose manager has an open review case, of a
//      business whose manager's account is on legal hold. A business deleted by the server keeps its reported offer + name.
//   3. Retention follows what kept it: nothing purged while it exists; purged once the report is gone, the hold released,
//      the case gone (a closed case still existing keeps it).
//   4. Access: no client reads the evidence or runs its functions; the history function refuses non-admins and anon; an admin
//      sees live + kept offers, no customer field.
//   5. A failing evidence write never blocks the deletion: logged (offer id + error code only).
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
const note = (step, value) => `
  log := log || jsonb_build_array(jsonb_build_object('step', '${step}', 'ok', true, 'data', ${value}));`;
const partner = (p, owner, n) => `
  insert into brand_partners (id, name, active, latitude, longitude, address, category, subcategory, categories, max_group_size)
    values (${p}, 'Evidence Cafe ${n}', true, 40.0, -75.0, '${n} Journey St', 'food_drink', 'Coffee', '{}', 40);
  update profiles set managed_partner_id = ${p} where id = ${owner};`;
// A request by ${who} answered by ${p} with an offer (status offered), or left pending.
const offer = (req, off, who, p, { pending = false } = {}) => `
  insert into business_requests (requester_id, raw_text, latitude, longitude, expires_at, party_size, category, date)
    values (${who}, 'journey offer evidence', 40.0, -75.0, now() + interval '1 day', 2, 'Coffee', current_date) returning id into ${req};
  insert into business_request_offers (request_id, partner_id, status, offer_description, offer_title, responded_at)
    values (${req}, ${p}, '${pending ? 'pending' : 'offered'}', ${pending ? 'null' : `'Two coffees for the price of one'`},
            ${pending ? 'null' : `'Coffee for two'`}, ${pending ? 'null' : 'now()'}) returning id into ${off};`;
const reportOffer = (step, who, off, into) => as(step, who,
  `insert into reports (reporter_id, reason, content_type, content_id) values (${who}, 'spam_scam', 'business_offer', ${off}) returning id into ${into}`);
const kept = (off) => `(select count(*) from private.offer_evidence where offer_id = ${off})`;
const del = (v) => `delete from profiles where id = ${v}; delete from auth.users where id = ${v};`;
const HOLD = `'Preservation request from counsel, matter 2026-17'`;

d('journey: offer evidence under report / investigation / hold + admin offer history (20270416)', () => {
  let s;
  beforeAll(async () => {
    const log = await runJourney(`
      ${actorDeclares(['v_o', 'v_o2', 'v_o3', 'v_o4', 'v_o5', 'v_c', 'v_c2', 'v_x', 'v_admin', 'v_p', 'v_p2', 'v_p3', 'v_p4', 'v_p5'])}
      r1 uuid; r2 uuid; r3 uuid; r4 uuid; r5 uuid; r6 uuid; r7 uuid; r8 uuid; r9 uuid; r10 uuid;
      o1 uuid; o2 uuid; o3 uuid; o4 uuid; o5 uuid; o6 uuid; o7 uuid; o8 uuid; o9 uuid; o10 uuid;
      rep1 uuid; rep3 uuid; rep4 uuid; repb uuid; rep9 uuid; v_case uuid := gen_random_uuid(); v_hold uuid; v_hold4 uuid;
      v_out jsonb; v_hint text;`, `
  ${actorsSql({ people: ['v_o', 'v_o2', 'v_o3', 'v_o4', 'v_o5', 'v_c', 'v_c2', 'v_x', 'v_admin'], business: { owner: 'v_o', partner: 'v_p' } })}
  update profiles set is_admin = true where id = v_admin;
  ${partner('v_p2', 'v_o2', 2)} ${partner('v_p3', 'v_o3', 3)} ${partner('v_p4', 'v_o4', 4)} ${partner('v_p5', 'v_o5', 5)}
  delete from reports; delete from private.account_review_cases;

  -- ===== 1. a customer deletes their account =====
  ${offer('r1', 'o1', 'v_c', 'v_p')} ${offer('r2', 'o2', 'v_c', 'v_p')} ${offer('r3', 'o3', 'v_c', 'v_p')}
  ${offer('r4', 'o4', 'v_c', 'v_p')} ${offer('r5', 'o5', 'v_c', 'v_p', { pending: true })}
  insert into business_content_screening_results (partner_id, target_type, target_id, submitted_by, content_snapshot, risk_tier,
                                                  model_reasoning, source, consumed_at)
    values (v_p, 'offer_response', r1, v_o, '{}'::jsonb, 'low', 'journey', 'submission', now());
  ${reportOffer('rep1', 'v_c', 'o1', 'rep1')} ${reportOffer('rep3', 'v_c', 'o3', 'rep3')} ${reportOffer('rep4', 'v_c', 'o4', 'rep4')}
  update reports set resolved = true where id in (rep3, rep4);
  insert into private.legal_holds (target_type, target_id, reason, reference, placed_by, scope)
    values ('report', rep4, ${HOLD}, 'LR-1', v_admin, 'item');
  ${del('v_c')}
  ${note('c_deleted', `jsonb_build_object('profile', (select count(*) from profiles where id = v_c), 'offers', (select count(*) from business_request_offers where id in (o1, o2, o3, o4, o5)))`)}
  ${note('c_kept', `jsonb_build_object('unresolved', ${kept('o1')}, 'unreported', ${kept('o2')}, 'resolved', ${kept('o3')}, 'resolved_held', ${kept('o4')}, 'pending', ${kept('o5')})`)}
  ${note('o1_row', `(select jsonb_build_object('partner', partner_id = v_p, 'name', partner_name, 'request', request_id = r1,
      'title', offer_title, 'description', offer_description, 'status', status, 'responded', responded_at is not null,
      'screening', screening_risk_tier, 'reports', kept_for_reports = array[rep1], 'cases', kept_for_cases, 'holds', kept_for_holds)
     from private.offer_evidence where offer_id = o1)`)}
  ${note('no_customer_columns', `(select coalesce(jsonb_agg(column_name), '[]') from information_schema.columns
     where table_schema = 'private' and table_name = 'offer_evidence'
       and column_name ~ '(requester|raw_text|party|latitude|longitude|note|payment|reporter|phone|email)')`)}
  ${note('report_survives', `(select count(*) from reports where id = rep1)`)}

  -- ===== 2. business reported / open case on a manager / hold on a manager; then a business deleted =====
  ${offer('r10', 'o10', 'v_x', 'v_p')}
  ${offer('r6', 'o6', 'v_c2', 'v_p2')} ${offer('r7', 'o7', 'v_c2', 'v_p3')} ${offer('r8', 'o8', 'v_c2', 'v_p4')}
  ${as('repb', 'v_x', `insert into reports (reporter_id, reason, content_type, content_id) values (v_x, 'spam_scam', 'business', v_p2) returning id into repb`)}
  insert into private.account_review_cases (id, signal, reason, status, subject_user) values (v_case, 'behavior', 'behavior_pattern', 'open', v_o3);
  insert into private.legal_holds (target_type, target_id, reason, reference, placed_by, scope)
    values ('account', v_o4, ${HOLD}, 'LR-2', v_admin, 'item') returning id into v_hold;
  ${del('v_c2')}
  ${note('c2_kept', `jsonb_build_object(
    'business_report', (select kept_for_reports = array[repb] from private.offer_evidence where offer_id = o6),
    'open_case', (select kept_for_cases = array[v_case] from private.offer_evidence where offer_id = o7),
    'manager_hold', (select kept_for_holds = array[v_hold] from private.offer_evidence where offer_id = o8))`)}
  ${offer('r9', 'o9', 'v_x', 'v_p5')}
  ${reportOffer('rep9', 'v_x', 'o9', 'rep9')}
  delete from brand_partners where id = v_p5;
  ${note('business_deleted', `jsonb_build_object('business', (select count(*) from brand_partners where id = v_p5),
     'kept', (select jsonb_build_object('name', partner_name, 'partner', partner_id = v_p5) from private.offer_evidence where offer_id = o9))`)}

  -- ===== 3. retention follows what kept it =====
  ${note('purge_while_covered', `to_jsonb(private.purge_offer_evidence())`)}
  update reports set resolved = true where id = rep1;
  delete from reports where id = rep1;            -- as purge_expired_reports does after 12 months
  update private.legal_holds set released_at = now(), released_by = v_admin, release_reason = 'Matter closed by counsel' where id = v_hold;
  update private.account_review_cases set status = 'closed', closed_at = now(), outcome = 'no_action' where id = v_case;
  ${note('purge_after', `to_jsonb(private.purge_offer_evidence())`)}
  ${note('after_purge', `jsonb_build_object('report_gone', ${kept('o1')}, 'hold_released', ${kept('o8')}, 'case_closed_still_exists', ${kept('o7')},
     'report_held', ${kept('o4')}, 'business_report', ${kept('o6')})`)}
  delete from private.account_review_cases where id = v_case;
  ${note('case_gone_purged', `to_jsonb(private.purge_offer_evidence())`)}
  ${note('case_gone_kept', kept('o7'))}
  ${note('purge_logged', `(select count(*) from private.offer_evidence_purge_log)`)}

  -- ===== 4. access =====
  ${as('history_non_admin', 'v_o', `perform public.admin_business_offer_history(v_p, 50)`)}
  ${as('history_admin', 'v_admin', `select jsonb_agg(to_jsonb(h) order by h.source) from public.admin_business_offer_history(v_p, 50) h into v_out`, 'v_out')}
  ${as('client_reads_evidence', 'v_admin', `perform count(*) from private.offer_evidence`)}
  ${note('grants', `jsonb_build_object(
    'auth_select', has_table_privilege('authenticated', 'private.offer_evidence', 'select'),
    'service_select', has_table_privilege('service_role', 'private.offer_evidence', 'select'),
    'auth_reasons', has_function_privilege('authenticated', 'private.offer_evidence_reasons(uuid,uuid)', 'execute'),
    'auth_purge', has_function_privilege('authenticated', 'private.purge_offer_evidence()', 'execute'),
    'auth_history', has_function_privilege('authenticated', 'public.admin_business_offer_history(uuid,integer)', 'execute'),
    'anon_history', has_function_privilege('anon', 'public.admin_business_offer_history(uuid,integer)', 'execute'))`)}

  -- ===== 5. a failing evidence write never blocks the deletion (logged, no content) =====
  create or replace function private.offer_evidence_reasons(p_offer uuid, p_partner uuid, out report_ids uuid[], out case_ids uuid[], out hold_ids uuid[])
    language plpgsql as $f$ begin raise exception 'simulated failure' using errcode = 'XX000'; end $f$;
  delete from business_request_offers where id = o9;
  ${note('failure', `jsonb_build_object('offer_deleted', (select count(*) from business_request_offers where id = o9) = 0,
     'logged', (select jsonb_agg(sqlstate) from private.offer_evidence_failures where offer_id = o9))`)}
`);
    s = stepMap(log);
  });

  test('a customer deleting their account keeps only offers under an unresolved or held report, business side only', () => {
    expect(s.c_deleted.data).toEqual({ profile: 0, offers: 0 });
    expect(s.c_kept.data).toEqual({ unresolved: 1, unreported: 0, resolved: 0, resolved_held: 1, pending: 0 });
    expect(s.o1_row.data).toEqual({ partner: true, name: expect.stringMatching(/^Journey Cafe /), request: true,
      title: 'Coffee for two', description: 'Two coffees for the price of one', status: 'offered', responded: true,
      screening: 'low', reports: true, cases: [], holds: [] });
    expect(s.no_customer_columns.data).toEqual([]);
    expect(s.report_survives.data).toBe(1);
  });

  test('a reported business, an open case or a hold on a manager keep its offers; a deleted business keeps its reported offer', () => {
    expect(s.c2_kept.data).toEqual({ business_report: true, open_case: true, manager_hold: true });
    expect(s.business_deleted.data).toEqual({ business: 0, kept: { name: 'Evidence Cafe 5', partner: true } });
  });

  test('retention follows what kept it', () => {
    expect(s.purge_while_covered.data).toBe(0);
    expect(s.after_purge.data).toEqual({ report_gone: 0, hold_released: 0, case_closed_still_exists: 1, report_held: 1, business_report: 1 });
    expect([s.case_gone_purged.data, s.case_gone_kept.data]).toEqual([1, 0]);
    expect(s.purge_logged.data).toBe(3);
  });

  test('only admins see the history (live + kept, no customer field); no client reads the evidence', () => {
    expect(s.history_non_admin.data.hint).toBe('admin_only');
    const rows = s.history_admin.data;
    expect(rows.map((r) => [r.source, r.offer_id])).toEqual(expect.arrayContaining([['kept', expect.any(String)], ['live', expect.any(String)]]));
    expect(rows.find((r) => r.source === 'kept')).toMatchObject({ offer_title: 'Coffee for two', screening: null, reported: true }); // o4: kept under its held report
    expect(Object.keys(rows[0]).sort()).toEqual(['accepted_at', 'cancelled_at', 'completed_at', 'created_at', 'offer_description', 'offer_id',
      'offer_title', 'reported', 'screened_at', 'screening', 'source', 'status', 'viewed_at']);
    expect(s.client_reads_evidence.data.error).toMatch(/permission denied/);
    expect(s.failure.data).toEqual({ offer_deleted: true, logged: ['XX000'] });
    expect(s.grants.data).toEqual({ auth_select: false, service_select: false, auth_reasons: false, auth_purge: false,
      auth_history: true, anon_history: false });
  });
});

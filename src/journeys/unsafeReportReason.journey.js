// "Unsafe activity or situation" + urgent-first admin queue (migration 20270398, staged after 20270397; run with the staged
// migrations as JOURNEY_PRELUDE_FILE until they are live). Every call runs as a real signed-in person (or admin / anon)
// under the real role + JWT claims.
//   1. The reason: 'Unsafe activity or situation' (what the app sends) and 'unsafe_situation' are stored as the code, on a
//      profile, a 1:1 message, a gathering, a community and a business; a translated label is refused; the reporter gets
//      the usual "received" status (20270397).
//   2. Urgent, ONE shared cap: harassment, unsafe and underage together use the same urgent allowance (a 4th urgent report
//      past a cap of 3 is refused whichever reason), and still skip the ordinary cap.
//   3. Queue: review_priority 2 = unsafe / harassment / underage, 1 = impersonation, 0 = the rest; the admin order (priority,
//      then oldest) puts the longest-waiting urgent report first; nobody can change a priority.
//   4. No consequence: the reported person and the host / creator / business owner are never suspended, hidden or notified;
//      nothing is removed.
// One rolled-back transaction. Not covered here: an offer report with this reason (needs offerSafety's screening fixtures;
// the reason rules have no content-type condition), the sheet on a phone.
const { runJourney, stepMap, hasToken, actorDeclares, actorsSql } = require('./journeyHarness');

const d = hasToken ? describe : describe.skip;

function as(step, sub, stmt, role = 'authenticated', value = `'ok'::text`) {
  return `
  perform set_config('request.jwt.claims', json_build_object('sub', ${sub}, 'role', '${role}')::text, true);
  set local role ${role};
  begin ${stmt}; v_out := to_jsonb(${value});
  exception when others then
    get stacked diagnostics v_hint = pg_exception_hint;
    v_out := jsonb_build_object('error', sqlerrm, 'hint', v_hint, 'code', sqlstate);
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  log := log || jsonb_build_array(jsonb_build_object('step', '${step}', 'ok', true, 'data', v_out));`;
}
const rec = (step, value) => `log := log || jsonb_build_array(jsonb_build_object('step', '${step}', 'ok', true, 'data', to_jsonb(${value})));`;
const file = (step, who, cols, vals) => as(step, who, `insert into reports (reporter_id, ${cols}) values (${who}, ${vals}) returning reason into v_reason`, 'authenticated', 'v_reason');

d('journey: "Unsafe activity or situation" is urgent, shares the urgent cap and leads the admin queue (20270398)', () => {
  let s;
  beforeAll(async () => {
    const log = await runJourney(`
      ${actorDeclares(['v_admin', 'v_a', 'v_b', 'v_c', 'v_o', 'v_x'])}
      v_p uuid := gen_random_uuid(); v_g uuid := gen_random_uuid(); v_cm uuid := gen_random_uuid(); v_msg uuid;
      v_out jsonb; v_hint text; v_reason text; v_push_before bigint;`, `
  ${actorsSql({ people: ['v_admin', 'v_a', 'v_b', 'v_c', 'v_o', 'v_x'], business: { owner: 'v_o', partner: 'v_p' } })}
  update profiles set is_admin = true where id = v_admin;
  ${rec('installed', `(select pg_get_constraintdef(oid) like '%unsafe_situation%' from pg_constraint where conname = 'reports_reason_code_check')`)}
  delete from private.rate_limit_rules;
  update private.trust_settings set established_min_account_age = null;
  insert into gatherings (id, host_id, title, description, scheduled_at, precise_lat, precise_lng, interest_tag, area, visibility, is_public)
    values (v_g, v_b, 'Cliff jumping at night', 'Bring nothing', now() + interval '3 days', 26.7123, -80.0321, 'Coffee', 'abc', 'everyone', true);
  insert into communities (id, name, description, creator_id, interest_tag, is_public) values (v_cm, 'Unsafe journey club', 'Community words', v_b, 'Coffee', true);
  insert into matches (user_a, user_b) values (least(v_a, v_b), greatest(v_a, v_b));
  insert into messages (match_id, sender_id, body)
    values ((select id from matches where user_a = least(v_a, v_b) and user_b = greatest(v_a, v_b)), v_b, 'meet me alone at the pier') returning id into v_msg;
  v_push_before := (select count(*) from push_outbox where recipient_id in (v_b, v_o));

  -- ===== 1. the reason, on every kind =====
  ${file('r_profile', 'v_a', 'reported_id, reason', `v_b, 'Unsafe activity or situation'`)}
  ${file('r_profile_code', 'v_c', 'reported_id, reason', `v_b, 'unsafe_situation'`)}
  ${file('r_message', 'v_a', 'reported_id, reason, content_type, content_id', `v_b, 'Unsafe activity or situation', 'message', v_msg`)}
  ${file('r_gathering', 'v_a', 'reason, content_type, content_id', `'Unsafe activity or situation', 'gathering', v_g`)}
  ${file('r_community', 'v_a', 'reason, content_type, content_id', `'Unsafe activity or situation', 'community', v_cm`)}
  ${file('r_business', 'v_a', 'reason, content_type, content_id', `'Unsafe activity or situation', 'business', v_p`)}
  ${file('r_translated', 'v_a', 'reported_id, reason', `v_b, 'Actividad o situación peligrosa'`)}
  ${rec('targets', `(select jsonb_object_agg(coalesce(content_type, 'profile'), jsonb_build_object('reason', reason, 'priority', review_priority, 'reported', reported_id = v_b,
      'captured', content_captured_at is not null)) from reports where reporter_id = v_a)`)}
  ${rec('a_statuses', `(select count(*) from private.report_reporter_status s join reports r on r.id = s.report_id where r.reporter_id = v_a and s.completed_at is null)`)}

  -- ===== 2. one shared urgent cap (3 here), separate from the ordinary cap (1 here) =====
  insert into private.rate_limit_rules (action, trust_level, window_seconds, max_count) values
    ('report', 'new', 86400, 1), ('urgent_report', 'new', 86400, 3);
  ${as('cap_harassment', 'v_x', `insert into reports (reporter_id, reported_id, reason) values (v_x, v_b, 'Harassment or abuse')`)}
  ${as('cap_unsafe', 'v_x', `insert into reports (reporter_id, reported_id, reason) values (v_x, v_b, 'Unsafe activity or situation')`)}
  ${as('cap_underage', 'v_x', `insert into reports (reporter_id, reported_id, reason) values (v_x, v_b, 'Underage user')`)}
  ${as('cap_4th_unsafe', 'v_x', `insert into reports (reporter_id, reason, content_type, content_id) values (v_x, 'Unsafe activity or situation', 'gathering', v_g)`)}
  ${as('cap_4th_harassment', 'v_x', `insert into reports (reporter_id, reported_id, reason) values (v_x, v_b, 'harassment')`)}
  ${as('cap_ordinary', 'v_x', `insert into reports (reporter_id, reported_id, reason) values (v_x, v_b, 'Spam or scam')`)}
  ${as('cap_ordinary_2', 'v_x', `insert into reports (reporter_id, reported_id, reason) values (v_x, v_b, 'Other')`)}
  ${rec('x_reports', `(select count(*) from reports where reporter_id = v_x)`)}
  delete from private.rate_limit_rules;

  -- ===== 3. queue priority + order =====
  ${as('imp', 'v_c', `insert into reports (reporter_id, reported_id, reason, created_at) values (v_c, v_b, 'Impersonation', now() - interval '3 days')`)}
  ${as('spam_old', 'v_c', `insert into reports (reporter_id, reported_id, reason, created_at) values (v_c, v_b, 'Spam or scam', now() - interval '5 days')`)}
  ${rec('priorities', `(select jsonb_object_agg(reason, p) from (select reason, max(review_priority) p from reports where reporter_id in (v_a, v_c, v_x) group by reason) q)`)}
  -- one transaction = one now(): give the queue rows their own times
  update reports set created_at = now() - interval '2 days' where reporter_id = v_x and reason = 'harassment';
  update reports set created_at = now() - interval '1 day' where reporter_id = v_x and reason = 'unsafe_situation';
  update reports set created_at = now() - interval '12 hours' where reporter_id = v_x and reason = 'underage_user';
  ${as('admin_queue', 'v_admin', `select jsonb_agg(reason order by rn) into v_out from (select reason, row_number() over (order by resolved, review_priority desc, created_at asc) rn
        from reports where not resolved and (reporter_id = v_x or (reporter_id = v_c and reason in ('impersonation', 'spam_scam')))) q`, 'authenticated', 'v_out')}
  ${as('admin_sets_priority', 'v_admin', `update reports set review_priority = 0 where reporter_id = v_a`)}
  ${as('reporter_changes_reason', 'v_a', `update reports set reason = 'other' where reporter_id = v_a`)}
  ${rec('still_unsafe', `(select bool_and(reason = 'unsafe_situation' and review_priority = 2) from reports where reporter_id = v_a)`)}

  -- ===== 4. no consequence for anyone =====
  ${rec('nobody_touched', `(select jsonb_agg(jsonb_build_object('suspended', suspended_at is not null, 'hidden', coalesce(profile_hidden, false)) order by id) from profiles where id in (v_b, v_o))`)}
  ${rec('objects_kept', `jsonb_build_object('gathering', exists(select 1 from gatherings where id = v_g), 'community', exists(select 1 from communities where id = v_cm),
      'business', (select active from brand_partners where id = v_p), 'message', exists(select 1 from messages where id = v_msg))`)}
  ${rec('no_push_to_reported', `(select count(*) from push_outbox where recipient_id in (v_b, v_o)) - v_push_before`)}
  ${as('stranger_sees', 'v_x', `select count(*) into v_out from reports where reporter_id = v_a`, 'authenticated', 'v_out')}
  ${as('reported_sees', 'v_b', `select count(*) into v_out from reports where reporter_id = v_a`, 'authenticated', 'v_out')}
`);
    s = stepMap(log);
  });

  const data = (k) => s[k]?.data;
  const refused = (k) => expect([k, data(k)]).toEqual([k, expect.objectContaining({ error: expect.any(String) })]);

  test('installed (prelude with 20270398, or live)', () => {
    expect(data('installed')).toBe(true);
  });

  test('stored as the code on a profile, message, gathering, community and business; a translation is refused; reporter gets "received"', () => {
    for (const k of ['r_profile', 'r_profile_code', 'r_message', 'r_gathering', 'r_community', 'r_business']) expect([k, data(k)]).toEqual([k, 'unsafe_situation']);
    expect(data('r_translated')).toEqual(expect.objectContaining({ hint: 'report_reason_invalid' }));
    const t = data('targets');
    for (const k of ['profile', 'message', 'gathering', 'community', 'business']) expect([k, t[k].reason, t[k].priority]).toEqual([k, 'unsafe_situation', 2]);
    expect(t.message.captured && t.gathering.captured && t.community.captured && t.business.captured).toBe(true);
    expect(t.business.reported).toBe(null); // a business report names nobody (20270381)
    expect(data('a_statuses')).toBe(5);
  });

  test('harassment, unsafe and underage share ONE urgent allowance, and still skip the ordinary cap', () => {
    for (const k of ['cap_harassment', 'cap_unsafe', 'cap_underage', 'cap_ordinary']) expect([k, data(k)]).toEqual([k, 'ok']);
    refused('cap_4th_unsafe');
    refused('cap_4th_harassment');
    refused('cap_ordinary_2');
    expect(data('x_reports')).toBe(4);
  });

  test('queue: urgent safety = 2, impersonation = 1, the rest 0; longest-waiting urgent first; nobody can change it', () => {
    expect(data('priorities')).toEqual({ unsafe_situation: 2, harassment: 2, underage_user: 2, impersonation: 1, spam_scam: 0 });
    // urgent: oldest first (harassment 2 d, unsafe 1 d, underage 12 h) above impersonation (3 d) above spam (5 d, then now)
    expect(data('admin_queue')).toEqual(['harassment', 'unsafe_situation', 'underage_user', 'impersonation', 'spam_scam', 'spam_scam']);
    refused('admin_sets_priority');
    expect(data('still_unsafe')).toBe(true);
  });

  test('an urgent report changes nothing for anyone: no suspension, hiding, removal or push', () => {
    expect(data('nobody_touched')).toEqual([{ suspended: false, hidden: false }, { suspended: false, hidden: false }]);
    expect(data('objects_kept')).toEqual({ gathering: true, community: true, business: true, message: true });
    expect(data('no_push_to_reported')).toBe(0);
    expect(data('stranger_sees')).toBe(0);
    expect(data('reported_sees')).toBe(0);
  });
});

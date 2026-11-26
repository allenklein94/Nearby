// 20270425 (trust stack + 20270424 combined; integration branch): the trust checks ask "is a member of this business",
// never "is acting for it right now". With one account belonging to two locations A and B and acting for A:
//   - it can't report its own location B, nor B's offer (self-report guard);
//   - an admin who belongs to B can't verify B while acting for A (conflict of interest);
//   - B's verification doesn't lapse because its verified manager switched to A, and does lapse once they leave B.
// One rolled-back transaction, real roles.
const { locationAwareSessionSql, runJourney, stepMap, hasToken, actorDeclares, actorsSql } = require('./journeyHarness');

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
const NOTE = 'Checked on 2026-11-16; details match.';
const passed = (method) => ({ method, outcome: 'passed', note: NOTE });
const CHECKS = `'${JSON.stringify({ identity: passed('state_registry'), authority: passed('called_official_number'),
  contact: passed('official_domain_email'), consistency: passed('independent_map_listing') })}'::jsonb`;
const trusted = (sql) => `perform set_config('app.trusted_update', 'true', true); ${sql} perform set_config('app.trusted_update', 'false', true);`;

d('journey: trust checks follow business membership, not the selected location (20270425)', () => {
  let s;
  beforeAll(async () => {
    const people = ['v_owner', 'v_admin', 'v_admin2', 'v_cust'];
    const log = await runJourney(`${actorDeclares(people)} v_a uuid := gen_random_uuid(); v_b uuid := gen_random_uuid();
      v_r uuid; v_o uuid; v_out jsonb; v_hint text; v_rep uuid; v_res jsonb; v_sess uuid;`, `
  ${actorsSql({ people })}
  insert into brand_partners (id, name, active, address, category, categories) values
    (v_a, 'Journey Loc A', true, '1 A St', 'food_drink', '{}'), (v_b, 'Journey Loc B', true, '2 B St', 'food_drink', '{}');
  update profiles set is_admin = true where id in (v_admin, v_admin2);
  -- the owner belongs to A and B (B first, so B's earliest member is the owner); the admin belongs to B too
  ${locationAwareSessionSql('v_owner')}
  ${locationAwareSessionSql('v_admin2')}
  ${trusted(`update profiles set managed_partner_id = v_b where id = v_owner;
    update profiles set managed_partner_id = v_a where id = v_owner;
    update profiles set managed_partner_id = v_b where id = v_admin2;
    update profiles set managed_partner_id = v_a where id = v_admin2;`)}
  ${rec('owner_memberships', `(select count(*) from private.business_memberships where user_id = v_owner)`)}
  ${rec('acting_for_a', `(select managed_partner_id = v_a from profiles where id = v_owner)`)}
  insert into business_requests (requester_id, raw_text, latitude, longitude, expires_at, status, category, party_size, radius_miles)
    values (v_cust, 'journey trust lookups', 40.0, -75.0, now() + interval '1 day', 'open', 'Coffee', 2, 10) returning id into v_r;
  insert into business_request_offers (request_id, partner_id, status, offer_type, offer_description)
    values (v_r, v_b, 'offered', 'standard', 'Journey offer from B') returning id into v_o;

  ${as('report_own_b', 'v_owner', `insert into reports (reporter_id, reason, content_type, content_id) values (v_owner, 'spam_scam', 'business', v_b) returning id into v_rep`, 'v_rep')}
  ${as('report_own_b_offer', 'v_owner', `insert into reports (reporter_id, reason, content_type, content_id) values (v_owner, 'spam_scam', 'business_offer', v_o) returning id into v_rep`, 'v_rep')}
  ${as('customer_reports_b', 'v_cust', `insert into reports (reporter_id, reason, content_type, content_id) values (v_cust, 'spam_scam', 'business', v_b) returning id into v_rep`, 'v_rep')}

  ${as('member_admin_verifies_b', 'v_admin2', `v_res := admin_verify_business(v_b, ${CHECKS}, 'All four checks passed; verified.')`, 'v_res')}
  ${as('other_admin_verifies_b', 'v_admin', `v_res := admin_verify_business(v_b, ${CHECKS}, 'All four checks passed; verified.')`, 'v_res')}
  ${rec('status_after_verify', `(select to_jsonb(x) from private.business_verification_status(v_b) x)`)}
  -- the verified manager (B's earliest member = the owner) is acting for A: no lapse
  ${rec('owner_still_on_a', `(select managed_partner_id = v_a from profiles where id = v_owner)`)}
  ${rec('status_while_on_a', `(select to_jsonb(x) from private.business_verification_status(v_b) x)`)}
  ${as('list_flag', 'v_admin2', `v_res := admin_list_business_verifications()`, 'v_res')}
  delete from private.business_memberships where user_id = v_owner and partner_id = v_b;
  ${rec('status_after_leaving', `(select to_jsonb(x) from private.business_verification_status(v_b) x)`)}`);
    s = stepMap(log);
  }, 120000);

  test('setup: the owner belongs to both and acts for A', () => {
    expect(s.owner_memberships.data).toBe(2);
    expect(s.acting_for_a.data).toBe(true);
  });

  test('an owner can’t report its own other location or that location’s offer; a customer can', () => {
    expect(s.report_own_b.data).toMatchObject({ hint: 'report_content_mismatch' });
    expect(s.report_own_b_offer.data).toMatchObject({ hint: 'report_content_mismatch' });
    expect(typeof s.customer_reports_b.data).toBe('string');
  });

  test('an admin who belongs to B can’t verify B while acting for A; another admin can', () => {
    expect(s.member_admin_verifies_b.data).toMatchObject({ hint: 'verification_conflict_of_interest' });
    expect(s.other_admin_verifies_b.data).toMatchObject({ state: 'verified', badge: true });
  });

  test('admin list: the "you manage" flag and managers follow membership', () => {
    const row = (Array.isArray(s.list_flag.data) ? s.list_flag.data : s.list_flag.data?.businesses ?? [])
      .find((b) => b.name === 'Journey Loc B' || b.partner_name === 'Journey Loc B' || b.business?.name === 'Journey Loc B');
    expect(row).toBeDefined();
    expect(row.you_manage).toBe(true);
    expect(row.managers.length).toBe(2);
  });

  test('switching location never lapses a verification; leaving the business does', () => {
    expect(s.owner_still_on_a.data).toBe(true);
    expect(s.status_while_on_a.data).toMatchObject({ badge: true, lapse: null });
    expect(s.status_after_leaving.data).toMatchObject({ badge: false, lapse: 'manager_changed' });
  });
});

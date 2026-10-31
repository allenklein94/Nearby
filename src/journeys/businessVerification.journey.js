// Verified Business (migration 20270371, staged after 20270370; run with 0348-0371 as JOURNEY_PRELUDE_FILE until they are
// live). Every attempt runs under the real role + JWT claims (grants, RLS, security definer checks), in one rolled-back
// transaction:
//   - an approved business is NOT verified (approval != verification; no backfill);
//   - the business's own owner, an ordinary person and a signed-out caller can't verify, revoke or list, can't touch the
//     record, and can't make themselves an admin first (20270349);
//   - an admin who manages the business can't verify it (conflict of interest);
//   - a checkbox alone is refused: a missing check, missing / unknown / wrong-check method, missing outcome or a short note;
//   - one inconclusive or failed check = 'not_verified' (recorded, no badge); all four passed = 'verified', badge for anyone;
//   - the badge lapses on a rename, an address change, a new manager or deactivation, and comes back only when the verified
//     facts hold again;
//   - revoking needs a reason; the history is append-only for every role, the table owner included; deleting the business
//     removes its history with it;
//   - the public reader returns ids only.
const { runJourney, stepMap, hasToken, actorDeclares, actorsSql } = require('./journeyHarness');

const d = hasToken ? describe : describe.skip;

function as(step, sub, stmt, role = 'authenticated', value = `'ok'::text`) {
  return `
  perform set_config('request.jwt.claims', case when ${sub} is null then json_build_object('role', '${role}')
    else json_build_object('sub', ${sub}, 'role', '${role}') end::text, true);
  set local role ${role};
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
const lit = (o) => `'${JSON.stringify(o).replace(/'/g, "''")}'::jsonb`;

const NOTE = 'Checked on 2026-10-31; details match.';
const passed = (method) => ({ method, outcome: 'passed', note: NOTE });
const ALL_PASSED = {
  identity: passed('state_registry'),
  authority: passed('called_official_number'),
  contact: passed('official_domain_email'),
  consistency: passed('independent_map_listing'),
};
const verify = (step, sub, checks, note = `'All four checks passed; verified.'`, partner = 'v_p') =>
  as(step, sub, `v_res := admin_verify_business(${partner}, ${checks}, ${note})`, 'authenticated', 'v_res');
const badge = (step, sub = 'v_c', role = 'authenticated', partner = 'v_p') =>
  as(step, sub, `v_ids := get_verified_business_ids(array[${partner}, v_p2])`, role, 'v_ids');

d('journey: Verified Business is separate from approval, admin-only, evidence-based, unforgeable and revocable', () => {
  let s;
  beforeAll(async () => {
    const log = await runJourney(`
      ${actorDeclares(['v_admin', 'v_owner', 'v_c', 'v_mgr_admin', 'v_p', 'v_p2', 'v_new_mgr'])}
      v_out jsonb; v_hint text; v_res jsonb; v_ids uuid[];`, `
  ${actorsSql({ people: ['v_admin', 'v_owner', 'v_c', 'v_mgr_admin', 'v_new_mgr'], business: { owner: 'v_owner', partner: 'v_p' } })}
  insert into brand_partners (id, name, active, address) values (v_p2, 'Journey Admin Shop', true, '2 Journey St');
  update profiles set is_admin = true where id in (v_admin, v_mgr_admin);
  update profiles set managed_partner_id = v_p2 where id = v_mgr_admin;
  perform set_config('app.trusted_update', '', true);
  ${rec('installed', `to_regprocedure('public.admin_verify_business(uuid, jsonb, text)') is not null`)}

  -- approved, never verified
  ${badge('approved_not_verified')}
  ${rec('no_events', '(select count(*) from private.business_verification_events)')}

  -- the owner, an ordinary person, signed out
  ${verify('owner_verifies', 'v_owner', lit(ALL_PASSED))}
  ${verify('person_verifies', 'v_c', lit(ALL_PASSED))}
  ${as('anon_verifies', 'null', `v_res := admin_verify_business(v_p, ${lit(ALL_PASSED)}, 'All four checks passed.')`, 'anon', 'v_res')}
  ${as('owner_lists', 'v_owner', `v_res := admin_list_business_verifications()`, 'authenticated', 'v_res')}
  ${as('owner_reads_record', 'v_owner', `v_res := (select to_jsonb(count(*)) from private.business_verification_events)`, 'authenticated', 'v_res')}
  ${as('owner_writes_record', 'v_owner', `insert into private.business_verification_events (partner_id, actor, kind, checks, note, verified_name, verified_manager)
      values (v_p, v_owner, 'verified', '{"x":1}', 'forged entry here', 'x', v_owner)`)}
  ${as('service_writes_record', 'null', `insert into private.business_verification_events (partner_id, kind, checks, note, verified_name, verified_manager)
      values (v_p, 'verified', '{"x":1}', 'forged entry here', 'x', v_owner)`, 'service_role')}
  ${as('owner_self_admin', 'v_owner', `update profiles set is_admin = true where id = v_owner`)}
  ${rec('owner_still_not_admin', '(select is_admin from profiles where id = v_owner)')}
  ${verify('owner_verifies_after_self_admin', 'v_owner', lit(ALL_PASSED))}
  ${as('owner_calls_private_status', 'v_owner', `v_res := to_jsonb(private.business_verification_status(v_p))`, 'authenticated', 'v_res')}

  -- conflict of interest: an admin who manages the business
  ${verify('admin_verifies_own_business', 'v_mgr_admin', lit(ALL_PASSED), `'All four checks passed; verified.'`, 'v_p2')}

  -- a checkbox alone is never enough
  ${verify('missing_check', 'v_admin', lit({ identity: ALL_PASSED.identity, authority: ALL_PASSED.authority, contact: ALL_PASSED.contact }))}
  ${verify('checkbox_only', 'v_admin', lit({ identity: { outcome: 'passed' }, authority: { outcome: 'passed' }, contact: { outcome: 'passed' }, consistency: { outcome: 'passed' } }))}
  ${verify('true_flags', 'v_admin', lit({ identity: true, authority: true, contact: true, consistency: true }))}
  ${verify('unknown_method', 'v_admin', lit({ ...ALL_PASSED, identity: passed('trust_me') }))}
  ${verify('wrong_check_method', 'v_admin', lit({ ...ALL_PASSED, contact: passed('state_registry') }))}
  ${verify('no_outcome', 'v_admin', lit({ ...ALL_PASSED, authority: { method: 'site_visit', note: NOTE } }))}
  ${verify('short_note', 'v_admin', lit({ ...ALL_PASSED, consistency: { method: 'official_website', outcome: 'passed', note: 'ok' } }))}
  ${verify('extra_check', 'v_admin', lit({ ...ALL_PASSED, vibes: passed('site_visit') }))}
  ${verify('no_decision_note', 'v_admin', lit(ALL_PASSED), 'null')}
  ${rec('refusals_recorded_nothing', '(select count(*) from private.business_verification_events)')}

  -- inconclusive = not verified (recorded)
  ${verify('inconclusive', 'v_admin', lit({ ...ALL_PASSED, authority: { method: 'called_official_number', outcome: 'inconclusive', note: 'Nobody answered the number on the website.' } }), `'Not verified until authority is confirmed.'`)}
  ${badge('after_inconclusive')}
  ${as('revoke_unverified', 'v_admin', `v_res := admin_revoke_business_verification(v_p, 'Nothing to revoke here.')`, 'authenticated', 'v_res')}

  -- all four passed
  ${verify('verified', 'v_admin', lit(ALL_PASSED))}
  ${badge('badge_person')}
  ${badge('badge_anon', 'null', 'anon')}
  ${badge('badge_owner', 'v_owner')}
  ${rec('stamped', `(select jsonb_build_object('by_admin', actor = v_admin, 'recent', at > now() - interval '1 minute',
     'name', verified_name = (select name from brand_partners where id = v_p), 'manager', verified_manager = v_owner)
     from private.business_verification_events where partner_id = v_p order by id desc limit 1)`)}

  -- the record can't be changed, by anyone
  ${as('admin_edits_record', 'v_admin', `update private.business_verification_events set kind = 'verified' where partner_id = v_p`)}
  begin update private.business_verification_events set note = 'rewritten history here' where partner_id = v_p; v_out := '"ok"';
  exception when others then get stacked diagnostics v_hint = pg_exception_hint; v_out := jsonb_build_object('error', sqlerrm, 'hint', v_hint); end;
  ${rec('owner_role_edits_record', 'v_out')}
  begin delete from private.business_verification_events where partner_id = v_p; v_out := '"ok"';
  exception when others then get stacked diagnostics v_hint = pg_exception_hint; v_out := jsonb_build_object('error', sqlerrm, 'hint', v_hint); end;
  ${rec('owner_role_deletes_record', 'v_out')}

  -- the badge lapses when the verified facts stop holding (changes made the way server functions make them)
  update brand_partners set name = 'Totally Different Name' where id = v_p;
  ${badge('after_rename')}
  ${as('lapse_rename', 'v_admin', `v_res := (select x -> 'lapse' from jsonb_array_elements(admin_list_business_verifications()) x where (x ->> 'partner_id')::uuid = v_p)`, 'authenticated', 'v_res')}
  update brand_partners set name = (select verified_name from private.business_verification_events where partner_id = v_p order by id desc limit 1) where id = v_p;
  ${badge('after_rename_back')}
  update brand_partners set address = '99 Elsewhere Ave' where id = v_p;
  ${badge('after_address_change')}
  update brand_partners set address = '1 Journey St' where id = v_p;
  perform set_config('app.trusted_update', 'on', true);
  update profiles set managed_partner_id = null where id = v_owner;
  update profiles set managed_partner_id = v_p where id = v_new_mgr;
  perform set_config('app.trusted_update', '', true);
  ${badge('after_manager_change')}
  ${as('lapse_manager', 'v_admin', `v_res := (select x -> 'lapse' from jsonb_array_elements(admin_list_business_verifications()) x where (x ->> 'partner_id')::uuid = v_p)`, 'authenticated', 'v_res')}
  perform set_config('app.trusted_update', 'on', true);
  update profiles set managed_partner_id = null where id = v_new_mgr;
  update profiles set managed_partner_id = v_p where id = v_owner;
  perform set_config('app.trusted_update', '', true);
  update brand_partners set active = false where id = v_p;
  ${badge('after_deactivate')}
  update brand_partners set active = true where id = v_p;
  ${badge('restored')}

  -- revocation
  ${as('owner_revokes', 'v_owner', `v_res := admin_revoke_business_verification(v_p, 'I would rather not be verified.')`, 'authenticated', 'v_res')}
  ${as('revoke_no_reason', 'v_admin', `v_res := admin_revoke_business_verification(v_p, 'short')`, 'authenticated', 'v_res')}
  ${as('revoked', 'v_admin', `v_res := admin_revoke_business_verification(v_p, 'Ownership changed; needs a new review.')`, 'authenticated', 'v_res')}
  ${badge('after_revoke')}
  ${as('revoke_again', 'v_admin', `v_res := admin_revoke_business_verification(v_p, 'Ownership changed; needs a new review.')`, 'authenticated', 'v_res')}
  ${as('history', 'v_admin', `v_res := (select jsonb_agg(h -> 'kind') from jsonb_array_elements(admin_list_business_verifications()) x,
      jsonb_array_elements(x -> 'history') h where (x ->> 'partner_id')::uuid = v_p)`, 'authenticated', 'v_res')}
  ${as('other_admin_verifies_admin_shop', 'v_admin', `v_res := admin_verify_business(v_p2, ${lit(ALL_PASSED)}, 'All four checks passed; verified.')`, 'authenticated', 'v_res')}
  ${badge('both')}

  -- deleting a business takes its history with it (the only delete the record allows)
  delete from brand_partners where id = v_p2;
  ${rec('deleted_business_history', '(select count(*) from private.business_verification_events where partner_id = v_p2)')}

  -- grants: nothing on the record for any client role; the reader for anyone; the admin functions never for anon
  ${rec('grants', `(select jsonb_build_object(
     'record', (select count(*) from information_schema.role_table_grants where table_schema = 'private'
                and table_name = 'business_verification_events' and grantee in ('anon', 'authenticated', 'service_role', 'PUBLIC')),
     'reader_anon', has_function_privilege('anon', 'public.get_verified_business_ids(uuid[])', 'execute'),
     'verify_anon', has_function_privilege('anon', 'public.admin_verify_business(uuid, jsonb, text)', 'execute'),
     'revoke_anon', has_function_privilege('anon', 'public.admin_revoke_business_verification(uuid, text)', 'execute'),
     'list_anon', has_function_privilege('anon', 'public.admin_list_business_verifications()', 'execute'),
     'status_auth', has_function_privilege('authenticated', 'private.business_verification_status(uuid)', 'execute')))`)}
`);
    s = stepMap(log);
  });

  const data = (k) => s[k]?.data;
  const hint = (k, h) => expect(data(k)).toEqual(expect.objectContaining({ hint: h }));
  const refused = (k) => expect(data(k)).toEqual(expect.objectContaining({ error: expect.any(String) }));

  test('installed (prelude with 20270371, or live)', () => {
    expect(data('installed')).toBe(true);
  });

  test('an approved business is not verified; nothing was backfilled', () => {
    expect(data('approved_not_verified')).toEqual([]);
    expect(data('no_events')).toBe(0);
  });

  test('the owner, an ordinary person and a signed-out caller can\'t verify, list or touch the record', () => {
    hint('owner_verifies', 'admin_only');
    hint('person_verifies', 'admin_only');
    refused('anon_verifies');
    hint('owner_lists', 'admin_only');
    refused('owner_reads_record');
    refused('owner_writes_record');
    refused('service_writes_record');
    refused('owner_calls_private_status');
  });

  test('making yourself an admin first doesn\'t help (20270349)', () => {
    expect(data('owner_still_not_admin')).toBe(false);
    hint('owner_verifies_after_self_admin', 'admin_only');
  });

  test('an admin can\'t verify a business they manage', () => {
    hint('admin_verifies_own_business', 'verification_conflict_of_interest');
  });

  test('a checkbox alone is refused; incomplete evidence records nothing', () => {
    hint('missing_check', 'verification_evidence_incomplete');
    hint('checkbox_only', 'verification_method_invalid');
    hint('true_flags', 'verification_evidence_incomplete');
    hint('unknown_method', 'verification_method_invalid');
    hint('wrong_check_method', 'verification_method_invalid');
    hint('no_outcome', 'verification_evidence_incomplete');
    hint('short_note', 'verification_note_too_short');
    hint('extra_check', 'verification_evidence_incomplete');
    hint('no_decision_note', 'verification_note_too_short');
    expect(data('refusals_recorded_nothing')).toBe(0);
  });

  test('an inconclusive check is recorded as not verified, with no badge', () => {
    expect(data('inconclusive')).toEqual({ state: 'not_verified', badge: false });
    expect(data('after_inconclusive')).toEqual([]);
    hint('revoke_unverified', 'business_not_verified');
  });

  test('all four passed: verified, the badge shows for everyone, reviewer and time stamped by the server', () => {
    expect(data('verified')).toEqual({ state: 'verified', badge: true });
    for (const k of ['badge_person', 'badge_anon', 'badge_owner']) expect(data(k)).toHaveLength(1);
    expect(data('stamped')).toEqual({ by_admin: true, recent: true, name: true, manager: true });
  });

  test('the history can\'t be edited or deleted, even by the table owner', () => {
    refused('admin_edits_record');
    hint('owner_role_edits_record', 'verification_history_append_only');
    hint('owner_role_deletes_record', 'verification_history_append_only');
  });

  test('the badge lapses on a rename, address change, new manager or deactivation, and returns when the facts hold', () => {
    expect(data('after_rename')).toEqual([]);
    expect(data('lapse_rename')).toBe('name_changed');
    expect(data('after_rename_back')).toHaveLength(1);
    expect(data('after_address_change')).toEqual([]);
    expect(data('after_manager_change')).toEqual([]);
    expect(data('lapse_manager')).toBe('manager_changed');
    expect(data('after_deactivate')).toEqual([]);
    expect(data('restored')).toHaveLength(1);
  });

  test('only an admin revokes, with a reason; the history keeps every decision', () => {
    hint('owner_revokes', 'admin_only');
    hint('revoke_no_reason', 'verification_note_too_short');
    expect(data('revoked')).toEqual({ state: 'revoked', badge: false });
    expect(data('after_revoke')).toEqual([]);
    hint('revoke_again', 'business_not_verified');
    expect(data('history')).toEqual(['revoked', 'verified', 'not_verified']);
  });

  test('another admin can verify the business the first admin manages; the reader returns ids only', () => {
    expect(data('other_admin_verifies_admin_shop')).toEqual({ state: 'verified', badge: true });
    expect(data('both')).toHaveLength(1);
  });

  test('deleting a business removes its history (the only delete allowed)', () => {
    expect(data('deleted_business_history')).toBe(0);
  });

  test('grants: no client role on the record; reader for anyone; admin functions never for anon; private status closed', () => {
    expect(data('grants')).toEqual({
      record: 0, reader_anon: true, verify_anon: false, revoke_anon: false, list_anon: false, status_auth: false,
    });
  });
});

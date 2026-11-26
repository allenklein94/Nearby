// Duplicate-photo detection activation (20270380) + its off/on switch (scripts/trust-safety/photo-detection-switch.js).
// Staged after 20270379: run with 0348-0380 as JOURNEY_PRELUDE_FILE until live. Owner (2026-11-01): activate before public
// launch at the approved numbers (exact: 3 accounts or 2 with similar names; near: dHash 10 / pHash 10); human review only;
// nothing restricts, hides or notifies anyone; a clear way to turn it off. The switch's own UPDATE statements are run here
// verbatim (imported), so the statement tested is the statement sent. Hashes are fixed numbers, as in reviewCaseHistory.
const { runJourney, stepMap, hasToken, actorDeclares, actorsSql } = require('./journeyHarness');
const sw = require('../../scripts/trust-safety/photo-detection-switch');

const d = hasToken ? describe : describe.skip;

function as(step, sub, stmt, value = `'ok'::text`, role = 'authenticated') {
  return `
  perform set_config('request.jwt.claims', json_build_object('sub', ${sub}, 'role', '${role}')::text, true);
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

const PEOPLE = ['v_admin', 'v_a', 'v_b', 'v_c', 'v_d', 'v_e', 'v_f', 'v_g', 'v_h', 'v_i', 'v_j', 'v_k', 'v_l', 'v_m'];
const obj = (v, file) => `insert into storage.objects (bucket_id, name, metadata) values ('profile-photos', ${v}::text || '/${file}', '{}'::jsonb);`;
const objId = (v, file) => `(select id from storage.objects where bucket_id = 'profile-photos' and name = ${v}::text || '/${file}')`;
const usePhoto = (v, file) => `${obj(v, file)} update profiles set photo_url = ${v}::text || '/${file}' where id = ${v};`;
const hashes = (pairs) => `jsonb_build_array(${pairs.map(([variant, dh, ph]) => `jsonb_build_object('variant', '${variant}', 'dhash', (${dh})::text, 'phash', (${ph})::text)`).join(', ')})`;
const ph = (v, file, dh, p) => `perform public.record_photo_perceptual_hashes(${v}, ${objId(v, file)}, ${hashes([['full', dh, p]])});`;
const fp = (v, file, sha) => `perform public.record_photo_fingerprint(${v}, ${objId(v, file)}, ${sha});`;
const near = (b, mask) => `(${b} # ${mask}::bigint)`;
// three unrelated base photos (every hash far from the others)
const DA = `1234567890123456789::bigint`; const PA = `(-987654321987654321)::bigint`;
const DH = `5555555555555555555::bigint`; const PH = `7777777777777777777::bigint`;
const DS = `(-3333333333333333333)::bigint`; const PS = `2222222222222222222::bigint`;
const SHA = `repeat('7', 64)`;
const caseOf = (v, signal) => `(select c.id from private.account_review_cases c join private.account_review_case_members m on m.case_id = c.id
                                 where c.signal = '${signal}' and m.user_id = ${v} limit 1)`;
const members = (caseExpr) => `(select count(*) from private.account_review_case_members where case_id = ${caseExpr})`;
const caseCount = `(select count(*) from private.account_review_cases where signal in ('identical_photo', 'similar_photo'))`;
const settings = `(select jsonb_build_object('min', duplicate_photo_min_accounts, 'sim', similar_name_min_similarity,
    'd', similar_photo_max_dhash, 'p', similar_photo_max_phash) from private.account_signal_settings)`;

d('journey: duplicate-photo detection activation + off/on switch (20270380)', () => {
  let s;
  beforeAll(async () => {
    const log = await runJourney(`
      ${actorDeclares(PEOPLE)}
      v_out jsonb; v_hint text; v_n int; v_case uuid; v_before text; v_events int;`, `
  ${actorsSql({ people: PEOPLE })}
  perform set_config('app.trusted_update', 'on', true);
  update profiles set is_admin = true where id = v_admin;
  -- unrelated names, except F + G (a similar-names pair)
  update profiles set display_name = 'Alex Park' where id = v_a;
  update profiles set display_name = 'Maria Lopez' where id = v_b;
  update profiles set display_name = 'Sam Chen' where id = v_c;
  update profiles set display_name = 'Dana Fox' where id = v_d;
  update profiles set display_name = 'Lee Moss' where id = v_e;
  update profiles set display_name = 'Jordan Blake' where id = v_f;
  update profiles set display_name = 'Jordan Blakes' where id = v_g;
  update profiles set display_name = 'Kim Wu' where id = v_h;
  update profiles set display_name = 'Ravi Shah' where id = v_i;
  update profiles set display_name = 'Olu Ade' where id = v_j;
  update profiles set display_name = 'Tess Nguyen' where id = v_k;
  update profiles set display_name = 'Nia Bell' where id = v_l;
  update profiles set display_name = 'Omar Diaz' where id = v_m;

  -- ===== what 20270380 left =====
  ${rec('activated', `jsonb_build_object('settings', ${settings},
      'installed', to_regprocedure('private.evaluate_existing_photo_signals()') is not null,
      'anon', has_function_privilege('anon', 'private.evaluate_existing_photo_signals()', 'execute'),
      'authenticated', has_function_privilege('authenticated', 'private.evaluate_existing_photo_signals()', 'execute'),
      'service_role', has_function_privilege('service_role', 'private.evaluate_existing_photo_signals()', 'execute'))`)}
  ${as('client_runs_sweep', 'v_a', `perform private.evaluate_existing_photo_signals()`)}

  -- ===== photos hashed while detection was OFF (before activation: new uploads + the backfill) =====
  ${sw.offUpdate(true)};
  ${rec('off_all', settings)}
  ${usePhoto('v_a', 'a.jpg')} ${usePhoto('v_b', 'b.jpg')} ${usePhoto('v_c', 'c.jpg')}
  ${usePhoto('v_d', 'd.jpg')} ${usePhoto('v_e', 'e.jpg')}
  ${usePhoto('v_f', 'f.jpg')} ${usePhoto('v_g', 'g.jpg')}
  ${usePhoto('v_h', 'h.jpg')} ${usePhoto('v_i', 'i.jpg')} ${usePhoto('v_j', 'j.jpg')}
  -- A, B, C: a re-saved / filtered copy of one photo on three accounts with unrelated names
  ${ph('v_a', 'a.jpg', DA, PA)} ${ph('v_b', 'b.jpg', near(DA, 7), near(PA, 7))} ${ph('v_c', 'c.jpg', near(DA, 1023), near(PA, 1023))}
  -- D, E: a household / couple sharing one photo, unrelated names (legitimate)
  ${ph('v_d', 'd.jpg', DH, PH)} ${ph('v_e', 'e.jpg', near(DH, 3), near(PH, 3))}
  -- F, G: one photo on two accounts with similar names
  ${ph('v_f', 'f.jpg', DS, PS)} ${ph('v_g', 'g.jpg', near(DS, 1), near(PS, 1))}
  -- H, I, J: the identical file on three accounts
  ${fp('v_h', 'h.jpg', SHA)} ${fp('v_i', 'i.jpg', SHA)} ${fp('v_j', 'j.jpg', SHA)}
  ${rec('off_no_cases', caseCount)}
  select md5(string_agg(row_to_json(p)::text, '|' order by p.id)) into v_before
    from (select id, suspended_at, profile_hidden, is_admin, display_name from profiles where id in (v_a, v_b, v_c, v_d, v_e, v_f, v_g, v_h, v_i, v_j, v_k, v_l, v_m)) p;
  select count(*) into v_n from push_outbox where recipient_id in (v_a, v_b, v_c, v_d, v_e, v_f, v_g, v_h, v_i, v_j, v_k, v_l, v_m);

  -- ===== on --all: back to the approved numbers, then every hashed photo is judged once =====
  ${sw.onUpdate(true)};
  ${rec('on_all', settings)}
  ${rec('sweep', 'private.evaluate_existing_photo_signals()')}
  ${rec('after_sweep', `jsonb_build_object(
      'abc', (select jsonb_build_object('reason', reason, 'status', status, 'members', ${members('id')}) from private.account_review_cases where id = ${caseOf('v_a', 'similar_photo')}),
      'household', (select count(*) from private.account_review_case_members where user_id in (v_d, v_e)),
      'fg', (select jsonb_build_object('reason', reason, 'members', ${members('id')}) from private.account_review_cases where id = ${caseOf('v_f', 'similar_photo')}),
      'hij', (select jsonb_build_object('signal', signal, 'reason', reason, 'members', ${members('id')}) from private.account_review_cases where id = ${caseOf('v_h', 'identical_photo')}),
      'total', ${caseCount})`)}
  select count(*) into v_events from private.account_review_case_events;
  ${rec('sweep_again', 'private.evaluate_existing_photo_signals()')}
  ${rec('sweep_again_no_change', `jsonb_build_object('total', ${caseCount}, 'events_added', (select count(*) from private.account_review_case_events) - v_events,
      'abc_members', ${members(caseOf('v_a', 'similar_photo'))})`)}

  -- ===== a new upload while on: joins the open case =====
  ${usePhoto('v_k', 'k.jpg')} ${ph('v_k', 'k.jpg', near(DA, 3), near(PA, 3))}
  ${rec('new_upload_joins', `jsonb_build_object('abc_members', ${members(caseOf('v_a', 'similar_photo'))}, 'total', ${caseCount})`)}

  -- ===== off (near-duplicates only): no new near match; exact copies keep working; open cases untouched =====
  select ${caseOf('v_a', 'similar_photo')} into v_case;
  ${sw.offUpdate(false)};
  ${rec('off_near', settings)}
  ${usePhoto('v_l', 'l.jpg')} ${ph('v_l', 'l.jpg', near(DA, 5), near(PA, 5))}
  ${usePhoto('v_m', 'm.jpg')} ${fp('v_m', 'm.jpg', SHA)}
  ${rec('while_near_off', `jsonb_build_object('l_in_case', exists (select 1 from private.account_review_case_members where user_id = v_l),
      'abc', (select jsonb_build_object('status', status, 'members', ${members('id')}) from private.account_review_cases where id = v_case),
      'hij_members', ${members(caseOf('v_h', 'identical_photo'))}, 'total', ${caseCount})`)}

  -- ===== an admin dismisses the A-case; on again: the sweep never reopens it =====
  ${as('admin_closes', 'v_admin', `perform admin_close_account_review_case(v_case, 'no_action', 'Same group photo')`)}
  ${sw.onUpdate(false)};
  ${rec('on_near_sweep', 'private.evaluate_existing_photo_signals()')}
  ${rec('closed_stays_closed', `jsonb_build_object('status', (select status from private.account_review_cases where id = v_case),
      'l_after_close', (select after_close from private.account_review_case_members where case_id = v_case and user_id = v_l),
      'similar_cases', (select count(*) from private.account_review_cases where signal = 'similar_photo'))`)}

  -- ===== nothing touched an account or sent anything =====
  ${rec('accounts_unchanged', `(select md5(string_agg(row_to_json(p)::text, '|' order by p.id)) = v_before
    from (select id, suspended_at, profile_hidden, is_admin, display_name from profiles where id in (v_a, v_b, v_c, v_d, v_e, v_f, v_g, v_h, v_i, v_j, v_k, v_l, v_m)) p)`)}
  ${rec('nothing_sent', `(select count(*) from push_outbox where recipient_id in (v_a, v_b, v_c, v_d, v_e, v_f, v_g, v_h, v_i, v_j, v_k, v_l, v_m)) - v_n`)}
  ${as('client_sees_cases', 'v_a', `select count(*) into v_n from private.account_review_cases`, 'v_n')}
`);
    s = stepMap(log);
  }, 180000);

  const data = (k) => s[k].data;

  test('20270380 sets the approved numbers; the sweep is not callable by any client or the service role', () => {
    expect(data('activated')).toEqual({ settings: { min: 3, sim: 0.5, d: 10, p: 10 }, installed: true, anon: false, authenticated: false, service_role: false });
    expect(data('client_runs_sweep').error).toMatch(/permission denied/);
    expect(data('client_sees_cases').error).toMatch(/permission denied/);
  });

  test('off --all: photos are still recorded, no case opens', () => {
    expect(data('off_all')).toEqual({ min: null, sim: null, d: null, p: null });
    expect(data('off_no_cases')).toBe(0);
  });

  test('on --all + sweep: photos hashed before activation are judged once under the approved rules', () => {
    expect(data('on_all')).toEqual({ min: 3, sim: 0.5, d: 10, p: 10 });
    expect(data('sweep')).toMatchObject({ cases_opened: 3 });
    const a = data('after_sweep');
    expect(a.abc).toEqual({ reason: 'many_accounts', status: 'open', members: 3 });
    expect(a.household).toBe(0); // two accounts, unrelated names: legitimate, nothing
    expect(a.fg).toEqual({ reason: 'similar_names', members: 2 });
    expect(a.hij).toEqual({ signal: 'identical_photo', reason: 'many_accounts', members: 3 });
    expect(a.total).toBe(3);
  });

  test('the sweep is idempotent: no second case, no extra history', () => {
    expect(data('sweep_again')).toMatchObject({ cases_opened: 0 });
    expect(data('sweep_again_no_change')).toEqual({ total: 3, events_added: 0, abc_members: 3 });
  });

  test('a new upload after activation joins the open case', () => {
    expect(data('new_upload_joins')).toEqual({ abc_members: 4, total: 3 });
  });

  test('off (near only): no new near match, exact copies still matched, open case untouched', () => {
    expect(data('off_near')).toEqual({ min: 3, sim: 0.5, d: null, p: null });
    expect(data('while_near_off')).toEqual({ l_in_case: false, abc: { status: 'open', members: 4 }, hij_members: 4, total: 3 });
  });

  test('a dismissed case stays closed when detection comes back on', () => {
    expect(data('admin_closes')).toBe('ok');
    expect(data('on_near_sweep')).toMatchObject({ cases_opened: 0 });
    const c = data('closed_stays_closed');
    expect(c.status).toBe('closed');
    expect(c.similar_cases).toBe(2);
    expect(c.l_after_close).toBe(true); // recorded as new evidence for an admin; the case does not reopen itself
  });

  test('nothing restricted, hid, changed or notified any account', () => {
    expect(data('accounts_unchanged')).toBe(true);
    expect(data('nothing_sent')).toBe(0);
  });
});

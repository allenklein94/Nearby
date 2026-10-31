// Offer safety (owner approved 2026-10-31, gaps 1-3; migration 20270372). Every actor runs under the real `authenticated`
// role + JWT claims, calling the functions directly as a client could (no harness stand-in: { unscreened: true }); the
// screening results the edge function would record are inserted as the server, exactly as record_business_content_screening
// stores them.
//   1. A business write needs a matching, unused, low-risk screening result of its own: offer reply, availability posting,
//      profile text, experience, occasion package, perk, business update. Refused (hint screening_required, nothing written)
//      without one, with different content, with someone else's, a held (medium) or re-sweep result, one older than 30
//      minutes, or one already used. Edits that don't change the screened text (category, active toggle, package size)
//      need none. The server itself is exempt. An admin approving a held package applies it.
//   2. No contact details in offer text: every shared vector through the one SQL rule; a reply / posting / package / perk
//      carrying one is refused (hint offer_contact_info) even with a screening result, and even from the server.
//   3. Report this offer: the report is about the business's manager (whatever the client sent), with the server's copy of
//      the offer; someone who can't see the offer, and the business itself, are refused.
// One rolled-back transaction. NOT covered: the edge function itself (Deno, needs Anthropic credit), two transactions racing
// for one screening result (single use is a row lock + consumed_at; see the progress doc).
const { runJourney, stepMap, hasToken, actorDeclares, actorsSql } = require('./journeyHarness');
const { CONTACT, CLEAN } = require('../utils/offerContactVectors');

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
const q = (t) => `'${String(t).replace(/'/g, "''")}'`;
// a screening result as the edge function records it (server side)
const screened = (owner, target, content, { tier = 'low', source = 'submission', age = '0 minutes', targetId = 'null' } = {}) => `
  insert into business_content_screening_results (partner_id, target_type, target_id, submitted_by, content_snapshot, risk_tier,
                                                  model_reasoning, source, created_at)
    values (v_p, '${target}', ${targetId}, ${owner}, ${content}, '${tier}', 'journey', '${source}', now() - interval '${age}');`;
const offerContent = (req, text) => `private.screening_content_offer_response(${req}, ${q(text)}, null, '{}', null, null, null, null, null)`;
const submit = (req, text) => `v_out := submit_business_offer(request_id_param => ${req}, offer_type_param => 'standard', offer_description_param => ${q(text)})`;
const reqIns = (v, who) => `
  insert into business_requests (requester_id, raw_text, latitude, longitude, expires_at, party_size, category, date)
    values (${who}, 'journey offer safety', 40.0, -75.0, now() + interval '1 day', 4, 'Coffee', current_date) returning id into ${v};
  insert into business_request_offers (request_id, partner_id) values (${v}, v_p) on conflict do nothing;`;
const offerDesc = (req) => `(select offer_description from business_request_offers where request_id = ${req} and partner_id = v_p)`;

d('journey: offer safety: screening bound to the write, no contact details, report this offer (20270372)', () => {
  let s;
  beforeAll(async () => {
    const vectors = CONTACT.map(([t]) => t).concat(CLEAN);
    const log = await runJourney(`
      ${actorDeclares(['v_o', 'v_o2', 'v_c', 'v_x', 'v_ad', 'v_p', 'v_p2'])}
      r1 uuid; r2 uuid; r3 uuid; r4 uuid; r5 uuid; r6 uuid; v_exp uuid; v_pkg uuid; v_scr uuid; v_off uuid;
      v_out jsonb; v_hint text;`, `
  ${actorsSql({ people: ['v_o', 'v_o2', 'v_c', 'v_x', 'v_ad'], business: { owner: 'v_o', partner: 'v_p' } })}
  insert into brand_partners (id, name, active, latitude, longitude, address, category, subcategory, categories, max_group_size)
    values (v_p2, 'Other Cafe', true, 40.0, -75.0, '2 Journey St', 'food_drink', 'Coffee', '{}', 40);
  update profiles set managed_partner_id = v_p2 where id = v_o2;
  update profiles set is_admin = true where id = v_ad;
  ${reqIns('r1', 'v_c')} ${reqIns('r2', 'v_c')} ${reqIns('r3', 'v_c')} ${reqIns('r4', 'v_c')} ${reqIns('r5', 'v_c')} ${reqIns('r6', 'v_c')}

  -- ===== 1. screening bound to the write =====
  ${as('reply_unscreened', 'v_o', submit('r1', 'We can seat you at 7.'))}
  ${note('reply_unscreened_wrote_nothing', offerDesc('r1'))}
  ${screened('v_o', 'offer_response', offerContent('r1', 'We can seat you at 7.'))}
  ${as('reply_other_text', 'v_o', submit('r1', 'Something else entirely.'))}
  ${as('reply_screened', 'v_o', submit('r1', 'We can seat you at 7.'))}
  ${note('reply_screened_landed', offerDesc('r1'))}
  ${note('reply_result_consumed', `(select to_jsonb(count(*)) from business_content_screening_results where partner_id = v_p and target_type = 'offer_response' and consumed_at is null)`)}
  -- the same result can't be used twice (another request, same words: a fresh result is needed)
  ${screened('v_o', 'offer_response', offerContent('r2', 'Table for four.'))}
  ${as('reply_r2', 'v_o', submit('r2', 'Table for four.'))}
  ${as('reply_r2_again_r3', 'v_o', submit('r3', 'Table for four.'))}
  ${screened('v_o', 'offer_response', offerContent('r3', 'Held text.'), { tier: 'medium' })}
  ${as('reply_held_result', 'v_o', submit('r3', 'Held text.'))}
  ${screened('v_o', 'offer_response', offerContent('r3', 'Resweep text.'), { source: 'resweep' })}
  ${as('reply_resweep_result', 'v_o', submit('r3', 'Resweep text.'))}
  ${screened('v_o', 'offer_response', offerContent('r3', 'Stale text.'), { age: '31 minutes' })}
  ${as('reply_stale_result', 'v_o', submit('r3', 'Stale text.'))}
  ${screened('v_o2', 'offer_response', offerContent('r3', 'Someone else screened this.'))}
  ${as('reply_someone_elses_result', 'v_o', submit('r3', 'Someone else screened this.'))}
  ${note('r3_untouched', offerDesc('r3'))}

  -- availability
  ${as('avail_unscreened', 'v_o', "v_out := post_business_availability('Coffee', 'Two seats free', null, 'standard', null, 2, now(), now() + interval '2 hours')")}
  ${screened('v_o', 'availability', "private.screening_content_availability('Two seats free', null)")}
  ${as('avail_screened', 'v_o', "v_out := post_business_availability('Coffee', 'Two seats free', null, 'standard', null, 2, now(), now() + interval '2 hours')")}
  ${note('avail_rows', `(select to_jsonb(count(*)) from business_availability where partner_id = v_p)`)}

  -- profile: new text needs a result; a category-only edit (same text) doesn't
  ${as('profile_text_unscreened', 'v_o', "perform update_business_profile(v_p, 'Journey Cafe renamed', null, '1 Journey St', 40.0, -75.0, null)")}
  ${note('profile_name_kept', `(select to_jsonb(name like 'Journey Cafe %' and name <> 'Journey Cafe renamed') from brand_partners where id = v_p)`)}
  ${as('profile_category_only', 'v_o', "perform update_business_profile(v_p, (select name from brand_partners where id = v_p), null, '9 New St', 40.0, -75.0, null, 'food_drink', null, null, null, 'Coffee')")}
  ${note('profile_category_saved', `(select to_jsonb(address = '9 New St' and subcategory = 'Coffee') from brand_partners where id = v_p)`)}
  ${screened('v_o', 'business_profile', "private.screening_content_profile('Journey Cafe renamed', null, null, null)")}
  ${as('profile_text_screened', 'v_o', "perform update_business_profile(v_p, 'Journey Cafe renamed', null, '9 New St', 40.0, -75.0, null, 'food_drink', null, null, null, 'Coffee')")}
  ${note('profile_name_saved', `(select to_jsonb(name) from brand_partners where id = v_p)`)}

  -- experience: create needs a result; an active toggle with the same text doesn't; new text does
  ${as('exp_unscreened', 'v_o', "v_exp := create_business_experience(v_p, 'Latte art class')")}
  ${screened('v_o', 'experience', "private.screening_content_experience('Latte art class', null, null, null)")}
  ${as('exp_screened', 'v_o', "v_exp := create_business_experience(v_p, 'Latte art class')", 'v_exp')}
  ${as('exp_toggle', 'v_o', "perform update_business_experience(v_exp, 'Latte art class', null, null, '{}', null, null, false)")}
  ${as('exp_retitle_unscreened', 'v_o', "perform update_business_experience(v_exp, 'Latte art masterclass', null, null, '{}', null, null, false)")}
  ${note('exp_state', `(select jsonb_build_object('title', title, 'active', active) from business_experiences where id = v_exp)`)}

  -- occasion package (never screened before 20270372)
  ${as('pkg_unscreened', 'v_o', "v_out := create_occasion_package('birthday', 'Birthday table', 'Cake and candles', array['Cake'])")}
  ${screened('v_o', 'package', "private.screening_content_package(' Birthday table ', 'Cake and candles', array['Cake', ' '])")}
  ${as('pkg_screened', 'v_o', "v_out := create_occasion_package('birthday', 'Birthday table', 'Cake and candles', array['Cake'])", 'v_out')}
  v_pkg := (select id from business_occasion_packages where partner_id = v_p);
  ${as('pkg_size_only', 'v_o', "v_out := update_occasion_package(v_pkg, 'birthday', 'Birthday table', 'Cake and candles', array['Cake'], 6)")}
  ${as('pkg_rename_unscreened', 'v_o', "v_out := update_occasion_package(v_pkg, 'birthday', 'Birthday bash', 'Cake and candles', array['Cake'], 6)")}
  ${note('pkg_state', `(select jsonb_build_object('name', name, 'min', min_guests) from business_occasion_packages where id = v_pkg)`)}
  -- a held package an admin approves is applied from its snapshot
  insert into business_content_screening_results (partner_id, target_type, target_id, submitted_by, content_snapshot, risk_tier, model_reasoning)
    values (v_p, 'package', null, v_o, jsonb_build_object('packageId', null, 'occasionType', 'anniversary', 'name', 'Anniversary dinner',
      'description', null, 'includedItems', jsonb_build_array('Flowers'), 'minGuests', 2, 'pricePerPerson', 40, 'availableDays', jsonb_build_array(5, 6)),
      'medium', 'journey') returning id into v_scr;
  ${note('pkg_held_not_applied', `(select to_jsonb(count(*)) from business_occasion_packages where partner_id = v_p and name = 'Anniversary dinner')`)}
  ${as('pkg_admin_approves', 'v_ad', 'perform admin_review_business_content_screening(v_scr, true)')}
  ${note('pkg_held_applied', `(select jsonb_build_object('items', included_items, 'days', available_days, 'price', price_per_person) from business_occasion_packages where partner_id = v_p and name = 'Anniversary dinner')`)}

  -- perk + business update (inserted by the user)
  ${as('perk_unscreened', 'v_o', "insert into brand_offers (partner_id, title, reward_type, active) values (v_p, 'Free cookie', 'freebie', true)")}
  ${screened('v_o', 'offer', "private.screening_content_perk('Free cookie', null, null)")}
  ${as('perk_screened', 'v_o', "insert into brand_offers (partner_id, title, reward_type, active) values (v_p, 'Free cookie', 'freebie', true)")}
  ${as('update_unscreened', 'v_o', "insert into business_updates (partner_id, title, body) values (v_p, 'New hours', 'Open late')")}
  ${screened('v_o', 'update', "private.screening_content_update('New hours', 'Open late')")}
  ${as('update_screened', 'v_o', "insert into business_updates (partner_id, title, body) values (v_p, 'New hours', 'Open late')")}
  ${note('perk_update_rows', `jsonb_build_object('perks', (select count(*) from brand_offers where partner_id = v_p), 'updates', (select count(*) from business_updates where partner_id = v_p))`)}

  -- the server itself (no signed-in user) is exempt
  perform set_config('request.jwt.claims', '', true);
  begin
    insert into brand_offers (partner_id, title, reward_type, active) values (v_p, 'Server perk', 'freebie', true);
    v_out := to_jsonb('ok'::text);
  exception when others then v_out := jsonb_build_object('error', sqlerrm);
  end;
  ${note('server_write_exempt', 'v_out')}

  -- grants: the moved functions are out of reach; signed-out callers can't run the wrappers
  ${note('grants', `jsonb_build_object(
    'auth_unscreened', has_function_privilege('authenticated', 'private.submit_business_offer_unscreened(uuid,text,text,numeric,timestamptz,uuid,text,text,text,text[],boolean,numeric,text,text,uuid,timestamptz,time,time,timestamptz,smallint)', 'execute'),
    'auth_require', has_function_privilege('authenticated', 'private.require_business_screening(uuid,text,uuid,jsonb)', 'execute'),
    'auth_wrapper', has_function_privilege('authenticated', 'public.submit_business_offer(uuid,text,text,numeric,timestamptz,uuid,text,text,text,text[],boolean,numeric,text,text,uuid,timestamptz,time,time,timestamptz,smallint)', 'execute'),
    'anon_profile', has_function_privilege('anon', 'public.update_business_profile(uuid,text,text,text,double precision,double precision,text,text,text[],text,text,text,text[])', 'execute'),
    'auth_contact_check', has_function_privilege('authenticated', 'public.offer_contact_info_kind(text[])', 'execute'),
    'service_contact_check', has_function_privilege('service_role', 'public.offer_contact_info_kind(text[])', 'execute'),
    'auth_can_write_screening', has_table_privilege('authenticated', 'business_content_screening_results', 'insert'))`)}

  -- ===== 2. no contact details =====
  ${note('vectors', `(select jsonb_object_agg(t, coalesce(private.offer_contact_kind(t), 'none')) from unnest(array[${vectors.map(q).join(', ')}]::text[]) t)`)}
  ${screened('v_o', 'offer_response', offerContent('r4', 'Call 561-555-0142 to book'))}
  ${as('reply_with_phone', 'v_o', submit('r4', 'Call 561-555-0142 to book'))}
  ${note('reply_with_phone_wrote_nothing', offerDesc('r4'))}
  ${screened('v_o', 'offer_response', "private.screening_content_offer_response(r4, 'See you soon', null, array['Menu at coastalcafe.com'], null, null, null, null, null)")}
  ${as('reply_item_with_link', 'v_o', "v_out := submit_business_offer(request_id_param => r4, offer_type_param => 'standard', offer_description_param => 'See you soon', included_items_param => array['Menu at coastalcafe.com'])")}
  ${screened('v_o', 'availability', "private.screening_content_availability('Seats tonight', 'Email hello@coastal.example')")}
  ${as('avail_with_email', 'v_o', "v_out := post_business_availability('Coffee', 'Seats tonight', 'Email hello@coastal.example', 'standard', null, 2, now(), now() + interval '2 hours')")}
  ${screened('v_o', 'package', "private.screening_content_package('Party pack', 'Text 5615550142', '{}')")}
  ${as('pkg_with_phone', 'v_o', "v_out := create_occasion_package('birthday', 'Party pack', 'Text 5615550142')")}
  perform set_config('request.jwt.claims', '', true);
  begin
    insert into brand_offers (partner_id, title, reward_type, active) values (v_p, 'Visit www.coastal.example', 'freebie', true);
    v_out := to_jsonb('ok'::text);
  exception when others then get stacked diagnostics v_hint = pg_exception_hint; v_out := jsonb_build_object('error', sqlerrm, 'hint', v_hint);
  end;
  ${note('server_perk_with_link', 'v_out')}
  -- an unrelated change to an offer row is never refused by the rule
  update business_request_offers set viewed_at = now() where request_id = r1 and partner_id = v_p;
  ${note('unrelated_update_ok', `to_jsonb(true)`)}

  -- ===== 3. report this offer =====
  v_off := (select id from business_request_offers where request_id = r1 and partner_id = v_p);
  ${as('report_offer', 'v_c', "insert into reports (reporter_id, reported_id, reason, content_type, content_id) values (v_c, v_c, 'Spam or scam', 'business_offer', v_off)")}
  ${note('report_row', `(select jsonb_build_object('reported_is_manager', reported_id = v_o, 'excerpt', content_excerpt, 'captured', content_captured_at is not null,
      'sent_at_set', content_sent_at is not null) from reports where content_id = v_off and reporter_id = v_c)`)}
  ${as('report_by_stranger', 'v_x', "insert into reports (reporter_id, reported_id, reason, content_type, content_id) values (v_x, v_o, 'Spam or scam', 'business_offer', v_off)")}
  ${as('report_own_offer', 'v_o', "insert into reports (reporter_id, reported_id, reason, content_type, content_id) values (v_o, v_o, 'Spam or scam', 'business_offer', v_off)")}
  ${as('report_pending_row', 'v_c', "insert into reports (reporter_id, reported_id, reason, content_type, content_id) values (v_c, null, 'Spam or scam', 'business_offer', (select id from business_request_offers where request_id = r6 and partner_id = v_p))")}
  ${note('report_count', `(select to_jsonb(count(*)) from reports where content_type = 'business_offer')`)}
`, { unscreened: true });
    s = stepMap(log);
  });

  const refusedScreening = (k) => expect([k, s[k].data.hint]).toEqual([k, 'screening_required']);
  const ok = (k) => expect([k, s[k].data?.error]).toEqual([k, undefined]);

  test('an offer reply needs its own matching, unused, low-risk screening result', () => {
    refusedScreening('reply_unscreened');
    expect(s.reply_unscreened_wrote_nothing.data).toBeNull();
    refusedScreening('reply_other_text');
    ok('reply_screened');
    expect(s.reply_screened_landed.data).toBe('We can seat you at 7.');
    expect(s.reply_result_consumed.data).toBe(0);
    ok('reply_r2');
    refusedScreening('reply_r2_again_r3');
    ['reply_held_result', 'reply_resweep_result', 'reply_stale_result', 'reply_someone_elses_result'].forEach(refusedScreening);
    expect(s.r3_untouched.data).toBeNull();
  });

  test('availability, profile text, experiences, packages, perks and updates are bound the same way', () => {
    refusedScreening('avail_unscreened');
    ok('avail_screened');
    expect(s.avail_rows.data).toBe(1);
    refusedScreening('profile_text_unscreened');
    expect(s.profile_name_kept.data).toBe(true);
    ok('profile_category_only');
    expect(s.profile_category_saved.data).toBe(true);
    ok('profile_text_screened');
    expect(s.profile_name_saved.data).toBe('Journey Cafe renamed');
    refusedScreening('exp_unscreened');
    ok('exp_screened');
    ok('exp_toggle');
    refusedScreening('exp_retitle_unscreened');
    expect(s.exp_state.data).toEqual({ title: 'Latte art class', active: false });
    refusedScreening('pkg_unscreened');
    ok('pkg_screened');
    ok('pkg_size_only');
    refusedScreening('pkg_rename_unscreened');
    expect(s.pkg_state.data).toEqual({ name: 'Birthday table', min: 6 });
    refusedScreening('perk_unscreened');
    ok('perk_screened');
    refusedScreening('update_unscreened');
    ok('update_screened');
    expect(s.perk_update_rows.data).toEqual({ perks: 1, updates: 1 });
  });

  test('a held package is applied only when an admin approves it', () => {
    expect(s.pkg_held_not_applied.data).toBe(0);
    ok('pkg_admin_approves');
    expect(s.pkg_held_applied.data).toEqual({ items: ['Flowers'], days: [5, 6], price: 40 });
  });

  test('the server is exempt; clients never reach the unscreened functions or the screening table', () => {
    expect(s.server_write_exempt.data).toBe('ok');
    expect(s.grants.data).toEqual({
      auth_unscreened: false, auth_require: false, auth_wrapper: true, anon_profile: false,
      auth_contact_check: false, service_contact_check: true, auth_can_write_screening: false,
    });
  });

  test('the one contact rule: every shared vector', () => {
    const got = s.vectors.data;
    CONTACT.forEach(([t, kind]) => expect([t, got[t]]).toEqual([t, kind]));
    CLEAN.forEach((t) => expect([t, got[t]]).toEqual([t, 'none']));
  });

  test('offer text with contact details is refused everywhere, even with a screening result or from the server', () => {
    ['reply_with_phone', 'reply_item_with_link', 'avail_with_email', 'pkg_with_phone', 'server_perk_with_link']
      .forEach((k) => expect([k, s[k].data.hint]).toEqual([k, 'offer_contact_info']));
    expect(s.reply_with_phone_wrote_nothing.data).toBeNull();
    expect(s.unrelated_update_ok.data).toBe(true);
  });

  test('report this offer: about the business manager, with the server copy; strangers and the business itself refused', () => {
    ok('report_offer');
    expect(s.report_row.data).toEqual({
      reported_is_manager: true, captured: true, sent_at_set: true,
      excerpt: expect.stringMatching(/^Offer from Journey Cafe renamed:\nWe can seat you at 7\.$/),
    });
    ['report_by_stranger', 'report_own_offer', 'report_pending_row']
      .forEach((k) => expect([k, s[k].data.hint]).toEqual([k, 'report_content_mismatch']));
    expect(s.report_count.data).toBe(1);
  });
});

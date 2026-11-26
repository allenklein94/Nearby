// Business notes screened like business text (owner, 2026-11-12; migration 20270415). Every actor runs under the real
// `authenticated` role + JWT claims, calling the functions directly as a client could; the screening results the edge
// function would record are inserted as the server, exactly as record_business_content_screening stores them.
//   1. Availability pulse note: a new or changed note needs a matching, unused, low-risk screening result of its own
//      (refused, hint screening_required, nothing written: without one, with other text, someone else's, a held (medium)
//      or re-sweep result, one older than 30 minutes, or one already used). A status tap keeping the same note, and
//      clearing it, need none. A non-manager is refused. Contact details refused (hint offer_contact_info) even with a
//      screening result, and even from the server.
//   2. Decline note: stored only with a matching screening result for THAT request; without one (or with a result for
//      another request, other text, already used) the decline still happens and the note is left out. A note with any
//      other reason is never stored. Contact details refused, nothing declined.
//   3. The moved functions are out of the client's reach; signed-out callers can't run the wrappers.
// One rolled-back transaction. NOT covered: the edge function itself (Deno, needs Anthropic credit).
const { runJourney, stepMap, hasToken, actorDeclares, actorsSql } = require('./journeyHarness');
const { CONTACT } = require('../utils/offerContactVectors');

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
const screened = (owner, target, content, { tier = 'low', source = 'submission', age = '0 minutes', targetId = 'null' } = {}) => `
  insert into business_content_screening_results (partner_id, target_type, target_id, submitted_by, content_snapshot, risk_tier,
                                                  model_reasoning, source, created_at)
    values (v_p, '${target}', ${targetId}, ${owner}, ${content}, '${tier}', 'journey', '${source}', now() - interval '${age}');`;
const pulseContent = (t) => `private.screening_content_availability_note(${q(t)})`;
const pulse = (status, t) => `perform set_business_availability_pulse(v_p, '${status}', ${t === null ? 'null' : q(t)})`;
const pulseNote = `(select to_jsonb(availability_pulse_note) from brand_partners where id = v_p)`;
const declineContent = (req, t) => `private.screening_content_decline_note(${req}, ${q(t)})`;
const decline = (req, reason, t) => `v_out := decline_business_offer(${req}, '${reason}', ${t === null ? 'null' : q(t)})`;
const row = (req) => `(select jsonb_build_object('status', status, 'note', decline_note) from business_request_offers where request_id = ${req} and partner_id = v_p)`;
const reqIns = (v) => `
  insert into business_requests (requester_id, raw_text, latitude, longitude, expires_at, party_size, category, date)
    values (v_c, 'journey note screening', 40.0, -75.0, now() + interval '1 day', 4, 'Coffee', current_date) returning id into ${v};
  insert into business_request_offers (request_id, partner_id) values (${v}, v_p) on conflict do nothing;`;
const PHONE = CONTACT.find(([, k]) => k === 'phone')[0];
const LINK = CONTACT.find(([, k]) => k === 'url')[0];
const DISGUISED = 'message coastalcoffee at gmail';

d('journey: business notes screened like business text (20270415)', () => {
  let s;
  beforeAll(async () => {
    const log = await runJourney(`
      ${actorDeclares(['v_o', 'v_o2', 'v_c', 'v_p'])}
      r1 uuid; r2 uuid; r3 uuid; r4 uuid; r5 uuid; r6 uuid; r7 uuid;
      v_out jsonb; v_hint text;`, `
  ${actorsSql({ people: ['v_o', 'v_o2', 'v_c'], business: { owner: 'v_o', partner: 'v_p' } })}
  ${reqIns('r1')} ${reqIns('r2')} ${reqIns('r3')} ${reqIns('r4')} ${reqIns('r5')} ${reqIns('r6')} ${reqIns('r7')}

  -- ===== 1. availability pulse note =====
  ${as('p_status_only', 'v_o', pulse('open', null))}
  ${as('p_unscreened', 'v_o', pulse('limited', 'Back at 3'))}
  ${note('p_unscreened_wrote_nothing', `(select jsonb_build_object('pulse', availability_pulse, 'note', availability_pulse_note) from brand_partners where id = v_p)`)}
  ${screened('v_o', 'availability_note', pulseContent('Something else'))}
  ${as('p_other_text', 'v_o', pulse('limited', 'Back at 3'))}
  ${screened('v_o', 'availability_note', pulseContent('Back at 3'))}
  ${as('p_screened', 'v_o', pulse('limited', '  Back at 3 '))}
  ${note('p_screened_landed', pulseNote)}
  ${note('p_result_consumed', `(select to_jsonb(count(*)) from business_content_screening_results where partner_id = v_p and target_type = 'availability_note' and consumed_at is not null)`)}
  ${as('p_same_note_status_tap', 'v_o', pulse('full', 'Back at 3'))}
  -- reuse: clear, then the same words again need a fresh result (the first one is used)
  ${as('p_clear', 'v_o', pulse('open', null))}
  ${note('p_cleared', pulseNote)}
  ${as('p_reuse', 'v_o', pulse('limited', 'Back at 3'))}
  ${screened('v_o', 'availability_note', pulseContent('Held note'), { tier: 'medium' })}
  ${as('p_held', 'v_o', pulse('limited', 'Held note'))}
  ${screened('v_o', 'availability_note', pulseContent('Resweep note'), { source: 'resweep' })}
  ${as('p_resweep', 'v_o', pulse('limited', 'Resweep note'))}
  ${screened('v_o', 'availability_note', pulseContent('Stale note'), { age: '31 minutes' })}
  ${as('p_stale', 'v_o', pulse('limited', 'Stale note'))}
  ${screened('v_o2', 'availability_note', pulseContent('Someone else screened this'))}
  ${as('p_someone_elses', 'v_o', pulse('limited', 'Someone else screened this'))}
  ${note('p_still_cleared', pulseNote)}
  ${as('p_not_manager', 'v_c', pulse('limited', null))}
  -- contact details: refused even with a screening result
  ${screened('v_o', 'availability_note', pulseContent(PHONE))}
  ${as('p_phone', 'v_o', pulse('limited', PHONE))}
  ${screened('v_o', 'availability_note', pulseContent(LINK))}
  ${as('p_link', 'v_o', pulse('limited', LINK))}
  ${screened('v_o', 'availability_note', pulseContent(DISGUISED))}
  ${as('p_disguised', 'v_o', pulse('limited', DISGUISED))}
  ${note('p_no_contact_stored', pulseNote)}
  -- the server itself: exempt from screening, never from the contact rule
  perform set_config('request.jwt.claims', '', true);
  begin perform private.set_business_availability_pulse_unscreened(v_p, 'open', null); exception when others then null; end;
  begin
    update brand_partners set availability_pulse_note = ${q(LINK)} where id = v_p;
    v_out := to_jsonb('ok'::text);
  exception when others then get stacked diagnostics v_hint = pg_exception_hint; v_out := jsonb_build_object('error', sqlerrm, 'hint', v_hint);
  end;
  ${note('p_server_link', 'v_out')}
  begin
    update brand_partners set availability_pulse_note = 'Server note' where id = v_p;
    v_out := to_jsonb('ok'::text);
  exception when others then v_out := jsonb_build_object('error', sqlerrm);
  end;
  ${note('p_server_clean', 'v_out')}

  -- ===== 2. decline note =====
  ${as('d_no_note', 'v_o', decline('r1', 'too_busy_right_now', null))}
  ${note('d_no_note_row', row('r1'))}
  ${as('d_unscreened', 'v_o', decline('r2', 'other', 'Closed for a private event'))}
  ${note('d_unscreened_row', row('r2'))}
  ${screened('v_o', 'decline_note', declineContent('r3', 'Closed for a private event'), { targetId: 'r3' })}
  ${as('d_screened', 'v_o', decline('r3', 'other', ' Closed for a private event '))}
  ${note('d_screened_row', row('r3'))}
  -- a result for one request never carries to another; nor other text; nor someone else's; nor a used one
  ${screened('v_o', 'decline_note', declineContent('r4', 'Kitchen closed'), { targetId: 'r4' })}
  ${as('d_other_request', 'v_o', decline('r5', 'other', 'Kitchen closed'))}
  ${note('d_other_request_row', row('r5'))}
  ${as('d_other_text', 'v_o', decline('r4', 'other', 'Kitchen closed early'))}
  ${note('d_other_text_row', row('r4'))}
  ${screened('v_o2', 'decline_note', declineContent('r6', 'Fully booked'), { targetId: 'r6' })}
  ${as('d_someone_elses', 'v_o', decline('r6', 'other', 'Fully booked'))}
  ${note('d_someone_elses_row', row('r6'))}
  -- a note with any reason but Other is never stored (unchanged behaviour)
  ${as('d_non_other', 'v_o', decline('r7', 'too_far', 'Too far for us'))}
  ${note('d_non_other_row', row('r7'))}
  -- contact details: refused even with a screening result, nothing declined
  insert into business_requests (requester_id, raw_text, latitude, longitude, expires_at, party_size, category, date)
    values (v_c, 'journey note screening contact', 40.0, -75.0, now() + interval '1 day', 4, 'Coffee', current_date) returning id into r1;
  insert into business_request_offers (request_id, partner_id) values (r1, v_p);
  ${screened('v_o', 'decline_note', declineContent('r1', PHONE), { targetId: 'r1' })}
  ${as('d_phone', 'v_o', decline('r1', 'other', PHONE))}
  ${note('d_phone_row', row('r1'))}

  -- ===== 3. grants =====
  ${note('grants', `jsonb_build_object(
    'auth_pulse_unscreened', has_function_privilege('authenticated', 'private.set_business_availability_pulse_unscreened(uuid,text,text)', 'execute'),
    'auth_decline_unscreened', has_function_privilege('authenticated', 'private.decline_business_offer_unscreened(uuid,text,text)', 'execute'),
    'auth_consume', has_function_privilege('authenticated', 'private.consume_business_screening(uuid,text,uuid,jsonb)', 'execute'),
    'auth_pulse', has_function_privilege('authenticated', 'public.set_business_availability_pulse(uuid,text,text)', 'execute'),
    'auth_decline', has_function_privilege('authenticated', 'public.decline_business_offer(uuid,text,text)', 'execute'),
    'anon_pulse', has_function_privilege('anon', 'public.set_business_availability_pulse(uuid,text,text)', 'execute'),
    'anon_decline', has_function_privilege('anon', 'public.decline_business_offer(uuid,text,text)', 'execute'))`)}
`, { unscreened: true });
    s = stepMap(log);
  });

  const refused = (k, hint) => expect([k, s[k].data.hint]).toEqual([k, hint]);
  const ok = (k) => expect([k, s[k].data?.error]).toEqual([k, undefined]);

  test('availability note: a new note needs its own matching, unused, low-risk screening result', () => {
    ok('p_status_only');
    refused('p_unscreened', 'screening_required');
    expect(s.p_unscreened_wrote_nothing.data).toEqual({ pulse: 'open', note: null });
    refused('p_other_text', 'screening_required');
    ok('p_screened');
    expect(s.p_screened_landed.data).toBe('Back at 3'); // stored as checked: trimmed
    expect(s.p_result_consumed.data).toBe(1);
    ok('p_same_note_status_tap');
    ok('p_clear');
    expect(s.p_cleared.data).toBeNull();
    ['p_reuse', 'p_held', 'p_resweep', 'p_stale', 'p_someone_elses'].forEach((k) => refused(k, 'screening_required'));
    expect(s.p_still_cleared.data).toBeNull();
    expect(s.p_not_manager.data.error).toMatch(/do not manage/);
  });

  test('availability note: contact details refused even with a screening result, and from the server', () => {
    ['p_phone', 'p_link', 'p_disguised', 'p_server_link'].forEach((k) => refused(k, 'offer_contact_info'));
    expect(s.p_no_contact_stored.data).toBeNull();
    expect(s.p_server_clean.data).toBe('ok');
  });

  test('decline note: stored only with a matching result for that request; otherwise declined without it', () => {
    ok('d_no_note');
    expect(s.d_no_note_row.data).toEqual({ status: 'declined', note: null });
    ok('d_unscreened');
    expect(s.d_unscreened_row.data).toEqual({ status: 'declined', note: null });
    ok('d_screened');
    expect(s.d_screened_row.data).toEqual({ status: 'declined', note: 'Closed for a private event' });
    ['d_other_request', 'd_other_text', 'd_someone_elses', 'd_non_other'].forEach(ok);
    ['d_other_request_row', 'd_other_text_row', 'd_someone_elses_row', 'd_non_other_row']
      .forEach((k) => expect([k, s[k].data]).toEqual([k, { status: 'declined', note: null }]));
  });

  test('decline note: contact details refused, nothing declined', () => {
    refused('d_phone', 'offer_contact_info');
    expect(s.d_phone_row.data).toEqual({ status: 'pending', note: null });
  });

  test('the moved functions are out of reach; signed-out callers cannot run the wrappers', () => {
    expect(s.grants.data).toEqual({
      auth_pulse_unscreened: false, auth_decline_unscreened: false, auth_consume: false,
      auth_pulse: true, auth_decline: true, anon_pulse: false, anon_decline: false,
    });
  });
});

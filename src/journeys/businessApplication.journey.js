// Screen-reduction audit 2026-10-24 (owner approved item 1): one business application, one screen. The person's latest
// application row decides what BusinessPartnerApply shows (utils/businessApplicationState.js). This journey walks the row
// through every state under real roles: apply -> pending (a second pending application refused) -> the team asks for more
// -> needs info (with the note) -> resend onto the SAME row -> pending -> declined -> a new application in place -> pending.
// The review pushes open the one screen. One rolled-back transaction; pushes stay in the outbox.
// Not covered (device only): the screen rendering each state, the resend form, Back, the map pin return.
jest.mock('../services/supabase', () => ({ supabase: {} }));
const { runJourney, stepMap, hasToken, actorDeclares, actorsSql } = require('./journeyHarness');
const { applicationView, showsReviewerNote, resendFormFrom } = require('../utils/businessApplicationState');
const { notificationDestination } = require('../navigation/notificationDestinations');

const d = hasToken ? describe : describe.skip;

const as = (sub) => `perform set_config('request.jwt.claims', json_build_object('sub', ${sub}, 'role', 'authenticated')::text, true);
  set local role authenticated;`;
// What getMyBusinessPartnerRequest reads: the person's own latest row, through RLS.
const latest = (step) => `log := log || jsonb_build_array(jsonb_build_object('step', '${step}', 'ok', true, 'data', (
    select to_jsonb(r) from (select id, status, business_name, business_description, contact_info, category, website, phone, address,
      requested_features, admin_notes from business_partner_requests where requester_id = v_a order by created_at desc limit 1) r)));`;

d('journey: one business application moves through its states on one screen', () => {
  let s;
  beforeAll(async () => {
    const log = await runJourney(`${actorDeclares(['v_a', 'v_admin', 'v_other'])} v_req uuid; v_req2 uuid; v_start bigint; v_ok boolean;`, `
  perform set_config('app.push_handoff_test_failure', 'on', true);
  ${actorsSql({ people: ['v_a', 'v_admin', 'v_other'] })}
  update profiles set is_admin = true where id = v_admin;
  select coalesce(max(id), 0) into v_start from push_outbox;

  ${as('v_a')}
  ${latest('none')}
  insert into business_partner_requests (requester_id, business_name, business_description, category, requested_features)
    values (v_a, 'Journey Apply Cafe', 'Coffee', 'food_drink', array['offers']) returning id into v_req;
  ${latest('pending')}
  begin
    insert into business_partner_requests (requester_id, business_name) values (v_a, 'Second Pending');
    v_ok := true;
  exception when unique_violation then v_ok := false;
  end;
  log := log || jsonb_build_array(jsonb_build_object('step', 'second_pending_refused', 'ok', not v_ok));
  reset role;

  ${as('v_admin')}
  perform request_more_business_partner_info(v_req, 'Please add your website.');
  reset role;

  ${as('v_a')}
  ${latest('needs_info')}
  reset role;

  ${as('v_other')}
  begin
    perform resubmit_business_partner_request(v_req, 'Hijack', null, null, null, null, null, null, null);
    v_ok := true;
  exception when others then v_ok := false;
  end;
  log := log || jsonb_build_array(jsonb_build_object('step', 'stranger_resend_refused', 'ok', not v_ok));
  reset role;

  ${as('v_a')}
  perform resubmit_business_partner_request(v_req, 'Journey Apply Cafe', 'Coffee by the sea', 'hi@cafe.test', 'food_drink',
    'https://cafe.test', '555', '1 Ocean Blvd', array['offers', 'host_gatherings']);
  ${latest('resent')}
  log := log || jsonb_build_array(jsonb_build_object('step', 'same_row', 'ok',
    (select count(*) from business_partner_requests where requester_id = v_a) = 1));
  reset role;

  ${as('v_admin')}
  perform deny_business_partner_request(v_req);
  reset role;

  -- one transaction = one now(): give the declined row its earlier time, as separate sessions would have
  update business_partner_requests set created_at = now() - interval '1 minute' where id = v_req;
  ${as('v_a')}
  ${latest('denied')}
  insert into business_partner_requests (requester_id, business_name) values (v_a, 'Journey Apply Cafe Again') returning id into v_req2;
  ${latest('new_application')}
  reset role;

  log := log || jsonb_build_array(jsonb_build_object('step', 'pushes', 'ok', true, 'data', (
    select coalesce(jsonb_agg(jsonb_build_object('type', data->>'type') order by id), '[]'::jsonb)
    from push_outbox where id > v_start and recipient_id = v_a)));`);
    s = stepMap(log);
  }, 60000);

  test('no application: the screen offers Apply', () => {
    expect(s.none.data).toBeNull();
    expect(applicationView(s.none.data)).toBe('apply');
  });

  test('submitted: pending, and a second pending application is refused', () => {
    expect(applicationView(s.pending.data)).toBe('pending');
    expect(s.second_pending_refused.ok).toBe(true);
  });

  test('the team asks for more: needs info, with the note shown and the form prefilled from the row', () => {
    expect(applicationView(s.needs_info.data)).toBe('needs_info');
    expect(showsReviewerNote('needs_info', s.needs_info.data)).toBe(true);
    expect(s.needs_info.data.admin_notes).toBe('Please add your website.');
    const form = resendFormFrom(s.needs_info.data);
    expect(form).toMatchObject({ businessName: 'Journey Apply Cafe', description: 'Coffee', requestedFeatures: ['offers'] });
    expect(form.category).toBe(s.pending.data.category); // the business group key the person picked
  });

  test('only the applicant can resend; the resend updates the same row back to pending with the new details', () => {
    expect(s.stranger_resend_refused.ok).toBe(true);
    expect(s.resent.data.id).toBe(s.needs_info.data.id);
    expect(s.same_row.ok).toBe(true);
    expect(applicationView(s.resent.data)).toBe('pending');
    expect(s.resent.data).toMatchObject({ business_description: 'Coffee by the sea', website: 'https://cafe.test', requested_features: ['offers', 'host_gatherings'] });
  });

  test('declined: the screen shows it, and a new application starts in place and is accepted', () => {
    expect(applicationView(s.denied.data)).toBe('denied');
    expect(applicationView(s.denied.data, { startingNew: true })).toBe('apply');
    expect(s.new_application.data.id).not.toBe(s.denied.data.id);
    expect(applicationView(s.new_application.data)).toBe('pending');
  });

  test('every review push the applicant got opens the one application screen', async () => {
    const types = s.pushes.data.map((p) => p.type).filter((t) => t === 'business_partner_needs_info' || t === 'business_partner_denied');
    expect(types).toEqual(expect.arrayContaining(['business_partner_needs_info', 'business_partner_denied']));
    for (const type of types) expect(await notificationDestination({ type })).toEqual({ name: 'BusinessPartnerApply' });
  });
});

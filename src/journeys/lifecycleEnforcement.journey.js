// Lifecycle enforcement fixes (owner approved 2026-10-24; migration 20270343, after the read-only audit
// PRODUCT_AUDIT/LIFECYCLE_ACTION_ENFORCEMENT_AUDIT_2026-10-24.md). Every actor runs under the real `authenticated` role + JWT
// claims (grants, RLS, the new invoker trigger); setup runs as the owner like the app's own server functions.
//   D1 a booked gathering (accepted offer on its request, or on an add-on of it) keeps its time: the host's direct time change is
//      refused, nothing else moves (offer, request, no push); an unrelated edit still saves; once the reservation is cancelled the
//      time can change again; a gathering with no booking reschedules as before.
//   D2 join_gathering and the direct pending insert are refused once the gathering has started; upcoming joins still work, the
//      women-only rule on the direct insert still holds, an existing attendee of a started gathering keeps their row.
//   D3 accepting an offer whose request is past its deadline (status still 'open', before the sweep) is refused on both the
//      single and the group path; nothing is booked, held or sent.
//   R1 the host's direct UPDATE can't change capacity / women-only / visibility / location / recurrence, move a started gathering
//      or set a passed time; set_gathering_capacity still works; an unrelated edit of a started gathering still saves; another
//      person's or anon's direct update changes nothing; the booking helper answers only the host.
//   R2 invitations (both paths) are refused once the gathering started; send_social_invite now refuses women-only / host-blocked
//      invitees like invite_friend_to_gathering; upcoming invites still work; an existing invitation keeps its behaviour.
// One rolled-back transaction. NOT covered here: two transactions racing (accept vs reschedule): see
// scripts/replay/reschedule-accept-concurrency.js.
const { runJourney, stepMap, hasToken, actorDeclares, actorsSql } = require('./journeyHarness');

const d = hasToken ? describe : describe.skip;

// One statement as `sub` under the real role; records 'ok' (or a value) or the error text + hint.
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
  log := log || jsonb_build_array(jsonb_build_object('step', '${step}', 'ok', true, 'data', v_out));`;
}
const note = (step, value) => `
  log := log || jsonb_build_array(jsonb_build_object('step', '${step}', 'ok', true, 'data', ${value}));`;
const pushes = `(select count(*) from push_outbox where recipient_id in (v_h, v_a, v_m, v_x, v_o))`;
const events = `(select count(*) from domain_events where actor_id in (v_h, v_a, v_m, v_x, v_o))`;
const gIns = (v, when, extra = '', extraVals = '') => `
  insert into gatherings (host_id, title, scheduled_at, precise_lat, precise_lng, interest_tag, area, capacity, visibility, is_public${extra})
    values (v_h, 'JLE ' || '${v}', ${when}, 1.5, -150.5, 'Coffee', 'journey', 10, 'everyone', true${extraVals}) returning id into ${v};`;

d('journey: lifecycle actions are enforced by the server (migration 20270343)', () => {
  let s;
  beforeAll(async () => {
    const log = await runJourney(`
      ${actorDeclares(['v_h', 'v_a', 'v_m', 'v_x', 'v_o', 'v_p'])}
      g_book uuid; g_add uuid; g_free uuid; g_past uuid; g_wo uuid; r_book uuid; r_add_parent uuid; r_add uuid; r_exp uuid; r_exp2 uuid;
      o_book uuid; o_add uuid; o_exp uuid; o_exp2 uuid; v_out jsonb; v_hint text; v_n int; v_p0 bigint; v_e0 bigint; v_t timestamptz;`, `
  ${actorsSql({
    people: ['v_h', 'v_a', 'v_m', 'v_x', 'v_o'],
    friends: [['v_h', 'v_a'], ['v_h', 'v_m'], ['v_a', 'v_m']],
    business: { owner: 'v_o', partner: 'v_p' },
  })}
  update profiles set gender = 'Woman' where id in (v_h, v_a);
  update profiles set gender = 'Man' where id = v_m;
  ${gIns('g_book', "now() + interval '2 days'")}
  ${gIns('g_add', "now() + interval '2 days'")}
  ${gIns('g_free', "now() + interval '2 days'")}
  ${gIns('g_past', "now() - interval '1 hour'")}
  ${gIns('g_wo', "now() + interval '2 days'", ', women_only', ', true')}
  -- m was already attending the started gathering; h had invited a before it started
  insert into gathering_interest (gathering_id, user_id, status) values (g_past, v_m, 'approved');
  insert into social_invites (inviter_id, invitee_id, invite_type, target_id) values (v_h, v_a, 'gathering', g_past);

  -- g_book: the host's request for the gathering, answered by the business; the host accepts through the real call below
  insert into business_requests (requester_id, raw_text, latitude, longitude, expires_at, party_size, category, gathering_id)
    values (v_h, 'journey lifecycle book', 40.0, -75.0, now() + interval '1 day', 4, 'Coffee', g_book) returning id into r_book;
  insert into business_request_offers (request_id, partner_id, status, offer_type, offer_description)
    values (r_book, v_p, 'offered', 'standard', 'Journey table for 4') returning id into o_book;
  -- g_add: the booking is on an ADD-ON of the gathering's request (the add-on carries no gathering_id itself)
  insert into business_requests (requester_id, raw_text, latitude, longitude, expires_at, party_size, category, gathering_id, status)
    values (v_h, 'journey lifecycle parent', 40.0, -75.0, now() + interval '1 day', 4, 'Coffee', g_add, 'fulfilled') returning id into r_add_parent;
  insert into business_requests (requester_id, raw_text, latitude, longitude, expires_at, party_size, category, parent_request_id, addon_type, status)
    values (v_h, 'journey lifecycle add-on', 40.0, -75.0, now() + interval '1 day', 4, 'Coffee', r_add_parent, 'dessert', 'fulfilled') returning id into r_add;
  insert into business_request_offers (request_id, partner_id, status, offer_type, offer_description, accepted_at)
    values (r_add, v_p, 'accepted', 'standard', 'Journey add-on', now()) returning id into o_add;
  -- D3: requests past their deadline, still 'open' (the sweep hasn't run), each with an open offer
  insert into business_requests (requester_id, raw_text, latitude, longitude, expires_at, party_size, category)
    values (v_h, 'journey lifecycle expired', 40.0, -75.0, now() - interval '1 minute', 2, 'Coffee') returning id into r_exp;
  insert into business_request_offers (request_id, partner_id, status, offer_type, offer_description)
    values (r_exp, v_p, 'offered', 'standard', 'Journey late') returning id into o_exp;
  insert into business_requests (requester_id, raw_text, latitude, longitude, expires_at, party_size, category)
    values (v_h, 'journey lifecycle expired 2', 40.0, -75.0, now() - interval '1 minute', 2, 'Coffee') returning id into r_exp2;
  insert into business_request_offers (request_id, partner_id, status, offer_type, offer_description)
    values (r_exp2, v_p, 'offered', 'standard', 'Journey late 2') returning id into o_exp2;

  ${note('offer_gathering_ids', `jsonb_build_object('book', _offer_gathering_id(o_book) = g_book, 'addon', _offer_gathering_id(o_add) = g_add, 'none', _offer_gathering_id(o_exp) is null)`)}

  -- ===== valid accept (the real call), then D1 =====
  ${as('accept_book', 'v_h', 'v_out := accept_business_offer(o_book)')}
  ${as('helper_host', 'v_h', 'v_n := 0', '_gathering_has_active_booking(g_book)')}
  ${as('helper_other', 'v_m', 'v_n := 0', '_gathering_has_active_booking(g_book)')}
  select scheduled_at into v_t from gatherings where id = g_book;
  v_p0 := ${pushes};
  ${as('reschedule_booked', 'v_h', "update gatherings set scheduled_at = scheduled_at + interval '1 hour', description = 'moved' where id = g_book")}
  ${note('reschedule_booked_nothing_moved', `jsonb_build_object('time_same', (select scheduled_at from gatherings where id = g_book) = v_t,
    'desc', (select description from gatherings where id = g_book), 'offer', (select status from business_request_offers where id = o_book),
    'request', (select status from business_requests where id = r_book), 'pushes', ${pushes} - v_p0)`)}
  ${as('edit_booked_same_time', 'v_h', "update gatherings set description = 'new words', scheduled_at = date_trunc('milliseconds', scheduled_at) where id = g_book")}
  ${note('edit_booked_saved', `to_jsonb((select description from gatherings where id = g_book))`)}
  ${as('reschedule_addon_booked', 'v_h', "update gatherings set scheduled_at = scheduled_at + interval '1 hour' where id = g_add")}
  ${as('reschedule_free', 'v_h', "update gatherings set scheduled_at = scheduled_at + interval '1 hour' where id = g_free")}
  ${as('cancel_reservation', 'v_h', 'v_out := cancel_business_reservation(o_book)')}
  ${as('reschedule_after_cancel', 'v_h', "update gatherings set scheduled_at = scheduled_at + interval '1 hour' where id = g_book")}
  ${note('after_cancel_moved', `jsonb_build_object('moved', date_trunc('milliseconds', (select scheduled_at from gatherings where id = g_book)) = date_trunc('milliseconds', v_t + interval '1 hour'))`)}

  -- ===== D2 =====
  ${as('join_started', 'v_a', 'v_out := join_gathering(g_past)')}
  ${as('direct_insert_started', 'v_a', "insert into gathering_interest (gathering_id, user_id, status) values (g_past, v_a, 'pending')")}
  ${note('started_rows', `jsonb_build_object('a', (select count(*) from gathering_interest where gathering_id = g_past and user_id = v_a),
    'm_kept', (select status from gathering_interest where gathering_id = g_past and user_id = v_m))`)}
  ${as('m_sees_started', 'v_m', 'select count(*) into v_n from gatherings where id = g_past', 'v_n')}
  ${as('leave_started_unchanged', 'v_m', 'v_out := leave_gathering(g_past)')}
  ${as('join_upcoming', 'v_a', 'v_out := join_gathering(g_free)', "(select status from gathering_interest where gathering_id = g_free and user_id = v_a)")}
  ${as('direct_insert_upcoming', 'v_m', "insert into gathering_interest (gathering_id, user_id, status) values (g_free, v_m, 'pending')")}
  ${as('direct_insert_women_only', 'v_m', "insert into gathering_interest (gathering_id, user_id, status) values (g_wo, v_m, 'pending')")}
  ${as('approve_after_start', 'v_h', 'v_out := approve_gathering_interest((select id from gathering_interest where gathering_id = g_past and user_id = v_m))')}

  -- ===== D3 =====
  v_p0 := ${pushes};
  ${as('accept_past_deadline', 'v_h', 'v_out := accept_business_offer(o_exp)')}
  ${as('group_accept_not_client_callable', 'v_h', 'v_out := _accept_business_offer_internal(o_exp2)')}
  -- the group path is reached only through confirm_group_plan_offer (server side); called the way it calls it:
  perform set_config('request.jwt.claims', json_build_object('sub', v_h, 'role', 'authenticated')::text, true);
  begin v_out := _accept_business_offer_internal(o_exp2); v_out := '"ok"';
  exception when others then v_out := jsonb_build_object('error', sqlerrm); end;
  ${note('group_accept_past_deadline', 'v_out')}
  ${note('past_deadline_nothing_booked', `jsonb_build_object(
    'offers', (select jsonb_agg(status order by status) from business_request_offers where id in (o_exp, o_exp2)),
    'requests', (select jsonb_agg(status) from business_requests where id in (r_exp, r_exp2)),
    'reservations', (select count(*) from business_reservations where offer_id in (o_exp, o_exp2)),
    'pushes', ${pushes} - v_p0)`)}

  -- ===== R1 =====
  ${as('lock_capacity', 'v_h', 'update gatherings set capacity = 2 where id = g_free')}
  ${as('lock_women_only_off', 'v_h', 'update gatherings set women_only = false where id = g_wo')}
  ${as('lock_women_only_on', 'v_h', 'update gatherings set women_only = true where id = g_free')}
  ${as('lock_visibility', 'v_h', "update gatherings set visibility = 'friends' where id = g_free")}
  ${as('lock_is_public', 'v_h', 'update gatherings set is_public = false where id = g_free')}
  ${as('lock_point', 'v_h', 'update gatherings set precise_lat = 2.5 where id = g_free')}
  ${as('lock_area', 'v_h', "update gatherings set area = 'elsewhere' where id = g_free")}
  ${as('lock_recurrence', 'v_h', "update gatherings set recurrence_rule = 'weekly' where id = g_free")}
  ${as('lock_started_time', 'v_h', "update gatherings set scheduled_at = now() + interval '1 day' where id = g_past")}
  ${as('lock_passed_time', 'v_h', "update gatherings set scheduled_at = now() - interval '1 hour' where id = g_free")}
  ${as('started_unrelated_edit', 'v_h', "update gatherings set description = 'photos soon' where id = g_past")}
  ${as('capacity_rpc', 'v_h', 'v_out := set_gathering_capacity(g_free, 5)', '(select capacity from gatherings where id = g_free)')}
  ${as('stranger_update', 'v_x', "update gatherings set title = 'hijack', capacity = 99 where id = g_free")}
  ${note('protected_unchanged', `(select jsonb_build_object('title', title, 'capacity', capacity, 'women_only', women_only, 'visibility', visibility,
    'is_public', is_public, 'lat', precise_lat, 'area', area, 'recurrence', recurrence_rule) from gatherings where id = g_free)`)}
  ${note('women_only_still_on', `(select women_only from gatherings where id = g_wo)`)}
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  set local role anon;
  begin update gatherings set title = 'anon' where id = g_free; v_out := '"ok"';
  exception when others then v_out := to_jsonb(sqlerrm); end;
  reset role;
  ${note('anon_update', `jsonb_build_object('result', v_out, 'title', (select title from gatherings where id = g_free))`)}

  -- ===== R2 =====
  select count(*) into v_n from social_invites where target_id in (g_past, g_wo);
  v_e0 := ${events}; v_p0 := ${pushes};
  ${as('invite_started', 'v_h', 'perform invite_friend_to_gathering(g_past, v_m)')}
  ${as('send_invite_started', 'v_h', "perform send_social_invite('gathering', g_past, v_m)")}
  ${as('send_invite_women_only', 'v_h', "perform send_social_invite('gathering', g_wo, v_m)")}
  ${note('refused_invites_wrote_nothing', `jsonb_build_object('invites', (select count(*) from social_invites where target_id in (g_past, g_wo)) - v_n,
    'events', ${events} - v_e0, 'pushes', ${pushes} - v_p0)`)}
  ${as('send_invite_women_only_woman', 'v_h', "perform send_social_invite('gathering', g_wo, v_a)", "(select count(*) from social_invites where target_id = g_wo and invitee_id = v_a)")}
  ${as('send_invite_upcoming', 'v_h', "perform send_social_invite('gathering', g_free, v_m)")}
  ${as('invite_upcoming', 'v_a', 'perform invite_friend_to_gathering(g_book, v_m)', "(select count(*) from social_invites where target_id = g_book and invitee_id = v_m)")}
  ${as('existing_invite_accept', 'v_a', "perform respond_to_social_invite((select id from social_invites where target_id = g_past and invitee_id = v_a), true)")}
  ${as('existing_invite_decline', 'v_a', "perform respond_to_social_invite((select id from social_invites where target_id = g_past and invitee_id = v_a), false)",
    "(select status from social_invites where target_id = g_past and invitee_id = v_a)")}`);
    s = stepMap(log);
  }, 120000);

  const refused = (step, hint) => expect(s[step].data.hint ?? null).toBe(hint);

  test('the offer -> gathering link covers a direct request and an add-on', () => {
    expect(s.offer_gathering_ids.data).toEqual({ book: true, addon: true, none: true });
  });

  test('D1: a booked gathering keeps its time; nothing else moves; an unrelated edit saves', () => {
    expect(s.accept_book.data).toBe('ok');
    expect(s.helper_host.data).toBe(true);
    expect(s.helper_other.data).toBe(false);
    refused('reschedule_booked', 'gathering_time_booked');
    expect(s.reschedule_booked.data.error).toBe("This gathering has a confirmed business booking, so its time can't change.");
    expect(s.reschedule_booked_nothing_moved.data).toEqual({ time_same: true, desc: null, offer: 'accepted', request: 'fulfilled', pushes: 0 });
    expect(s.edit_booked_same_time.data).toBe('ok');
    expect(s.edit_booked_saved.data).toBe('new words');
  });

  test('D1: an add-on booking locks the time too; no booking = reschedule as before; after cancelling the reservation it can move', () => {
    refused('reschedule_addon_booked', 'gathering_time_booked');
    expect(s.reschedule_free.data).toBe('ok');
    expect(s.cancel_reservation.data).toBe('ok');
    expect(s.reschedule_after_cancel.data).toBe('ok');
    expect(s.after_cancel_moved.data).toEqual({ moved: true });
  });

  test('D2: nobody becomes a new attendee once it started; existing attendees keep their place', () => {
    expect(s.join_started.data.error).toBe('This gathering has already happened');
    expect(s.direct_insert_started.data.error).toMatch(/row-level security/);
    expect(s.started_rows.data).toEqual({ a: 0, m_kept: 'approved' });
    expect(s.m_sees_started.data).toBe(1);
    expect(s.leave_started_unchanged.data.error).toBe('This gathering has already happened');
    expect(s.approve_after_start.data.error).toMatch(/already been reviewed|already happened/);
  });

  test('D2: upcoming joins still work; the direct insert keeps the women-only rule', () => {
    expect(s.join_upcoming.data).toBe('approved');
    expect(s.direct_insert_upcoming.data).toBe('ok');
    expect(s.direct_insert_women_only.data.error).toMatch(/row-level security|Gathering not found/); // visibility trigger refuses first
  });

  test('D3: past the request deadline (before the sweep) nothing is booked on either path', () => {
    expect(s.accept_past_deadline.data.error).toBe('This request has closed.');
    expect(s.group_accept_not_client_callable.data.error).toMatch(/permission denied/);
    expect(s.group_accept_past_deadline.data.error).toBe('This request has closed.');
    expect(s.past_deadline_nothing_booked.data).toEqual({ offers: ['offered', 'offered'], requests: ['open', 'open'], reservations: 0, pushes: 0 });
  });

  test('R1: fixed settings can only change through their server function; time rules hold', () => {
    for (const step of ['lock_capacity', 'lock_women_only_off', 'lock_women_only_on', 'lock_visibility', 'lock_is_public', 'lock_point',
      'lock_area', 'lock_recurrence', 'lock_started_time', 'lock_passed_time']) refused(step, 'gathering_locked');
    expect(s.started_unrelated_edit.data).toBe('ok');
    expect(s.capacity_rpc.data).toBe(5);
    expect(s.stranger_update.data).toBe('ok'); // RLS: zero rows, no error
    expect(s.protected_unchanged.data).toEqual({ title: 'JLE g_free', capacity: 5, women_only: false, visibility: 'everyone', is_public: true,
      lat: 1.5, area: 'journey', recurrence: null });
    expect(s.women_only_still_on.data).toBe(true);
    expect(s.anon_update.data.title).toBe('JLE g_free');
  });

  test('R2: no new invitation after the start; send_social_invite now honours women-only; upcoming invites + old invites unchanged', () => {
    refused('invite_started', 'invite_state:ineligible');
    refused('send_invite_started', 'invite_state:ineligible');
    refused('send_invite_women_only', 'invite_state:ineligible');
    expect(s.refused_invites_wrote_nothing.data).toEqual({ invites: 0, events: 0, pushes: 0 });
    expect(s.send_invite_women_only_woman.data).toBe(1);
    expect(s.send_invite_upcoming.data).toBe('ok');
    expect(s.invite_upcoming.data).toBe(1);
    expect(s.existing_invite_accept.data.error).toMatch(/expired/);
    expect(s.existing_invite_decline.data).toBe('expired');
  });
});

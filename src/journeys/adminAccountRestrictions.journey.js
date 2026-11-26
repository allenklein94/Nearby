// Admin-controlled temporary restrictions (migration 20270399, staged after 20270398; run with the staged migrations as
// JOURNEY_PRELUDE_FILE until they are live). Every call runs as a real signed-in person (or admin / anon) under the real role +
// JWT claims.
//   1. Only an admin restricts: non-admins, anon and the admin's own account are refused; reason, duration and the list of
//      actions are checked by the server.
//   2. Each capability pauses exactly its actions for that one person, with hint 'account_restricted' + detail
//      {capability, until}: messages, invitations, friend requests (request, Connect/like, notice; a pass still works),
//      gatherings (creating a gathering or community), offers (the business's own manager posting availability AND replying
//      to a customer's request through submit_business_offer, the app's real reply path behind screen-business-content;
//      the request stays answerable once the pause is lifted), links (a NEW
//      link in a profile or a message; text without a new link still saves). Everything else they do, and everyone else, is
//      unaffected.
//   3. It ends by itself: a restriction past its end refuses nothing. An admin may lift early (written reason; a second lift =
//      already); after a lift the action goes through.
//   4. Auditable: the record is append-only (no update, no delete), a restriction can only be lifted (once), clients can read
//      neither table, the admin list shows active + ended with who and why.
//   5. No other consequence: never suspended, hidden or sent a push.
//   6. Retention: ended more than 12 months ago = purged with its record; active kept; kept while the review case (or
//      report) it came from is under an active legal hold (20270395), purged once that hold is released.
//   7. get_my_account_restriction: the caller's own pause only (what screen-business-content asks before screening).
// One rolled-back transaction. Not covered: the app's wording (Jest: accountRestrictions.test.js), the admin screen on a phone,
// two admins at once (scripts/replay/account-restriction-concurrency.js).
const { runJourney, stepMap, hasToken, actorDeclares, actorsSql } = require('./journeyHarness');

const d = hasToken ? describe : describe.skip;

function as(step, sub, stmt, role = 'authenticated', value = `'ok'::text`) {
  return `
  perform set_config('request.jwt.claims', json_build_object('sub', ${sub}, 'role', '${role}')::text, true);
  set local role ${role};
  begin ${stmt}; v_out := to_jsonb(${value});
  exception when others then
    get stacked diagnostics v_hint = pg_exception_hint, v_detail = pg_exception_detail;
    v_out := jsonb_build_object('error', sqlerrm, 'hint', v_hint, 'detail', v_detail, 'code', sqlstate);
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  log := log || jsonb_build_array(jsonb_build_object('step', '${step}', 'ok', true, 'data', v_out));`;
}
const rec = (step, value) => `log := log || jsonb_build_array(jsonb_build_object('step', '${step}', 'ok', true, 'data', to_jsonb(${value})));`;
const restrict = (step, who, caps, days = 3, reason = `'Repeated spam messages to strangers'`) =>
  as(step, 'v_admin', `select public.admin_restrict_account(${who}, array[${caps}]::text[], ${days}, ${reason}) into v_out`, 'authenticated', 'v_out');
const dm = (step, from, to, body) => as(step, from, `insert into messages (match_id, sender_id, body)
  values ((select id from matches where user_a = least(${from}, ${to}) and user_b = greatest(${from}, ${to})), ${from}, ${body})`);

d('journey: admin-controlled temporary restrictions pause specific actions, end by themselves and stay auditable (20270399)', () => {
  let s;
  beforeAll(async () => {
    const log = await runJourney(`
      ${actorDeclares(['v_admin', 'v_a', 'v_b', 'v_c', 'v_d', 'v_e', 'v_o'])}
      v_p uuid := gen_random_uuid(); v_g uuid := gen_random_uuid();
      v_out jsonb; v_hint text; v_detail text; v_push_before bigint; v_rid uuid; v_old uuid; v_req uuid;
      v_case_held uuid; v_case_free uuid; v_held_r uuid; v_free_r uuid; v_hold uuid;`, `
  ${actorsSql({ people: ['v_admin', 'v_a', 'v_b', 'v_c', 'v_d', 'v_e', 'v_o'], business: { owner: 'v_o', partner: 'v_p' } })}
  update profiles set is_admin = true where id = v_admin;
  ${rec('installed', `to_regprocedure('public.admin_restrict_account(uuid,text[],integer,text,uuid,uuid)') is not null`)}
  delete from private.rate_limit_rules;
  update private.trust_settings set established_min_account_age = null;
  insert into gatherings (id, host_id, title, description, scheduled_at, precise_lat, precise_lng, interest_tag, area, visibility, is_public)
    values (v_g, v_a, 'Sunday coffee', 'Easy morning', now() + interval '3 days', 26.7123, -80.0321, 'Coffee', 'abc', 'everyone', true);
  insert into matches (user_a, user_b) values (least(v_a, v_b), greatest(v_a, v_b)), (least(v_a, v_c), greatest(v_a, v_c));
  insert into friendships (user_a, user_b, status, requested_by) values (least(v_a, v_b), greatest(v_a, v_b), 'accepted', v_a);
  v_push_before := (select count(*) from push_outbox where recipient_id in (v_b, v_c, v_d, v_e, v_o));

  -- ===== 1. who may restrict, and what the server checks =====
  ${as('non_admin', 'v_a', `select public.admin_restrict_account(v_b, array['messages'], 3, 'Repeated spam messages to strangers') into v_out`, 'authenticated', 'v_out')}
  ${as('anon', 'null', `select public.admin_restrict_account(v_b, array['messages'], 3, 'Repeated spam messages to strangers') into v_out`, 'anon', 'v_out')}
  ${as('self', 'v_admin', `select public.admin_restrict_account(v_admin, array['messages'], 3, 'Repeated spam messages to strangers') into v_out`, 'authenticated', 'v_out')}
  ${restrict('short_reason', 'v_b', `'messages'`, 3, `'spam'`)}
  ${restrict('too_long', 'v_b', `'messages'`, 31)}
  ${restrict('zero_days', 'v_b', `'messages'`, 0)}
  ${restrict('bad_cap', 'v_b', `'discovery'`)}
  ${restrict('no_cap', 'v_b', ``)}
  ${rec('none_yet', `(select count(*) from private.account_restrictions)`)}

  -- ===== 2. each capability =====
  ${restrict('r_b', 'v_b', `'messages', 'gatherings', 'messages'`)}
  ${dm('b_message', 'v_b', 'v_a', `'hi again'`)}
  ${as('b_gathering', 'v_b', `insert into gatherings (host_id, title, description, scheduled_at, precise_lat, precise_lng, interest_tag, area, visibility, is_public)
      values (v_b, 'Late walk', 'Walk', now() + interval '2 days', 26.71, -80.03, 'Coffee', 'abc', 'everyone', true)`)}
  ${as('b_community', 'v_b', `insert into communities (name, description, creator_id, interest_tag, is_public) values ('Walkers', 'We walk', v_b, 'Coffee', true)`)}
  ${as('b_friend_request', 'v_b', `insert into friendships (user_a, user_b, status, requested_by) values (least(v_b, v_c), greatest(v_b, v_c), 'pending', v_b)`)}
  ${as('b_invite', 'v_b', `insert into social_invites (inviter_id, invitee_id, invite_type, target_id) values (v_b, v_a, 'gathering', v_g)`)}
  ${dm('a_messages_b', 'v_a', 'v_b', `'unaffected'`)}
  ${dm('a_messages_c', 'v_a', 'v_c', `'unaffected'`)}

  ${restrict('r_c', 'v_c', `'links'`)}
  ${dm('c_link_message', 'v_c', 'v_a', `'buy here: cheap-deals dot com'`)}
  ${dm('c_plain_message', 'v_c', 'v_a', `'see you at nine'`)}
  update profiles set bio = 'My site: oldsite.com' where id = v_c;
  ${as('c_bio_new_link', 'v_c', `update profiles set bio = 'My site: oldsite.com and new-promo.net' where id = v_c`)}
  ${as('c_bio_keep_link', 'v_c', `update profiles set bio = 'Still here. My site: oldsite.com' where id = v_c`)}

  update profiles set open_to_friend_discovery = true where id in (v_a, v_d, v_e);
  ${restrict('r_d', 'v_d', `'friend_requests'`)}
  ${as('d_request', 'v_d', `insert into friendships (user_a, user_b, status, requested_by) values (least(v_d, v_a), greatest(v_d, v_a), 'pending', v_d)`)}
  ${as('d_like', 'v_d', `perform public.record_friend_discovery_swipe(v_e, 'like')`)}
  ${as('d_pass', 'v_d', `perform public.record_friend_discovery_swipe(v_a, 'pass')`)}
  ${as('d_notice', 'v_d', `insert into notices (from_user, to_user) values (v_d, v_e)`)}
  ${dm('d_message_unrelated', 'v_a', 'v_b', `'still fine'`)}

  ${restrict('r_e', 'v_e', `'invitations'`)}
  ${as('e_invite', 'v_e', `insert into social_invites (inviter_id, invitee_id, invite_type, target_id) values (v_e, v_a, 'gathering', v_g)`)}

  ${restrict('r_o', 'v_o', `'offers'`)}
  ${as('o_availability', 'v_o', `insert into business_availability (partner_id, category, title, description, offer_type, starts_at, ends_at)
      values (v_p, 'Coffee', 'Two seats open', 'Window seats', 'discount', now() + interval '1 hour', now() + interval '3 hours')`)}
  ${as('o_message_ok', 'v_o', `insert into notices (from_user, to_user) values (v_o, v_e)`)}
  -- the business's reply to a customer's request: the real write path (submit_business_offer; the harness records the
  -- low-risk screening result screen-business-content would, so only the pause can refuse it)
  insert into business_requests (requester_id, raw_text, latitude, longitude, expires_at, party_size, category, date)
    values (v_a, 'journey restricted reply', 26.7123, -80.0321, now() + interval '1 day', 2, 'Coffee', current_date) returning id into v_req;
  insert into business_request_offers (request_id, partner_id) values (v_req, v_p) on conflict do nothing;
  ${as('o_reply', 'v_o', `perform submit_business_offer(request_id_param => v_req, offer_type_param => 'standard', offer_description_param => 'Two window seats at seven.')`)}
  ${rec('o_reply_row', `(select jsonb_build_object('status', status, 'description', offer_description) from business_request_offers where request_id = v_req and partner_id = v_p)`)}
  ${as('o_reader', 'v_o', `v_out := to_jsonb(public.get_my_account_restriction('offers'))`, 'authenticated', 'v_out')}
  ${as('o_reader_other_cap', 'v_o', `v_out := to_jsonb(public.get_my_account_restriction('messages'))`, 'authenticated', 'v_out')}
  ${as('a_reader', 'v_a', `v_out := to_jsonb(public.get_my_account_restriction('offers'))`, 'authenticated', 'v_out')}
  ${as('anon_reader', 'null', `v_out := to_jsonb(public.get_my_account_restriction('offers'))`, 'anon', 'v_out')}
  v_old := (select id from private.account_restrictions where user_id = v_o and capability = 'offers');
  ${as('lift_o', 'v_admin', `select public.admin_lift_account_restriction(v_old, 'Business explained the duplicates') into v_out`, 'authenticated', 'v_out')}
  ${as('o_reply_after_lift', 'v_o', `perform submit_business_offer(request_id_param => v_req, offer_type_param => 'standard', offer_description_param => 'Two window seats at seven.')`)}
  ${rec('o_reply_row_after_lift', `(select status from business_request_offers where request_id = v_req and partner_id = v_p)`)}

  -- ===== 3. ends by itself; lift early =====
  insert into private.account_restrictions (user_id, capability, reason, admin_id, starts_at, expires_at)
    values (v_e, 'messages', 'An earlier pause that already ended', v_admin, now() - interval '3 days', now() - interval '1 day');
  insert into matches (user_a, user_b) values (least(v_a, v_e), greatest(v_a, v_e));
  ${dm('e_message_after_expiry', 'v_e', 'v_a', `'back again'`)}
  v_rid := (select id from private.account_restrictions where user_id = v_b and capability = 'messages');
  ${as('lift_non_admin', 'v_a', `select public.admin_lift_account_restriction(v_rid, 'Reviewed, it was a misunderstanding') into v_out`, 'authenticated', 'v_out')}
  ${as('lift_short', 'v_admin', `select public.admin_lift_account_restriction(v_rid, 'ok') into v_out`, 'authenticated', 'v_out')}
  ${as('lift', 'v_admin', `select public.admin_lift_account_restriction(v_rid, 'Reviewed, it was a misunderstanding') into v_out`, 'authenticated', 'v_out')}
  ${as('lift_again', 'v_admin', `select public.admin_lift_account_restriction(v_rid, 'Reviewed, it was a misunderstanding') into v_out`, 'authenticated', 'v_out')}
  ${dm('b_message_after_lift', 'v_b', 'v_a', `'thanks'`)}
  ${as('b_gathering_still', 'v_b', `insert into communities (name, description, creator_id, interest_tag, is_public) values ('Walkers 2', 'We walk', v_b, 'Coffee', true)`)}
  v_old := (select id from private.account_restrictions where user_id = v_e and capability = 'messages');
  ${as('lift_expired', 'v_admin', `select public.admin_lift_account_restriction(v_old, 'Already over, recording anyway') into v_out`, 'authenticated', 'v_out')}

  -- ===== 4. auditable =====
  ${rec('events', `(select jsonb_agg(jsonb_build_object('action', action, 'admin', admin_id = v_admin) order by created_at, action desc) from private.account_restriction_events where user_id = v_b)`)}
  ${as('event_update', 'v_admin', `update private.account_restriction_events set reason = 'edited' where user_id = v_b`, 'postgres')}
  ${as('event_delete', 'v_admin', `delete from private.account_restriction_events where user_id = v_b`, 'postgres')}
  ${as('extend_directly', 'v_admin', `update private.account_restrictions set expires_at = expires_at + interval '1 day' where user_id = v_d`, 'postgres')}
  ${as('relift_directly', 'v_admin', `update private.account_restrictions set lift_reason = 'changed my mind here' where id = v_rid`, 'postgres')}
  ${as('client_reads_restrictions', 'v_admin', `select count(*) into v_out from private.account_restrictions`, 'authenticated', 'v_out')}
  ${as('client_reads_events', 'v_b', `select count(*) into v_out from private.account_restriction_events`, 'authenticated', 'v_out')}
  ${as('admin_list', 'v_admin', `select jsonb_agg(jsonb_build_object('cap', capability, 'active', active, 'lifted', lifted_at is not null, 'by', admin_name is not null,
      'reason', reason) order by capability) into v_out from public.admin_list_account_restrictions(v_b)`, 'authenticated', 'v_out')}
  ${as('list_non_admin', 'v_b', `select count(*) into v_out from public.admin_list_account_restrictions(v_b)`, 'authenticated', 'v_out')}

  -- ===== 5. no other consequence =====
  ${rec('d_swipes', `(select jsonb_object_agg(direction, to_user = v_a) from friend_discovery_swipes where from_user = v_d)`)}
  ${rec('nobody_suspended', `(select jsonb_agg(jsonb_build_object('suspended', suspended_at is not null, 'hidden', coalesce(profile_hidden, false))) from profiles where id in (v_b, v_c, v_d, v_e, v_o))`)}
  -- a restriction itself sends nothing to anyone (the messages above send their own ordinary pushes)
  v_push_before := (select count(*) from push_outbox);
  ${restrict('r_a', 'v_a', `'messages', 'links'`)}
  ${rec('no_push', `(select count(*) from push_outbox) - v_push_before`)}

  -- ===== 6. retention =====
  insert into private.account_restrictions (user_id, capability, reason, admin_id, starts_at, expires_at)
    values (v_d, 'links', 'A pause from more than a year ago', v_admin, now() - interval '400 days', now() - interval '390 days') returning id into v_old;
  insert into private.account_restriction_events (restriction_id, user_id, action, admin_id, reason) values (v_old, v_d, 'restrict', v_admin, 'A pause from more than a year ago');
  -- legal holds (20270395): an old restriction decided from a held review case stays; one from a case without a hold goes
  insert into private.account_review_cases (signal, sha256, reason) values ('identical_photo', 'journey-0399-held', 'many_accounts') returning id into v_case_held;
  insert into private.account_review_cases (signal, sha256, reason) values ('identical_photo', 'journey-0399-free', 'many_accounts') returning id into v_case_free;
  insert into private.account_restrictions (user_id, capability, reason, review_case_id, admin_id, starts_at, expires_at)
    values (v_e, 'links', 'Old pause, case under legal hold', v_case_held, v_admin, now() - interval '400 days', now() - interval '390 days') returning id into v_held_r;
  insert into private.account_restrictions (user_id, capability, reason, review_case_id, admin_id, starts_at, expires_at)
    values (v_e, 'messages', 'Old pause, case not on hold', v_case_free, v_admin, now() - interval '400 days', now() - interval '390 days') returning id into v_free_r;
  ${as('place_hold', 'v_admin', `select public.admin_place_legal_hold('review_case', v_case_held, 'Preservation request from counsel', null) into v_out`, 'authenticated', 'v_out')}
  perform private.purge_ended_account_restrictions();
  ${rec('held_purge', `jsonb_build_object('held_kept', exists(select 1 from private.account_restrictions where id = v_held_r),
      'unheld_purged', not exists(select 1 from private.account_restrictions where id = v_free_r))`)}
  v_hold := (select id from private.legal_holds where target_type = 'review_case' and target_id = v_case_held and released_at is null);
  ${as('release_hold', 'v_admin', `select public.admin_release_legal_hold(v_hold, 'Matter closed, preservation ended') into v_out`, 'authenticated', 'v_out')}
  perform private.purge_ended_account_restrictions();
  ${rec('after_release', `not exists(select 1 from private.account_restrictions where id = v_held_r)`)}
  perform private.purge_ended_account_restrictions();
  ${rec('purged', `jsonb_build_object('old', exists(select 1 from private.account_restrictions where id = v_old),
      'old_events', (select count(*) from private.account_restriction_events where restriction_id = v_old),
      'active_kept', exists(select 1 from private.account_restrictions where user_id = v_d and capability = 'friend_requests'),
      'ended_recently_kept', exists(select 1 from private.account_restrictions where id = v_rid))`)}
  ${rec('cron', `exists(select 1 from cron.job where jobname = 'purge-ended-account-restrictions')`)}
`);
    s = stepMap(log);
  });

  const data = (k) => s[k]?.data;
  if (process.env.JOURNEY_DUMP) afterAll(() => console.log(JSON.stringify(s, null, 1)));
  const restricted = (k, capability) => {
    expect([k, data(k)?.hint]).toEqual([k, 'account_restricted']);
    const detail = JSON.parse(data(k).detail);
    expect([k, detail.capability]).toEqual([k, capability]);
    expect(Date.parse(detail.until)).toBeGreaterThan(Date.now());
  };
  const notRestricted = (k) => expect([k, data(k)?.hint]).not.toEqual([k, 'account_restricted']);
  const refusedWith = (k, hint) => expect([k, data(k)?.hint]).toEqual([k, hint]);

  test('installed (prelude with 20270399, or live)', () => {
    expect(data('installed')).toBe(true);
  });

  test('only an admin restricts someone else, with a reason, 1-30 days and known actions', () => {
    refusedWith('non_admin', 'admin_only');
    expect(data('anon')).toEqual(expect.objectContaining({ error: expect.any(String) }));
    refusedWith('self', 'restrict_self');
    refusedWith('short_reason', 'restrict_reason');
    refusedWith('too_long', 'restrict_duration');
    refusedWith('zero_days', 'restrict_duration');
    refusedWith('bad_cap', 'restrict_capability');
    refusedWith('no_cap', 'restrict_capability');
    expect(data('none_yet')).toBe(0);
    expect(data('r_b')).toEqual(expect.objectContaining({ capabilities: ['gatherings', 'messages'] }));
  });

  test('each capability pauses exactly its actions for that person, and says until when', () => {
    restricted('b_message', 'messages');
    restricted('b_gathering', 'gatherings');
    restricted('b_community', 'gatherings');
    notRestricted('b_friend_request');
    notRestricted('b_invite');
    expect(data('a_messages_b')).toBe('ok');
    expect(data('a_messages_c')).toBe('ok');

    restricted('c_link_message', 'links');
    expect(data('c_plain_message')).toBe('ok');
    restricted('c_bio_new_link', 'links');
    notRestricted('c_bio_keep_link');

    restricted('d_request', 'friend_requests');
    restricted('d_like', 'friend_requests');
    notRestricted('d_pass');
    restricted('d_notice', 'friend_requests');
    expect(data('d_swipes')).toEqual({ pass: true }); // the pass was recorded, the like was not
    expect(data('d_message_unrelated')).toBe('ok');

    restricted('e_invite', 'invitations');

    restricted('o_availability', 'offers');
    notRestricted('o_message_ok');
  });

  test('a paused business cannot reply to a customer request through submit_business_offer; after the lift it can', () => {
    restricted('o_reply', 'offers');
    expect(data('o_reply_row')).toEqual({ status: 'pending', description: null }); // nothing was written
    expect(Date.parse(data('o_reader'))).toBeGreaterThan(Date.now());
    expect(data('o_reader_other_cap')).toBeNull();
    expect(data('a_reader')).toBeNull(); // only the caller's own pause, never anyone else's
    expect(data('anon_reader')).toEqual(expect.objectContaining({ code: '42501' }));
    expect(data('lift_o')).toEqual({ lifted: true, already: false });
    expect(data('o_reply_after_lift')).toBe('ok');
    expect(data('o_reply_row_after_lift')).toBe('offered');
  });

  test('ends by itself; an admin can lift early (reason, once); then the action goes through', () => {
    expect(data('e_message_after_expiry')).toBe('ok');
    refusedWith('lift_non_admin', 'admin_only');
    refusedWith('lift_short', 'restrict_reason');
    expect(data('lift')).toEqual({ lifted: true, already: false });
    expect(data('lift_again')).toEqual(expect.objectContaining({ lifted: false, already: true }));
    expect(data('b_message_after_lift')).toBe('ok');
    restricted('b_gathering_still', 'gatherings'); // lifting messages leaves the other pause alone
    expect(data('lift_expired')).toEqual(expect.objectContaining({ lifted: false, already: true }));
  });

  test('auditable: append-only record, lift-only rows, no client read, admin list with who and why', () => {
    expect(data('events')).toEqual([
      { action: 'restrict', admin: true }, { action: 'restrict', admin: true }, { action: 'lift', admin: true },
    ]);
    for (const k of ['event_update', 'event_delete', 'extend_directly', 'relift_directly']) {
      expect([k, data(k)]).toEqual([k, expect.objectContaining({ error: expect.any(String) })]);
    }
    expect(data('client_reads_restrictions')).toEqual(expect.objectContaining({ code: '42501' }));
    expect(data('client_reads_events')).toEqual(expect.objectContaining({ code: '42501' }));
    expect(data('admin_list')).toEqual([
      { cap: 'gatherings', active: true, lifted: false, by: true, reason: 'Repeated spam messages to strangers' },
      { cap: 'messages', active: false, lifted: true, by: true, reason: 'Repeated spam messages to strangers' },
    ]);
    refusedWith('list_non_admin', 'admin_only');
  });

  test('no other consequence: nobody suspended, hidden or notified', () => {
    expect(data('r_a')).toEqual(expect.objectContaining({ capabilities: ['links', 'messages'] }));
    for (const p of data('nobody_suspended')) expect(p).toEqual({ suspended: false, hidden: false });
    expect(data('no_push')).toBe(0);
  });

  test('retention respects legal holds: kept while its review case is held, purged once released', () => {
    expect(data('place_hold')?.error).toBeUndefined();
    expect(data('held_purge')).toEqual({ held_kept: true, unheld_purged: true });
    expect(data('release_hold')?.error).toBeUndefined();
    expect(data('after_release')).toBe(true);
  });

  test('retention: ended over 12 months ago is purged with its record; active and recently ended stay', () => {
    expect(data('purged')).toEqual({ old: false, old_events: 0, active_kept: true, ended_recently_kept: true });
    expect(data('cron')).toBe(true);
  });
});

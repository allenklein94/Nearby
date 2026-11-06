// Admins remove a reported gathering or community (migration 20270393, staged after 20270392; run with 0348-0393 as
// JOURNEY_PRELUDE_FILE until they are live). Every attempt runs as a real signed-in person (or admin / anon) under the real role +
// JWT claims: grants, RLS, triggers. Journey: creation -> discovery -> report -> ADMIN REMOVAL -> what everyone can still reach.
//   1. Authorization: only an admin, with a written reason, on an open gathering or community report, never their own.
//   2. After a removal nobody reaches the object: attendee, host, invitee, stranger, signed-out link; chat, meet-up point, join,
//      check-in, memories, a new report. A shared-chat card and an open invite have nothing to open.
//   3. Evidence survives: every report's copy, a reported chat message's copy, a held photo; the record says who, when, why.
//   4. Everything that pointed at it closes: booking, open request, offer, plan title, pending invite.
//   5. Pushes tell the truth: removed by Nearby, no title, nothing for a past occurrence; a host's own cancel keeps its words.
//   6. A repeating gathering goes whole and can't come back. A past gathering's memories don't fall back to ordinary Stories.
//   7. Community: members lose it, chat included; its gatherings stay; a perk gated on it stops rather than opening up.
// One rolled-back transaction. Not covered: the screen (unit tests cover its rule), races (scripts/replay/content-removal-concurrency.js),
// the real API, a real phone, a device still showing a cached screen.
const { runJourney, stepMap, hasToken, actorDeclares, actorsSql } = require('./journeyHarness');

const d = hasToken ? describe : describe.skip;
const WHY = `'Fraudulent event taking payments'`;

function as(step, sub, stmt, role = 'authenticated', value = `'ok'::text`) {
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
const count = (step, sub, sql) => as(step, sub, `select count(*) into v_n from ${sql}`, 'authenticated', 'v_n');
const remove = (step, sub, report, why = WHY, role = 'authenticated') => as(step, sub, `v_res := public.admin_remove_reported_content(${report}, ${why})`, role, 'v_res');
const report = (sub, type, id, into, reason = `'Spam or scam'`) => `
  perform set_config('request.jwt.claims', json_build_object('sub', ${sub}, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into reports (reporter_id, reason, content_type, content_id) values (${sub}, ${reason}, '${type}', ${id}) returning id into ${into};
  reset role;
  perform set_config('request.jwt.claims', '', true);`;
const gathering = (id, host, title, when, extra = '', extraValues = '') => `insert into gatherings (id, host_id, title, description, scheduled_at, precise_lat, precise_lng, interest_tag, area, visibility, is_public${extra})
    values (${id}, ${host}, '${title}', 'Secret words', ${when}, 26.7123, -80.0321, 'Coffee', 'abc', 'everyone', true${extraValues});`;
const community = (id, creator, name) => `insert into communities (id, name, description, creator_id, interest_tag, is_public)
    values (${id}, '${name}', 'Community words', ${creator}, 'Coffee', true);`;

d('journey: an admin removes a reported gathering or community and nobody can reach it (20270393)', () => {
  let s;
  beforeAll(async () => {
    const people = ['v_admin', 'v_admin2', 'v_host', 'v_a', 'v_b', 'v_x', 'v_inv', 'v_biz', 'v_buyer', 'v_friend', 'v_cr', 'v_m'];
    const log = await runJourney(`
      ${actorDeclares(people)}
      v_g uuid := gen_random_uuid(); v_mine uuid := gen_random_uuid(); v_past uuid := gen_random_uuid(); v_cancel uuid := gen_random_uuid();
      v_s1 uuid := gen_random_uuid(); v_s2 uuid := gen_random_uuid(); v_s3 uuid := gen_random_uuid(); v_series uuid := gen_random_uuid();
      v_c uuid := gen_random_uuid(); v_inc uuid := gen_random_uuid(); v_p uuid := gen_random_uuid();
      v_r uuid; v_r2 uuid; v_rmine uuid; v_rpast uuid; v_rs uuid; v_rc uuid; v_rmsg uuid; v_rphoto uuid; v_rdone uuid; v_rplain uuid;
      v_msg uuid := gen_random_uuid(); v_cmsg uuid := gen_random_uuid(); v_mem uuid; v_mem2 uuid; v_pm uuid; v_pm2 uuid;
      v_req uuid := gen_random_uuid(); v_req2 uuid := gen_random_uuid(); v_o1 uuid := gen_random_uuid(); v_o2 uuid := gen_random_uuid();
      v_creq uuid := gen_random_uuid(); v_perk uuid := gen_random_uuid(); v_gperk uuid := gen_random_uuid(); v_plan uuid := gen_random_uuid();
      v_out jsonb; v_hint text; v_res jsonb; v_n bigint; v_copy text; v_copy2 text;`, `
  ${actorsSql({ people })}
  update profiles set is_admin = true where id in (v_admin, v_admin2);
  delete from private.rate_limit_rules;
  update private.trust_settings set established_min_account_age = null;
  insert into friendships (user_a, user_b, requested_by, status) values (least(v_friend, v_a), greatest(v_friend, v_a), v_friend, 'accepted');
  ${gathering('v_g', 'v_host', 'Fraud meetup', `now() + interval '3 days'`)}
  ${gathering('v_mine', 'v_admin', 'Admin own coffee', `now() + interval '3 days'`)}
  ${gathering('v_past', 'v_host', 'Past fraud meetup', `now() - interval '2 hours'`)}
  ${gathering('v_cancel', 'v_host', 'Honest coffee', `now() + interval '3 days'`)}
  ${gathering('v_s1', 'v_host', 'Weekly fraud', `now() - interval '7 days'`, ', recurrence_rule, recurring_series_id', `, 'weekly', v_series`)}
  ${gathering('v_s2', 'v_host', 'Weekly fraud', `now() + interval '1 day'`, ', recurrence_rule, recurring_series_id', `, 'weekly', v_series`)}
  ${gathering('v_s3', 'v_host', 'Weekly fraud', `now() + interval '8 days'`, ', recurrence_rule, recurring_series_id', `, 'weekly', v_series`)}
  ${community('v_c', 'v_cr', 'Fraud club')}
  ${gathering('v_inc', 'v_cr', 'Club coffee', `now() + interval '3 days'`, ', community_id', ', v_c')}
  insert into community_members (community_id, user_id) values (v_c, v_m);
  insert into community_messages (id, community_id, sender_id, body) values (v_cmsg, v_c, v_m, 'hello club');
  insert into gathering_interest (gathering_id, user_id, status) values (v_g, v_a, 'approved'), (v_g, v_buyer, 'approved'), (v_past, v_a, 'approved'), (v_past, v_b, 'approved'), (v_s2, v_a, 'approved'), (v_cancel, v_a, 'approved');
  insert into gathering_interested (gathering_id, user_id) values (v_g, v_b);
  insert into gathering_messages (id, gathering_id, sender_id, body) values (v_msg, v_g, v_a, 'pay me on the side');
  insert into social_invites (inviter_id, invitee_id, invite_type, target_id) values (v_host, v_inv, 'gathering', v_g), (v_cr, v_inv, 'community', v_c);
  insert into plans (id, plan_type, created_by, title, location_label, status, resulting_gathering_id) values (v_plan, 'gathering', v_host, 'Fraud meetup', 'Somewhere', 'confirmed', v_g);
  insert into brand_partners (id, name, active, latitude, longitude, subcategory) values (v_p, 'CR Cafe', true, 26.7, -80.0, 'Coffee');
  update profiles set managed_partner_id = v_p where id = v_biz;
  insert into business_requests (id, requester_id, raw_text, latitude, longitude, expires_at, party_size, category, gathering_id, status)
    values (v_req, v_buyer, 'table please', 26.7, -80.0, now() + interval '2 days', 2, 'Coffee', v_g, 'fulfilled'),
           (v_req2, v_host, 'open ask', 26.7, -80.0, now() + interval '2 days', 2, 'Coffee', v_g, 'open'),
           (v_creq, v_cr, 'club ask', 26.7, -80.0, now() + interval '2 days', 2, 'Coffee', null, 'open');
  update business_requests set community_id = v_c where id = v_creq;
  insert into business_request_offers (id, request_id, partner_id, status, offer_type, offer_description) values
    (v_o1, v_req, v_p, 'accepted', 'standard', 'Booked table'), (v_o2, v_req2, v_p, 'offered', 'standard', 'Open offer');
  insert into business_reservations (offer_id, status) values (v_o1, 'confirmed');
  insert into brand_offers (id, partner_id, title, reward_type, active, unlock_scope, unlock_community_id, unlock_min_members) values (v_perk, v_p, 'Club perk', 'discount', true, 'community', v_c, 1);
  insert into brand_offers (id, partner_id, title, reward_type, active, gathering_id, unlock_scope, unlock_min_members) values (v_gperk, v_p, 'Attendee perk', 'discount', true, v_g, 'gathering', 1);
  insert into stories (user_id, media_path, gathering_id, is_public, expires_at) values (v_a, v_a::text || '/memory1.jpg', v_past, true, now() + interval '1 hour') returning id into v_mem;
  insert into stories (user_id, media_path, gathering_id, is_public, expires_at) values (v_a, v_a::text || '/memory2.jpg', v_past, true, now() + interval '1 hour') returning id into v_mem2;

  ${rec('installed', `to_regprocedure('public.admin_remove_reported_content(uuid,text)') is not null`)}
  ${report('v_a', 'gathering', 'v_g', 'v_r')}
  ${report('v_b', 'gathering', 'v_g', 'v_r2')}
  ${report('v_host', 'gathering', 'v_mine', 'v_rmine')}
  ${report('v_b', 'gathering', 'v_past', 'v_rpast')}
  ${report('v_a', 'gathering', 'v_s2', 'v_rs')}
  ${report('v_m', 'community', 'v_c', 'v_rc')}
  ${report('v_b', 'story', 'v_mem', 'v_rphoto')}
  ${report('v_b', 'gathering', 'v_cancel', 'v_rdone')}
  insert into reports (reporter_id, reported_id, reason, content_type, content_id) values (v_x, v_a, 'Harassment or abuse', 'gathering_message', v_msg) returning id into v_rmsg;
  insert into reports (reporter_id, reported_id, reason) values (v_x, v_host, 'Other') returning id into v_rplain;
  select content_excerpt into v_copy from reports where id = v_r;
  select content_excerpt into v_copy2 from reports where id = v_rc;
  ${rec('photo_held', `(select count(*) from private.report_media_evidence where report_id = v_rphoto and released_at is null)`)}

  -- ===== 1. authorization =====
  ${remove('no_attendee', 'v_a', 'v_r')}
  ${remove('no_host', 'v_host', 'v_r')}
  ${remove('no_anon', 'null', 'v_r', WHY, 'anon')}
  ${as('no_direct_audit', 'v_admin', `select count(*) into v_n from private.content_removals`, 'authenticated', 'v_n')}
  ${as('no_private_fn', 'v_admin', `perform private.content_remove_community(null, v_r, v_admin, 'long enough reason')`)}
  ${as('objects_not_admin', 'v_a', `perform * from public.admin_get_report_objects(array[v_r])`)}
  ${remove('no_reason', 'v_admin', 'v_r', 'null')}
  ${remove('short_reason', 'v_admin', 'v_r', `'too short'`)}
  ${remove('unknown_report', 'v_admin', 'gen_random_uuid()')}
  ${remove('plain_report', 'v_admin', 'v_rplain')}
  ${remove('message_report', 'v_admin', 'v_rmsg')}
  ${remove('own_object', 'v_admin', 'v_rmine')}
  ${as('resolve_for_check', 'v_admin', `perform public.admin_resolve_report(v_rdone, 'no_action', 'looked fine')`)}
  ${remove('resolved_report', 'v_admin', 'v_rdone')}
  ${rec('nothing_removed_yet', `(select count(*) from private.content_removals)`)}
  ${rec('still_there', `(select count(*) from gatherings where id in (v_g, v_mine, v_cancel))`)}
  delete from push_outbox;

  -- ===== 2. removal, and what is left =====
  ${count('before_attendee', 'v_a', `gatherings where id = v_g`)}
  ${as('objects_live', 'v_admin', `select state into v_hint from public.admin_get_report_objects(array[v_r])`, 'authenticated', 'v_hint')}
  ${remove('removed', 'v_admin', 'v_r')}
  ${remove('second_admin', 'v_admin2', 'v_r2')}
  ${as('objects_removed', 'v_admin', `select to_jsonb(x) into v_res from (select state, removed_by_name is not null as named, reason, removed_at is not null as dated from public.admin_get_report_objects(array[v_r2])) x`, 'authenticated', 'v_res')}
  ${count('attendee_row', 'v_a', `gatherings where id = v_g`)}
  ${count('host_row', 'v_host', `gatherings where id = v_g`)}
  ${count('stranger_row', 'v_x', `gatherings where id = v_g`)}
  ${count('invitee_row', 'v_inv', `gatherings where id = v_g`)}
  ${count('attendee_chat', 'v_a', `gathering_messages where gathering_id = v_g`)}
  ${count('host_chat', 'v_host', `gathering_messages where gathering_id = v_g`)}
  ${as('attendee_writes', 'v_a', `insert into gathering_messages (gathering_id, sender_id, body) values (v_g, v_a, 'still here?')`)}
  ${as('attendee_point', 'v_a', `select to_jsonb(p) into v_res from public.get_gathering_meetup_point(v_g) p`, 'authenticated', 'v_res')}
  ${as('rejoin', 'v_x', `perform public.join_gathering(v_g)`)}
  ${as('check_in', 'v_a', `perform public.check_in_to_gathering(v_g)`)}
  ${as('link_preview', 'null', `v_res := public.get_public_gathering_invite_preview(v_g)`, 'anon', 'v_res')}
  ${as('report_again', 'v_x', `insert into reports (reporter_id, reason, content_type, content_id) values (v_x, 'Other', 'gathering', v_g)`)}
  ${as('host_cancels', 'v_host', `perform public.cancel_gathering(v_g)`)}
  ${count('host_attendees', 'v_host', `gathering_interest where gathering_id = v_g`)}

  -- ===== 3. evidence =====
  ${rec('copy_kept', `(select jsonb_build_object('same', content_excerpt = v_copy, 'id_ok', content_id = v_g, 'host', reported_id = v_host, 'open', not coalesce(resolved, false)) from reports where id = v_r)`)}
  ${rec('other_report_kept', `(select content_excerpt like 'Gathering: Fraud meetup%' from reports where id = v_r2)`)}
  ${rec('message_copy_kept', `(select content_excerpt from reports where id = v_rmsg)`)}
  ${rec('audit', `(select jsonb_build_object('rows', count(*), 'who', bool_and(removed_by = v_admin), 'why', max(reason), 'report', bool_and(report_id = v_r), 'owner', bool_and(owner_id = v_host), 'when', bool_and(removed_at is not null)) from private.content_removals where content_id = v_g)`)}
  ${rec('snapshot', `(select jsonb_build_object('title', snapshot ->> 'title', 'description', snapshot ->> 'description', 'attendees', jsonb_array_length(snapshot -> 'attendees'), 'point', snapshot::text ~ '26\\.71|80\\.03|precise|"area"') from private.content_removals where content_id = v_g)`)}

  -- ===== 4. links =====
  ${rec('booking', `(select jsonb_build_object('offer', (select status from business_request_offers where id = v_o1), 'reservation', (select status from business_reservations where offer_id = v_o1), 'open_offer', (select status from business_request_offers where id = v_o2), 'open_request', (select status from business_requests where id = v_req2)))`)}
  ${rec('plan', `(select jsonb_build_object('status', status, 'title', title, 'place', location_label) from plans where id = v_plan)`)}
  ${rec('invite', `(select count(*) from social_invites where target_id = v_g)`)}
  ${rec('gated_perk', `(select jsonb_build_object('active', active, 'scope', unlock_scope, 'gathering', gathering_id) from brand_offers where id = v_gperk)`)}

  -- ===== 5. pushes =====
  ${rec('pushes', `(select jsonb_agg(jsonb_build_object('to', case recipient_id when v_a then 'attendee' when v_b then 'interested' when v_host then 'host' when v_buyer then 'buyer' when v_biz then 'business' else 'other' end, 'title', title, 'body', body, 'type', data ->> 'type') order by title, body) from push_outbox)`)}
  ${rec('push_leak', `(select count(*) from push_outbox where title || body ~* 'fraud|secret|by the host')`)}
  delete from push_outbox;
  ${as('honest_cancel', 'v_host', `perform public.cancel_gathering(v_cancel)`)}
  ${rec('cancel_words', `(select body from push_outbox where recipient_id = v_a)`)}
  delete from push_outbox;

  -- ===== 6. past gathering + series =====
  ${count('friend_sees_memory_before', 'v_friend', `stories where id = v_mem2`)}
  ${remove('past_removed', 'v_admin', 'v_rpast')}
  ${rec('past_pushes', `(select jsonb_agg(jsonb_build_object('title', title)) from push_outbox)`)}
  ${count('friend_sees_memory', 'v_friend', `stories where user_id = v_a`)}
  ${count('poster_sees_memory', 'v_a', `stories where id in (v_mem, v_mem2)`)}
  ${rec('memory_files', `(select jsonb_build_object('queued', (select count(*) from private.story_file_cleanup where media_path like v_a::text || '/memory2%'), 'held', (select count(*) from private.report_media_evidence where report_id = v_rphoto and released_at is null), 'audited', (select count(*) from private.story_media_removals where gathering_id = v_past and removed_as = 'admin')))`)}
  delete from push_outbox;
  ${remove('series_removed', 'v_admin', 'v_rs')}
  ${rec('series_left', `(select count(*) from gatherings where recurring_series_id = v_series)`)}
  ${rec('series_audit', `(select count(*) from private.content_removals where series_id = v_series)`)}
  ${rec('series_pushes', `(select count(*) from push_outbox where recipient_id = v_a)`)}
  perform public.generate_next_recurring_gathering();
  ${rec('series_after_cron', `(select count(*) from gatherings where recurring_series_id = v_series)`)}
  insert into gatherings (host_id, title, scheduled_at, precise_lat, precise_lng, interest_tag, area, visibility, is_public, recurrence_rule, recurring_series_id)
    values (v_host, 'Weekly fraud', now() + interval '20 days', 26.7, -80.0, 'Coffee', 'abc', 'everyone', true, 'weekly', v_series);
  ${rec('series_insert_dropped', `(select count(*) from gatherings where recurring_series_id = v_series)`)}
  delete from push_outbox;

  -- ===== 7. community =====
  ${count('member_before', 'v_m', `community_messages where community_id = v_c`)}
  ${remove('community_removed', 'v_admin', 'v_rc', `'Scam club selling fake tickets'`)}
  ${count('member_row', 'v_m', `communities where id = v_c`)}
  ${count('creator_row', 'v_cr', `communities where id = v_c`)}
  ${count('member_chat', 'v_m', `community_messages where community_id = v_c`)}
  ${count('member_list', 'v_m', `community_members where community_id = v_c`)}
  ${as('member_writes', 'v_m', `insert into community_messages (community_id, sender_id, body) values (v_c, v_m, 'still here?')`)}
  ${as('creator_cancels', 'v_cr', `perform public.cancel_community(v_c)`)}
  ${rec('community_copy', `(select content_excerpt = v_copy2 from reports where id = v_rc)`)}
  ${rec('community_audit', `(select jsonb_build_object('why', reason, 'name', snapshot ->> 'name', 'members', jsonb_array_length(snapshot -> 'members')) from private.content_removals where content_id = v_c)`)}
  ${rec('community_gathering', `(select jsonb_build_object('alive', count(*), 'community', max(community_id::text)) from gatherings where id = v_inc)`)}
  ${rec('community_links', `(select jsonb_build_object('request', (select status from business_requests where id = v_creq), 'perk', (select jsonb_build_object('active', active, 'scope', unlock_scope) from brand_offers where id = v_perk), 'invite', (select count(*) from social_invites where target_id = v_c)))`)}
  ${rec('community_pushes', `(select jsonb_agg(jsonb_build_object('to', case recipient_id when v_m then 'member' when v_cr then 'creator' else 'other' end, 'title', title, 'type', data ->> 'type') order by title) from push_outbox)`)}

  -- ===== the report closes the normal way =====
  ${as('resolve_after', 'v_admin', `perform public.admin_resolve_report(v_r, 'action_taken', 'removed')`)}
  ${rec('resolved_after', `(select jsonb_build_object('resolved', resolved, 'copy', content_excerpt = v_copy) from reports where id = v_r)`)}
  update private.content_removals set removed_at = now() - interval '13 months' where content_id = v_g;
  perform private.purge_content_removal_snapshots();
  ${rec('purged', `(select jsonb_build_object('snapshot', snapshot, 'why', reason, 'kept_c', (select snapshot is not null from private.content_removals where content_id = v_c)) from private.content_removals where content_id = v_g)`)}
`);
    s = stepMap(log);
  });

  const data = (k) => s[k]?.data;
  const refused = (k, hint) => expect([k, data(k)]).toEqual([k, expect.objectContaining({ hint })]);
  const denied = (k) => expect([k, String(data(k)?.error)]).toEqual([k, expect.stringMatching(/permission denied/)]);

  test('installed (prelude with 20270393, or live)', () => expect(data('installed')).toBe(true));

  test('only an admin can remove: attendee, host and signed-out are refused; the record and helpers are out of reach', () => {
    refused('no_attendee', 'admin_only');
    refused('no_host', 'admin_only');
    denied('no_anon');
    denied('no_direct_audit');
    denied('no_private_fn');
    refused('objects_not_admin', 'admin_only');
  });

  test('a written reason, an open gathering or community report, and never your own', () => {
    refused('no_reason', 'removal_reason_required');
    refused('short_reason', 'removal_reason_required');
    refused('unknown_report', 'report_not_found');
    refused('plain_report', 'report_not_removable');
    refused('message_report', 'report_not_removable');
    refused('own_object', 'own_content');
    refused('resolved_report', 'report_resolved');
    expect(data('nothing_removed_yet')).toBe(0);
    expect(data('still_there')).toBe(3);
    expect(data('objects_live')).toBe('live');
  });

  test('removal: reported, then gone; a second admin on another report changes nothing and is told so', () => {
    expect(data('before_attendee')).toBe(1);
    expect(data('removed')).toEqual({ removed: 1, already: false });
    expect(data('second_admin')).toEqual({ removed: 0, already: true });
    expect(data('objects_removed')).toEqual({ state: 'removed', named: true, reason: 'Fraudulent event taking payments', dated: true });
  });

  test('nobody reaches it: attendee, host, invitee, stranger; chat, point, join, check-in, link, new report', () => {
    ['attendee_row', 'host_row', 'stranger_row', 'invitee_row', 'attendee_chat', 'host_chat', 'host_attendees'].forEach((k) => expect([k, data(k)]).toEqual([k, 0]));
    expect(data('attendee_writes').error).toBeTruthy();
    expect(data('attendee_point')).toBeNull();
    expect(data('rejoin').error).toBeTruthy();
    expect(data('check_in').error).toBeTruthy();
    expect(data('link_preview')).toBeNull();
    refused('report_again', 'report_content_mismatch');
    expect(data('host_cancels').error).toMatch(/not found/i);
  });

  test('evidence stays: every report copy, a reported message, a held photo, and who / when / why', () => {
    expect(data('photo_held')).toBe(1);
    expect(data('copy_kept')).toEqual({ same: true, id_ok: true, host: true, open: true });
    expect(data('other_report_kept')).toBe(true);
    expect(data('message_copy_kept')).toBe('pay me on the side');
    expect(data('audit')).toEqual({ rows: 1, who: true, why: 'Fraudulent event taking payments', report: true, owner: true, when: true });
    expect(data('snapshot')).toEqual({ title: 'Fraud meetup', description: 'Secret words', attendees: 2, point: false });
  });

  test('what pointed at it closes: booking, open request + offer, the plan\'s copy of the title, pending invites', () => {
    expect(data('booking')).toEqual({ offer: 'cancelled', reservation: 'cancelled', open_offer: 'cancelled', open_request: 'cancelled' });
    expect(data('plan')).toEqual({ status: 'cancelled', title: null, place: null });
    expect(data('invite')).toBe(0);
    expect(data('gated_perk')).toEqual({ active: false, scope: null, gathering: null });
  });

  test('pushes tell the truth and carry no title; a host\'s own cancel keeps its words', () => {
    const pushes = data('pushes');
    expect(pushes.filter((p) => p.to === 'attendee')).toEqual([{ to: 'attendee', title: 'A gathering was removed', body: 'A gathering you were following was removed by Nearby.', type: 'gathering_cancelled' }]);
    expect(pushes.filter((p) => p.to === 'interested').map((p) => p.title)).toEqual(['A gathering was removed']);
    expect(pushes.filter((p) => p.to === 'host').map((p) => p.title)).toEqual(['Your gathering was removed']);
    expect(pushes.filter((p) => p.to === 'buyer').map((p) => p.title).sort()).toEqual(['A gathering was removed', 'Your reservation was cancelled']);
    expect(pushes.filter((p) => p.to === 'business').map((p) => p.title)).toEqual(['A reservation was cancelled']);
    expect(data('push_leak')).toBe(0);
    expect(data('cancel_words')).toBe('"Honest coffee" has been cancelled by the host.');
  });

  test('a past gathering: its memories go with it, never falling back to ordinary Stories; a held one stays held; no push but the owner\'s', () => {
    expect(data('friend_sees_memory_before')).toBe(0);
    expect(data('past_removed')).toEqual({ removed: 1, already: false });
    expect(data('friend_sees_memory')).toBe(0);
    expect(data('poster_sees_memory')).toBe(0);
    expect(data('memory_files')).toEqual({ queued: 1, held: 1, audited: 2 });
    expect(data('past_pushes')).toEqual([{ title: 'Your gathering was removed' }]);
  });

  test('a repeating gathering goes whole, and neither the generator nor an insert brings it back', () => {
    expect(data('series_removed')).toEqual({ removed: 3, already: false });
    expect(data('series_left')).toBe(0);
    expect(data('series_audit')).toBe(3);
    expect(data('series_pushes')).toBe(1);
    expect(data('series_after_cron')).toBe(0);
    expect(data('series_insert_dropped')).toBe(0);
  });

  test('a community: gone for members and creator, chat included; its gatherings stay; its perk stops rather than opening up', () => {
    expect(data('member_before')).toBe(1);
    expect(data('community_removed')).toEqual({ removed: 1, already: false });
    ['member_row', 'creator_row', 'member_chat', 'member_list'].forEach((k) => expect([k, data(k)]).toEqual([k, 0]));
    expect(data('member_writes').error).toBeTruthy();
    expect(data('creator_cancels').error).toMatch(/not found/i);
    expect(data('community_copy')).toBe(true);
    expect(data('community_audit')).toEqual({ why: 'Scam club selling fake tickets', name: 'Fraud club', members: expect.any(Number) });
    expect(data('community_gathering')).toEqual({ alive: 1, community: null });
    expect(data('community_links')).toEqual({ request: 'cancelled', perk: { active: false, scope: null }, invite: 0 });
    expect(data('community_pushes')).toEqual([
      { to: 'member', title: 'A community was removed', type: 'community_cancelled' },
      { to: 'creator', title: 'Your community was removed', type: 'community_cancelled' },
    ]);
  });

  test('the report then resolves as usual; after 12 months the snapshot goes and who / why stays', () => {
    expect(data('resolved_after')).toEqual({ resolved: true, copy: true });
    expect(data('purged')).toEqual({ snapshot: null, why: 'Fraudulent event taking payments', kept_c: true });
  });
});

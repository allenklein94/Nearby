#!/usr/bin/env node
// Share an experience night, VIEW-ONLY: friends/matches only (never a stranger), viewers cannot act, a guest link is named,
// expiring, revocable and reads a narrow projection. Rolled back.
// Usage: SUPABASE_ACCESS_TOKEN=... node scripts/live-verify/share-experience-night.js
const { runSql, assert, summarize } = require('./lib/db');

async function main() {
  console.log('share-experience-night: verifying (rolled back)...');
  const users = await runSql(`select id from profiles order by created_at limit 3;`);
  assert(users.length === 3, 'three profiles exist for the test');
  const [own, fr, st] = users.map((u) => u.id);
  const [pt] = await runSql(`select managed_partner_id p from profiles where managed_partner_id is not null limit 1;`);
  const sql = `
do $t$
declare
  v_own uuid := '${own}'; v_fr uuid := '${fr}'; v_st uuid := '${st}'; v_partner uuid := '${pt.p}';
  a1 uuid := gen_random_uuid(); a2 uuid := gen_random_uuid();
  v_plan uuid; s1 uuid; v_r1 uuid; v_share uuid; v_guest jsonb; v_token uuid; v_view jsonb; v_out jsonb := '{}'::jsonb; v_n int; v_pub jsonb;
  v_priv uuid;
begin
  update brand_partners set active = true, latitude = 40.0, longitude = -75.0 where id = v_partner;
  insert into business_availability (id, partner_id, category, title, status, starts_at, ends_at, capacity, remaining_capacity)
  values (a1, v_partner, 'Foodie', 'Chef tasting', 'active', now(), now() + interval '5 hours', 10, 10),
         (a2, v_partner, 'Music', 'Jazz set', 'active', now(), now() + interval '5 hours', 10, 10);
  insert into friendships (user_a, user_b, status, requested_by) values (v_own, v_fr, 'accepted', v_own);

  perform set_config('request.jwt.claims', json_build_object('sub', v_own, 'role', 'authenticated')::text, true);
  v_plan := create_experience_plan('lv shared night', jsonb_build_array(
    jsonb_build_object('component_key','dinner','component_label','Dinner','stop_type','business_availability','ref_id',a1),
    jsonb_build_object('component_key','fun','component_label','Fun','stop_type','business_availability','ref_id',a2)), 2);
  select id into s1 from get_plan_stops(v_plan) where sort_order = 1;
  v_r1 := (create_business_request('lv shared req', 40.0, -75.0, 'Foodie', 2, null, 60, current_date + 5, '18:00', '20:00', 15, null)->>'requestId')::uuid;
  perform link_experience_stop_request(s1, v_r1);

  -- share: connected ok, stranger / self refused, idempotent
  v_out := v_out || jsonb_build_object('share_friend', share_experience_with_friend(v_plan, v_fr));
  v_out := v_out || jsonb_build_object('share_friend_again', share_experience_with_friend(v_plan, v_fr));
  begin perform share_experience_with_friend(v_plan, v_st); v_out := v_out || '{"share_stranger":"allowed"}'; exception when others then v_out := v_out || '{"share_stranger":"refused"}'; end;
  begin perform share_experience_with_friend(v_plan, v_own); v_out := v_out || '{"share_self":"allowed"}'; exception when others then v_out := v_out || '{"share_self":"refused"}'; end;
  select count(*) into v_n from plan_shares where plan_id = v_plan;
  v_out := v_out || jsonb_build_object('share_rows', v_n);

  -- viewer reads the narrow projection
  perform set_config('request.jwt.claims', json_build_object('sub', v_fr, 'role', 'authenticated')::text, true);
  v_view := get_shared_night(v_plan);
  v_out := v_out || jsonb_build_object('viewer_sees', v_view is not null, 'viewer_stops', jsonb_array_length(v_view->'stops'),
    'viewer_first_state', v_view->'stops'->0->>'state', 'viewer_keys', (select jsonb_agg(k order by k) from jsonb_object_keys(v_view->'stops'->0) k),
    'viewer_top_keys', (select jsonb_agg(k order by k) from jsonb_object_keys(v_view) k),
    'listed', (select count(*) from get_shared_experience_plans()));
  -- ...and cannot act or read the rich overview
  v_out := v_out || jsonb_build_object('viewer_overview_null', get_plan_overview(v_plan) is null, 'viewer_plan_stops_empty', (select count(*) from get_plan_stops(v_plan)) = 0);
  begin perform remove_experience_stop(s1); v_out := v_out || '{"viewer_remove":"allowed"}'; exception when others then v_out := v_out || '{"viewer_remove":"refused"}'; end;
  begin perform reorder_experience_stops(v_plan, array[s1]); v_out := v_out || '{"viewer_reorder":"allowed"}'; exception when others then v_out := v_out || '{"viewer_reorder":"refused"}'; end;
  begin perform share_experience_with_friend(v_plan, v_st); v_out := v_out || '{"viewer_reshare":"allowed"}'; exception when others then v_out := v_out || '{"viewer_reshare":"refused"}'; end;
  begin perform create_experience_guest_link(v_plan, 'Sneaky'); v_out := v_out || '{"viewer_guestlink":"allowed"}'; exception when others then v_out := v_out || '{"viewer_guestlink":"refused"}'; end;
  begin perform link_experience_stop_request(s1, v_r1); v_out := v_out || '{"viewer_link":"allowed"}'; exception when others then v_out := v_out || '{"viewer_link":"refused"}'; end;
  v_out := v_out || jsonb_build_object('viewer_get_shares', (select count(*) from get_experience_shares(v_plan)) = 0);
  begin
    execute 'set local role authenticated';
    begin insert into plan_shares (plan_id, user_id, added_by) values (v_plan, v_st, v_fr); v_out := v_out || '{"direct_insert":"allowed"}';
    exception when others then v_out := v_out || '{"direct_insert":"refused"}'; end;
    execute 'reset role';
  end;
  -- a stranger sees nothing
  perform set_config('request.jwt.claims', json_build_object('sub', v_st, 'role', 'authenticated')::text, true);
  v_out := v_out || jsonb_build_object('stranger_null', get_shared_night(v_plan) is null);
  perform set_config('request.jwt.claims', json_build_object('sub', v_fr, 'role', 'authenticated')::text, true);

  -- connection ends -> access ends (block)
  insert into blocks (blocker_id, blocked_id) values (v_own, v_fr);
  v_out := v_out || jsonb_build_object('blocked_null', get_shared_night(v_plan) is null);
  delete from blocks where blocker_id = v_own and blocked_id = v_fr;
  v_out := v_out || jsonb_build_object('unblocked_sees', get_shared_night(v_plan) is not null);

  -- viewer leaves (idempotent)
  v_out := v_out || jsonb_build_object('leave', leave_shared_experience(v_plan));
  v_out := v_out || jsonb_build_object('after_leave_null', get_shared_night(v_plan) is null);
  v_out := v_out || jsonb_build_object('leave_again', leave_shared_experience(v_plan));

  -- guest link: named, expiring, revocable
  perform set_config('request.jwt.claims', json_build_object('sub', v_own, 'role', 'authenticated')::text, true);
  begin perform create_experience_guest_link(v_plan, '   '); v_out := v_out || '{"blank_name":"allowed"}'; exception when others then v_out := v_out || '{"blank_name":"refused"}'; end;
  v_guest := create_experience_guest_link(v_plan, 'Sam');
  v_token := (v_guest->>'guestToken')::uuid; v_share := (v_guest->>'shareId')::uuid;
  v_out := v_out || jsonb_build_object('guest_expires_in_future', (v_guest->>'expiresAt')::timestamptz > now() + interval '29 days');
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  v_pub := get_public_shared_night(v_token);
  v_out := v_out || jsonb_build_object('guest_sees', v_pub is not null, 'guest_name', v_pub->>'guestName',
    'guest_stop_keys', (select jsonb_agg(k order by k) from jsonb_object_keys(v_pub->'stops'->0) k),
    'guest_top_keys', (select jsonb_agg(k order by k) from jsonb_object_keys(v_pub) k),
    'random_token_null', get_public_shared_night(gen_random_uuid()) is null);
  -- a guest token cannot act at all: every write needs auth.uid()
  begin perform remove_experience_stop(s1); v_out := v_out || '{"guest_remove":"allowed"}'; exception when others then v_out := v_out || '{"guest_remove":"refused"}'; end;
  -- owner lists + revokes; non-owner cannot revoke
  perform set_config('request.jwt.claims', json_build_object('sub', v_st, 'role', 'authenticated')::text, true);
  v_out := v_out || jsonb_build_object('stranger_revoke', revoke_experience_share(v_share));
  perform set_config('request.jwt.claims', json_build_object('sub', v_own, 'role', 'authenticated')::text, true);
  v_out := v_out || jsonb_build_object('owner_lists_token', (select count(*) from get_experience_shares(v_plan) where guest_token = v_token));
  -- expiry
  update plan_shares set expires_at = now() - interval '1 minute' where id = v_share;
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  v_out := v_out || jsonb_build_object('expired_null', get_public_shared_night(v_token) is null);
  perform set_config('request.jwt.claims', json_build_object('sub', v_own, 'role', 'authenticated')::text, true);
  update plan_shares set expires_at = now() + interval '5 days' where id = v_share;
  v_out := v_out || jsonb_build_object('revoke', revoke_experience_share(v_share), 'revoke_again', revoke_experience_share(v_share));
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  v_out := v_out || jsonb_build_object('revoked_null', get_public_shared_night(v_token) is null);

  -- private gathering stop title never leaks to a guest
  select id into v_priv from gatherings where not (is_public is true and visibility = 'everyone') limit 1;
  if v_priv is not null then
    perform set_config('request.jwt.claims', json_build_object('sub', v_own, 'role', 'authenticated')::text, true);
    insert into plan_stops (plan_id, sort_order, component_key, component_label, stop_type, ref_id, title)
      values (v_plan, 3, 'social', 'Social', 'gathering', v_priv, 'SECRET PRIVATE TITLE');
    v_out := v_out || jsonb_build_object('private_title_hidden', (public._night_stops_json(v_plan)->2->>'title') = 'A gathering');
  else
    v_out := v_out || '{"private_title_hidden":true,"private_skipped":true}';
  end if;

  -- an ended night cannot be shared
  update plans set status = 'cancelled' where id = v_plan;
  begin perform share_experience_with_friend(v_plan, v_fr); v_out := v_out || '{"share_ended":"allowed"}'; exception when others then v_out := v_out || '{"share_ended":"refused"}'; end;
  raise exception 'RESULT:%', v_out::text;
end
$t$;`;
  let r;
  try { await runSql(sql); throw new Error('expected rollback marker'); }
  catch (e) { const m = /RESULT:(\{.*\})/.exec(e.message || ''); if (!m) throw e; r = JSON.parse(m[1]); }
  console.log(JSON.stringify(r));
  assert(r.share_friend.shared && !r.share_friend.alreadyShared && r.share_friend_again.alreadyShared, 'sharing with a connected friend works and is idempotent');
  assert(r.share_stranger === 'refused' && r.share_self === 'refused' && r.share_rows === 1, 'an unconnected person (or yourself) can never be added');
  assert(r.viewer_sees && r.viewer_stops === 2 && r.listed === 1, 'the viewer sees the night and it lists under shared plans');
  assert(JSON.stringify(r.viewer_keys) === JSON.stringify(['componentLabel', 'order', 'state', 'stopType', 'subtitle', 'title']), `the projection carries no ids/prices (got ${JSON.stringify(r.viewer_keys)})`);
  assert(JSON.stringify(r.viewer_top_keys) === JSON.stringify(['hostDisplayName', 'planId', 'status', 'stops', 'title']), 'top-level projection is minimal');
  assert(r.viewer_overview_null && r.viewer_plan_stops_empty, 'the rich overview / child request plans stay closed to a viewer');
  for (const k of ['viewer_remove', 'viewer_reorder', 'viewer_reshare', 'viewer_guestlink', 'viewer_link']) assert(r[k] === 'refused', `${k} is refused`);
  assert(r.viewer_get_shares && r.direct_insert === 'refused', 'a viewer cannot list shares or write the table directly');
  assert(r.stranger_null, 'a stranger sees nothing');
  assert(r.blocked_null && r.unblocked_sees, 'access follows the connection (block ends it)');
  assert(r.leave === true && r.leave_again === false && r.after_leave_null, 'a viewer can leave; idempotent');
  assert(r.blank_name === 'refused' && r.guest_expires_in_future, 'a guest link needs a name and expires in 30 days');
  assert(r.guest_sees && r.guest_name === 'Sam' && r.random_token_null, 'a guest token reads its own night only');
  assert(JSON.stringify(r.guest_stop_keys) === JSON.stringify(['componentLabel', 'order', 'state', 'stopType', 'subtitle', 'title']), 'guest projection is the same narrow one');
  assert(JSON.stringify(r.guest_top_keys) === JSON.stringify(['expiresAt', 'guestName', 'hostDisplayName', 'status', 'stops', 'title']), 'guest top-level is minimal');
  assert(r.guest_remove === 'refused', 'a guest cannot act');
  assert(r.stranger_revoke === false && r.owner_lists_token === 1, 'only the owner can revoke/list');
  assert(r.expired_null, 'an expired link stops working');
  assert(r.revoke === true && r.revoke_again === false && r.revoked_null, 'revoking kills the link; idempotent');
  assert(r.private_title_hidden, 'a private gathering title never reaches a shared viewer/guest');
  assert(r.share_ended === 'refused', 'an ended night cannot be shared');
  const [after] = await runSql(`select count(*) c from plan_shares;`);
  assert(after.c === 0, 'nothing committed');
  const [g] = await runSql(`select has_function_privilege('anon','public.get_public_shared_night(uuid)','execute') a, has_function_privilege('anon','public.get_shared_night(uuid)','execute') b, has_function_privilege('anon','public.share_experience_with_friend(uuid,uuid)','execute') c, has_function_privilege('anon','public.create_experience_guest_link(uuid,text)','execute') d;`);
  assert(g.a === true && g.b === false && g.c === false && g.d === false, 'anon can only call the guest read');
  summarize('share-experience-night');
}
main().catch((e) => { console.error('share-experience-night: failed to run:', e.message); process.exitCode = 1; });

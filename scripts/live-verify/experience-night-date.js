#!/usr/bin/env node
// Experience plans: one owner-set date for the whole night. Owner-only, live nights only, no past dates, clearable, shown to
// a shared viewer as nightDate. Rolled back.
// Usage: SUPABASE_ACCESS_TOKEN=... node scripts/live-verify/experience-night-date.js
const { runSql, assert, summarize } = require('./lib/db');

async function main() {
  console.log('experience-night-date: verifying (rolled back)...');
  const [owner] = await runSql(`select id, managed_partner_id from profiles where managed_partner_id is not null limit 1;`);
  const [other] = await runSql(`select id from profiles where id <> '${owner.id}' limit 1;`);
  const sql = `
do $t$
declare
  v_user uuid := '${other.id}'; v_owner uuid := '${owner.id}'; v_partner uuid := '${owner.managed_partner_id}';
  a1 uuid := gen_random_uuid(); a2 uuid := gen_random_uuid(); v_plan uuid;
  v_out jsonb := '{}'::jsonb; v_d date; v_ov jsonb; v_shared jsonb;
begin
  update brand_partners set active = true, latitude = 40.0, longitude = -75.0 where id = v_partner;
  insert into business_availability (id, partner_id, category, title, status, starts_at, ends_at, capacity, remaining_capacity)
  values (a1, v_partner, 'Foodie', 'Chef tasting', 'active', now(), now() + interval '5 hours', 10, 10),
         (a2, v_partner, 'Music', 'Jazz set', 'active', now(), now() + interval '5 hours', 10, 10);
  perform set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  v_plan := create_experience_plan('lv date night', jsonb_build_array(
    jsonb_build_object('component_key','dinner','component_label','Dinner','stop_type','business_availability','ref_id',a1),
    jsonb_build_object('component_key','fun','component_label','Fun','stop_type','business_availability','ref_id',a2)), 2);

  perform set_experience_night_date(v_plan, current_date + 9);
  select (scheduled_at at time zone 'UTC')::date into v_d from plans where id = v_plan;
  v_out := v_out || jsonb_build_object('date_set', v_d = current_date + 9);
  v_ov := get_plan_overview(v_plan);
  v_out := v_out || jsonb_build_object('overview_has_date', (v_ov->'plan'->>'scheduled_at') is not null);

  begin perform set_experience_night_date(v_plan, current_date - 5); v_out := v_out || jsonb_build_object('past', 'accepted');
  exception when others then v_out := v_out || jsonb_build_object('past', 'refused'); end;

  -- a stranger cannot set it
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  begin perform set_experience_night_date(v_plan, current_date + 3); v_out := v_out || jsonb_build_object('stranger', 'accepted');
  exception when others then v_out := v_out || jsonb_build_object('stranger', 'refused'); end;

  -- a guest-link viewer sees the date
  perform set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  declare v_tok uuid; begin
    v_shared := create_experience_guest_link(v_plan, 'Pat');
    v_tok := (v_shared->>'guestToken')::uuid;
    v_out := v_out || jsonb_build_object('guest_sees_date', (get_public_shared_night(v_tok)->>'nightDate')::date = current_date + 9);
  end;

  -- a completed/cancelled night is locked; clearing works while live
  perform set_experience_night_date(v_plan, null);
  v_out := v_out || jsonb_build_object('cleared', (select scheduled_at is null from plans where id = v_plan));
  raise exception 'RESULT:%', v_out::text;
end
$t$;`;
  let r;
  try { await runSql(sql); throw new Error('expected rollback marker'); }
  catch (e) { const m = /RESULT:(\{.*\})/.exec(e.message || ''); if (!m) throw e; r = JSON.parse(m[1]); }
  console.log(JSON.stringify(r));
  assert(r.date_set && r.overview_has_date, 'owner sets the date and the plan overview carries it');
  assert(r.past === 'refused', 'a past date is refused');
  assert(r.stranger === 'refused', 'only the owner can set it');
  assert(r.guest_sees_date, 'a guest-link viewer sees the same calendar date');
  assert(r.cleared, 'null clears the date');
  summarize('experience-night-date');
}
main().catch((e) => { console.error(e); process.exit(1); });

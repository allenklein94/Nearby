#!/usr/bin/env node
// Creative library + structured offer validity. A saved creative supplies the offer's media (owner-only, archived/foreign refused),
// valid_until must be future, accept refuses an expired offer, the sweep expires it. Rolled back.
// Usage: SUPABASE_ACCESS_TOKEN=... node scripts/live-verify/creative-library-validity.js
const { runSql, assert, summarize } = require('./lib/db');

async function main() {
  console.log('creative-library-validity: verifying (rolled back)...');
  const [owner] = await runSql(`select id, managed_partner_id from profiles where managed_partner_id is not null limit 1;`);
  const [other] = await runSql(`select id from profiles where id <> '${owner.id}' limit 1;`);
  const sql = `
do $t$
declare
  v_user uuid := '${other.id}'; v_owner uuid := '${owner.id}'; v_partner uuid := '${owner.managed_partner_id}';
  v_r1 uuid; v_r2 uuid; v_r3 uuid; v_r4 uuid; v_c uuid; v_c2 uuid; v_foreign uuid; v_offer uuid; v_out jsonb := '{}'::jsonb; v_row record; v_n int;
begin
  update brand_partners set active = true, latitude = 40.0, longitude = -75.0 where id = v_partner;
  insert into business_creatives (partner_id, media_type, media_path, poster_path)
    values (v_partner, 'video', v_partner::text || '/offer-v.mov', v_partner::text || '/offer-f.jpg') returning id into v_c;
  insert into business_creatives (partner_id, media_type, media_path, archived_at)
    values (v_partner, 'image', v_partner::text || '/offer-old.jpg', now()) returning id into v_c2;
  -- a creative that belongs to a DIFFERENT business
  declare v_other uuid := gen_random_uuid(); begin
    insert into brand_partners select (jsonb_populate_record(null::brand_partners, to_jsonb(bp) || jsonb_build_object('id', v_other, 'name', 'lv other partner'))).* from brand_partners bp where bp.id = v_partner;
    insert into business_creatives (partner_id, media_type, media_path) values (v_other, 'image', v_other::text || '/offer-x.jpg') returning id into v_foreign;
  end;

  perform set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  v_r1 := (create_business_request('lv cr one', 40.0, -75.0, 'Coffee', 2, null, 30, current_date + 5, '10:00', '12:00', 15, null)->>'requestId')::uuid;
  v_r2 := (create_business_request('lv cr two', 40.0, -75.0, 'Coffee', 2, null, 30, current_date + 5, '10:00', '12:00', 15, null)->>'requestId')::uuid;
  v_r4 := (create_business_request('lv cr four', 40.0, -75.0, 'Coffee', 2, null, 30, current_date + 5, '10:00', '12:00', 15, null)->>'requestId')::uuid;
  v_r3 := (create_business_request('lv cr three', 40.0, -75.0, 'Coffee', 2, null, 30, current_date + 5, '10:00', '12:00', 15, null)->>'requestId')::uuid;

  -- library is owner-read only: the requester (not the owner) sees nothing through RLS
  set local role authenticated;
  select count(*) into v_n from business_creatives where partner_id = v_partner;
  reset role;
  v_out := v_out || jsonb_build_object('stranger_sees', v_n);

  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  begin perform submit_business_offer(v_r1, 'standard', 'lv foreign creative', null, null, null, null, null, null, '{}', false, null, null, null, v_foreign, null);
    v_out := v_out || jsonb_build_object('foreign_creative', 'accepted'); exception when others then v_out := v_out || jsonb_build_object('foreign_creative', 'refused'); end;
  begin perform submit_business_offer(v_r1, 'standard', 'lv archived creative', null, null, null, null, null, null, '{}', false, null, null, null, v_c2, null);
    v_out := v_out || jsonb_build_object('archived_creative', 'accepted'); exception when others then v_out := v_out || jsonb_build_object('archived_creative', 'refused'); end;
  begin perform submit_business_offer(v_r1, 'standard', 'lv past end', null, null, null, null, null, null, '{}', false, null, null, null, null, now() - interval '1 hour');
    v_out := v_out || jsonb_build_object('past_end', 'accepted'); exception when others then v_out := v_out || jsonb_build_object('past_end', 'refused'); end;
  begin perform submit_business_offer(v_r1, 'standard', 'lv far end', null, null, null, null, null, null, '{}', false, null, null, null, null, now() + interval '90 days');
    v_out := v_out || jsonb_build_object('far_end', 'accepted'); exception when others then v_out := v_out || jsonb_build_object('far_end', 'refused'); end;

  -- a saved creative supplies the media; the (bogus) media passed alongside is ignored
  perform submit_business_offer(v_r4, 'standard', 'lv creative ok', null, null, null, 'junk/ignored.jpg', 'image', null, '{}', false, null, null, null, v_c, now() + interval '3 hours');
  select media_path, media_type, media_poster_path, creative_id, valid_until into v_row from business_request_offers where request_id = v_r4 and partner_id = v_partner;
  v_out := v_out || jsonb_build_object('media_from_creative', v_row.media_path = v_partner::text || '/offer-v.mov' and v_row.media_type = 'video' and v_row.media_poster_path = v_partner::text || '/offer-f.jpg' and v_row.creative_id = v_c, 'valid_saved', v_row.valid_until is not null);

  -- accepting while valid works; an expired offer cannot be accepted
  perform submit_business_offer(v_r2, 'standard', 'lv soon expiring', null, null, null, null, null, null, '{}', false, null, null, null, null, now() + interval '2 hours');
  select id into v_offer from business_request_offers where request_id = v_r2 and partner_id = v_partner;
  update business_request_offers set valid_until = now() - interval '1 minute' where id = v_offer;
  perform set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  begin perform accept_business_offer(v_offer); v_out := v_out || jsonb_build_object('accept_expired', 'accepted');
  exception when others then v_out := v_out || jsonb_build_object('accept_expired', sqlerrm); end;

  perform expire_stale_business_requests();
  select status into v_row from business_request_offers where id = v_offer;
  v_out := v_out || jsonb_build_object('swept', v_row.status);

  -- a still-valid offer is accepted normally
  select id into v_offer from business_request_offers where request_id = v_r4 and partner_id = v_partner;
  perform accept_business_offer(v_offer);
  v_out := v_out || jsonb_build_object('accept_valid', (select status from business_request_offers where id = v_offer));

  v_out := v_out || jsonb_build_object('overloads', (select count(*) from pg_proc where proname in ('submit_business_offer','accept_business_offer')));
  raise exception 'RESULT:%', v_out::text;
end
$t$;`;
  let r;
  try { await runSql(sql); throw new Error('expected rollback marker'); }
  catch (e) { const m = /RESULT:(\{.*\})/.exec(e.message || ''); if (!m) throw e; r = JSON.parse(m[1]); }
  console.log(JSON.stringify(r));
  assert(r.stranger_sees === 0, 'a non-owner cannot read the creative library');
  assert(r.foreign_creative === 'refused' && r.archived_creative === 'refused', "another business's or an archived creative is refused");
  assert(r.past_end === 'refused' && r.far_end === 'refused', 'an end time must be in the future and within 30 days');
  assert(r.media_from_creative && r.valid_saved, 'a saved creative supplies the media and the end time is stored');
  assert(/expired/i.test(r.accept_expired), 'an expired offer cannot be accepted');
  assert(r.swept === 'expired', 'the sweep expires an offer past its end time');
  assert(r.accept_valid === 'accepted', 'a still-valid offer is accepted normally');
  assert(Number(r.overloads) === 2, 'one overload each of submit/accept');
  summarize('creative-library-validity');
}
main().catch((e) => { console.error(e); process.exit(1); });

#!/usr/bin/env node
// Rich offers Phase 2: submit_business_offer carries redemption instructions + a video poster; a video with no poster and media
// outside the business's own folder are refused; a reviewer approving a held response publishes the same fields. Rolled back.
// Usage: SUPABASE_ACCESS_TOKEN=... node scripts/live-verify/rich-offer-media.js
const { runSql, assert, summarize } = require('./lib/db');

async function main() {
  console.log('rich-offer-media: verifying (rolled back)...');
  const [owner] = await runSql(`select id, managed_partner_id from profiles where managed_partner_id is not null limit 1;`);
  const [other] = await runSql(`select id from profiles where id <> '${owner.id}' limit 1;`);
  const sql = `
do $t$
declare
  v_user uuid := '${other.id}'; v_owner uuid := '${owner.id}'; v_partner uuid := '${owner.managed_partner_id}';
  v_r1 uuid; v_r2 uuid; v_r3 uuid; v_out jsonb := '{}'::jsonb; v_row record; v_sid uuid;
begin
  update brand_partners set active = true, latitude = 40.0, longitude = -75.0 where id = v_partner;
  perform set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  v_r1 := (create_business_request('lv rich one', 40.0, -75.0, 'Coffee', 2, null, 30, current_date + 5, '10:00', '12:00', 15, null)->>'requestId')::uuid;
  v_r2 := (create_business_request('lv rich two', 40.0, -75.0, 'Coffee', 2, null, 30, current_date + 5, '10:00', '12:00', 15, null)->>'requestId')::uuid;
  v_r3 := (create_business_request('lv rich three', 40.0, -75.0, 'Coffee', 2, null, 30, current_date + 5, '10:00', '12:00', 15, null)->>'requestId')::uuid;
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);

  begin perform submit_business_offer(v_r1, 'standard', 'lv video', null, null, null, v_partner::text || '/offer-1.mov', 'video', null, '{}', false, null, 'x', null);
    v_out := v_out || jsonb_build_object('video_no_poster', 'accepted');
  exception when others then v_out := v_out || jsonb_build_object('video_no_poster', 'refused'); end;

  begin perform submit_business_offer(v_r1, 'standard', 'lv foreign', null, null, null, gen_random_uuid()::text || '/offer-1.jpg', 'image', null, '{}', false, null, null, null);
    v_out := v_out || jsonb_build_object('foreign_media', 'accepted');
  exception when others then v_out := v_out || jsonb_build_object('foreign_media', 'refused'); end;

  begin perform submit_business_offer(v_r1, 'standard', 'lv long', null, null, null, null, null, null, '{}', false, null, repeat('x', 501), null);
    v_out := v_out || jsonb_build_object('too_long', 'accepted');
  exception when others then v_out := v_out || jsonb_build_object('too_long', 'refused'); end;

  perform submit_business_offer(v_r1, 'standard', 'lv video ok', null, null, null, v_partner::text || '/offer-1.mov', 'video', 'Two coffees', '{}', false, null, '  Show this at the counter ', v_partner::text || '/offer-frame.jpg');
  select media_poster_path, redemption_instructions, media_type into v_row from business_request_offers where request_id = v_r1 and partner_id = v_partner;
  v_out := v_out || jsonb_build_object('poster_saved', v_row.media_poster_path = v_partner::text || '/offer-frame.jpg', 'redemption_saved', v_row.redemption_instructions = 'Show this at the counter');

  -- an image offer never keeps a poster
  perform submit_business_offer(v_r2, 'standard', 'lv image', null, null, null, v_partner::text || '/offer-2.jpg', 'image', null, '{}', false, null, null, v_partner::text || '/stray.jpg');
  select media_poster_path into v_row from business_request_offers where request_id = v_r2 and partner_id = v_partner;
  v_out := v_out || jsonb_build_object('image_no_poster', v_row.media_poster_path is null);

  -- a plain offer still works with the old argument shape (defaults)
  perform submit_business_offer(v_r3, 'standard', 'lv plain');
  v_out := v_out || jsonb_build_object('plain_ok', exists (select 1 from business_request_offers where request_id = v_r3 and partner_id = v_partner and status = 'offered'));

  v_out := v_out || jsonb_build_object('overloads', (select count(*) from pg_proc where proname = 'submit_business_offer'));
  raise exception 'RESULT:%', v_out::text;
end
$t$;`;
  let r;
  try { await runSql(sql); throw new Error('expected rollback marker'); }
  catch (e) { const m = /RESULT:(\{.*\})/.exec(e.message || ''); if (!m) throw e; r = JSON.parse(m[1]); }
  console.log(JSON.stringify(r));
  assert(r.video_no_poster === 'refused', 'a video without a preview image is refused');
  assert(r.foreign_media === 'refused', "media outside the business's own folder is refused");
  assert(r.too_long === 'refused', 'redemption instructions over 500 chars are refused');
  assert(r.poster_saved && r.redemption_saved, 'poster + trimmed redemption instructions are saved on a video offer');
  assert(r.image_no_poster, 'an image offer keeps no poster');
  assert(r.plain_ok, 'a plain offer still works');
  assert(Number(r.overloads) === 1, 'exactly one submit_business_offer overload');
  summarize('rich-offer-media');
}
main().catch((e) => { console.error(e); process.exit(1); });

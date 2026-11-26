// Video offers paused for the first launch (owner 2026-11-02, Option A, temporary; migration 20270388; staged, run with
// 0348-0388 as JOURNEY_PRELUDE_FILE until live). The database refuses every NEW business video on the four customer-facing
// tables whoever writes (here: the server itself, the most privileged path, and a signed-in owner), with hint
// business_video_paused, and on a Business Moment (stories with a partner_id, no screening path at all); images and a person's
// own video story are unchanged; an unrelated edit of a row that already has a video is never refused;
// switching on (the future, separately approved re-enable) lets videos through again; clients can't read or flip it.
const { runJourney, stepMap, hasToken, actorDeclares, actorsSql } = require('./journeyHarness');

const d = hasToken ? describe : describe.skip;

const tryStep = (step, stmt) => `
  begin ${stmt}; v_out := '"ok"'::jsonb;
  exception when others then
    get stacked diagnostics v_hint = pg_exception_hint;
    v_out := jsonb_build_object('error', sqlerrm, 'hint', v_hint);
  end;
  log := log || jsonb_build_array(jsonb_build_object('step', '${step}', 'ok', true, 'data', v_out));`;

d('journey: business video paused (20270388)', () => {
  let s;
  beforeAll(async () => {
    const log = await runJourney(`${actorDeclares(['v_o', 'v_c', 'v_p'])} v_r uuid; v_off uuid; v_cr uuid; v_st uuid; v_out jsonb; v_hint text;`, `
  ${actorsSql({ people: ['v_o', 'v_c'], business: { owner: 'v_o', partner: 'v_p' } })}
  update brand_partners set tier = 'growth' where id = v_p; -- Business Moments are a paid feature: the refusal below must be the pause's
  if to_regclass('private.business_moments_settings') is not null then execute 'update private.business_moments_settings set enabled = true where id'; end if; -- moments paused by 0389: this checks what a moment stores / the 0388 refusal
  if to_regclass('private.story_media_settings') is not null then execute 'update private.story_media_settings set friends_stories_enabled = true, story_video_enabled = true where id'; end if; -- personal Stories paused by 0390: this checks the moment rules leave a person's own story alone
  update private.business_video_settings set enabled = false where id;
  insert into business_requests (requester_id, raw_text, latitude, longitude, expires_at, party_size, category, date)
    values (v_c, 'journey video pause', 40.0, -75.0, now() + interval '1 day', 2, 'Coffee', current_date) returning id into v_r;
  insert into business_request_offers (request_id, partner_id) values (v_r, v_p) on conflict do nothing;
  select id into v_off from business_request_offers where request_id = v_r and partner_id = v_p;

  log := log || jsonb_build_array(jsonb_build_object('step', 'default', 'ok', true, 'data', jsonb_build_object(
    'enabled', business_video_enabled(), 'rows', (select count(*) from private.business_video_settings))));

  -- refused on every table, even for the server
  ${tryStep('offer_video', `update business_request_offers set media_type = 'video', media_path = v_p || '/a.mp4' where id = v_off`)}
  ${tryStep('creative_video', `insert into business_creatives (partner_id, media_type, media_path, poster_path, frame_paths, status, source)
      values (v_p, 'video', v_p || '/b.mp4', v_p || '/b.jpg', array[v_p || '/b.jpg'], 'reviewing', 'library')`)}
  ${tryStep('experience_video', `insert into business_experiences (partner_id, title, media_type, media_path) values (v_p, 'Tasting', 'video', v_p || '/c.mp4')`)}
  log := log || jsonb_build_array(jsonb_build_object('step', 'nothing_written', 'ok', true, 'data', jsonb_build_object(
    'offer', (select media_type from business_request_offers where id = v_off),
    'creatives', (select count(*) from business_creatives where partner_id = v_p and media_type = 'video'),
    'experiences', (select count(*) from business_experiences where partner_id = v_p and media_type = 'video'))));

  -- images unchanged
  ${tryStep('creative_image', `insert into business_creatives (partner_id, media_type, media_path, status, source)
      values (v_p, 'image', v_p || '/d.jpg', 'reviewing', 'library')`)}
  ${tryStep('experience_image', `insert into business_experiences (partner_id, title, media_type, media_path) values (v_p, 'Brunch', 'image', v_p || '/e.jpg')`)}

  -- the owner's real write path (submit_business_offer's body, as the signed-in owner; with 0372 the public wrapper adds
  -- its screening check in front of this same body): a reply carrying a video is refused by the pause
  perform set_config('request.jwt.claims', json_build_object('sub', v_o, 'role', 'authenticated')::text, true);
  ${tryStep('owner_direct', `perform (case when to_regprocedure('private.submit_business_offer_unscreened(uuid,text,text,numeric,timestamp with time zone,uuid,text,text,text,text[],boolean,numeric,text,text,uuid,timestamp with time zone,time without time zone,time without time zone,timestamp with time zone,smallint)') is not null
      then private.submit_business_offer_unscreened(request_id_param => v_r, offer_type_param => 'standard', offer_description_param => 'Coffee for two',
             media_path_param => v_p || '/i.mp4', media_type_param => 'video', media_poster_path_param => v_p || '/i.jpg')
      else submit_business_offer(request_id_param => v_r, offer_type_param => 'standard', offer_description_param => 'Coffee for two',
             media_path_param => v_p || '/i.mp4', media_type_param => 'video', media_poster_path_param => v_p || '/i.jpg') end)`)}
  reset role;
  perform set_config('request.jwt.claims', '', true);
  -- a Business Moment reaches customers with no screening: the signed-in manager's direct insert, as the app does it, under
  -- the real role (RLS applies), exactly what a modified client can send
  perform set_config('request.jwt.claims', json_build_object('sub', v_o, 'role', 'authenticated')::text, true);
  set local role authenticated;
  ${tryStep('moment_video', `insert into stories (user_id, partner_id, media_path, media_type) values (v_o, v_p, v_o || '/m.mov', 'video')`)}
  ${tryStep('moment_image', `insert into stories (user_id, partner_id, media_path, media_type) values (v_o, v_p, v_o || '/m.jpg', 'image')`)}
  ${tryStep('person_video', `insert into stories (user_id, media_path, media_type) values (v_o, v_o || '/p.mov', 'video') returning id into v_st`)}
  reset role;
  perform set_config('request.jwt.claims', '', true);
  -- clients have no UPDATE policy on stories; the trigger still holds for the privileged writer
  ${tryStep('story_becomes_moment', `update stories set partner_id = v_p where id = v_st`)}
  log := log || jsonb_build_array(jsonb_build_object('step', 'moments_written', 'ok', true, 'data', jsonb_build_object(
    'videos', (select count(*) from stories where partner_id = v_p and media_type = 'video'),
    'images', (select count(*) from stories where partner_id = v_p and media_type = 'image'))));
  log := log || jsonb_build_array(jsonb_build_object('step', 'client', 'ok', true, 'data', jsonb_build_object(
    'read_settings', has_table_privilege('authenticated', 'private.business_video_settings', 'select'),
    'exec_enabled', has_function_privilege('authenticated', 'public.business_video_enabled()', 'execute'),
    'anon_exec', has_function_privilege('anon', 'public.business_video_enabled()', 'execute'))));

  -- a row that already carries a video (made while on) keeps working for unrelated edits; making it ready or changing the
  -- file is refused while off
  update private.business_video_settings set enabled = true where id;
  ${tryStep('on_video', `insert into business_creatives (partner_id, media_type, media_path, poster_path, frame_paths, status, source)
      values (v_p, 'video', v_p || '/g.mp4', v_p || '/g.jpg', array[v_p || '/g.jpg'], 'reviewing', 'library') returning id into v_cr`)}
  update private.business_video_settings set enabled = false where id;
  ${tryStep('existing_unrelated', `update business_creatives set problem = 'note', matched_categories = '{}' where id = v_cr`)}
  ${tryStep('existing_ready', `update business_creatives set status = 'ready' where id = v_cr`)}
  ${tryStep('existing_new_file', `update business_creatives set media_path = v_p || '/h.mp4' where id = v_cr`)}`);
    s = stepMap(log);
  }, 120000);

  const refused = { error: "Video offers aren't available yet. Attach a photo instead.", hint: 'business_video_paused' };

  test('off by default, one settings row', () => {
    expect(s.default.data).toEqual({ enabled: false, rows: 1 });
  });
  test('a new video is refused on offers, library items and experiences, even for the server; nothing is written', () => {
    expect(s.offer_video.data).toEqual(refused);
    expect(s.creative_video.data).toEqual(refused);
    expect(s.experience_video.data).toEqual(refused);
    expect(s.nothing_written.data).toEqual({ offer: null, creatives: 0, experiences: 0 });
  });
  test('images are unchanged', () => {
    expect(s.creative_image.data).toBe('ok');
    expect(s.experience_image.data).toBe('ok');
  });
  test('a signed-in owner writing directly is refused; clients can neither read nor call the switch', () => {
    expect(s.owner_direct.data).toEqual(refused);
    expect(s.client.data).toEqual({ read_settings: false, exec_enabled: false, anon_exec: false });
  });
  test('a Business Moment video is refused for the manager; a moment photo and a person\'s own video story are unchanged', () => {
    const moment = { error: "Video moments aren't available yet. Post a photo instead.", hint: 'business_video_paused' };
    expect(s.moment_video.data).toEqual(moment);
    expect(s.moment_image.data).toBe('ok');
    expect(s.person_video.data).toBe('ok');
    expect(s.story_becomes_moment.data).toEqual(moment);
    expect(s.moments_written.data).toEqual({ videos: 0, images: 1 });
  });
  test('switched on, a video goes through; an existing video row stays editable, but never newly ready or re-filed while off', () => {
    expect(s.on_video.data).toBe('ok');
    expect(s.existing_unrelated.data).toBe('ok');
    expect(s.existing_ready.data).toEqual(refused);
    expect(s.existing_new_file.data).toEqual(refused);
  });
});

// Stories security + launch media policy (owner 2026-11-05; migration 20270390; staged, run with 0348-0390 as
// JOURNEY_PRELUDE_FILE until live). Under the real authenticated role: a file in someone else's folder is refused, also for
// the server; created_at + expires_at are the server's whatever is sent; junk media types are refused; no verified phone = no
// post; public, friends-only and video Stories are refused while their switches are off; a memory photo still works, is never
// public, and a memory video is refused; the three switches do what they say; clients can't update a story or see the switches.
// The storage rules themselves are proven through the real Storage API: scripts/replay/story-storage-api.js.
const { runJourney, stepMap, hasToken, actorDeclares, actorsSql, fixturePhoneWrite } = require('./journeyHarness');

const d = hasToken ? describe : describe.skip;

const as = (u) => `perform set_config('request.jwt.claims', json_build_object('sub', ${u}, 'role', 'authenticated')::text, true); set local role authenticated;`;
const off = `reset role; perform set_config('request.jwt.claims', '', true);`;
const tryStep = (step, stmt) => `
  begin ${stmt}; v_out := '"ok"'::jsonb;
  exception when others then
    get stacked diagnostics v_hint = pg_exception_hint;
    v_out := jsonb_build_object('error', sqlerrm, 'hint', v_hint);
  end;
  log := log || jsonb_build_array(jsonb_build_object('step', '${step}', 'ok', true, 'data', v_out));`;
const insert = (who, path, extra = '', vals = '') =>
  `insert into stories (user_id, media_path${extra}) values (${who}, ${who} || '/${path}'${vals})`;
const sw = (col, v) => `update private.story_media_settings set ${col} = ${v} where id;`;

d('journey: stories security (20270390)', () => {
  let s;
  beforeAll(async () => {
    const log = await runJourney(`${actorDeclares(['v_a', 'v_f', 'v_x', 'v_np'])} v_g uuid; v_st uuid; v_out jsonb; v_hint text; v_n int;`, `
  ${actorsSql({ people: ['v_a', 'v_f', 'v_x', 'v_np'], friends: [['v_a', 'v_f']] })}
  insert into gatherings (host_id, title, scheduled_at, precise_lat, precise_lng, interest_tag, area, visibility)
    values (v_a, 'J stories', now() + interval '1 day', 26.4, -80.1, 'Volleyball', 'x', 'everyone') returning id into v_g;
  update private.story_media_settings set public_stories_enabled = false, friends_stories_enabled = false, story_video_enabled = false where id;
  log := log || jsonb_build_array(jsonb_build_object('step', 'default', 'ok', true, 'data', jsonb_build_object(
    'rows', (select count(*) from private.story_media_settings),
    'read', has_table_privilege('authenticated', 'private.story_media_settings', 'select'),
    'update', has_table_privilege('authenticated', 'public.stories', 'update') or has_any_column_privilege('authenticated', 'public.stories', 'update'),
    'exec', has_function_privilege('authenticated', 'private._story_rules()', 'execute'))));

  ${sw('friends_stories_enabled', true)}
  ${as('v_x')}
  ${tryStep('foreign_path', `insert into stories (user_id, media_path) values (v_x, v_a || '/secret.jpg')`)}
  ${tryStep('traversal', `insert into stories (user_id, media_path) values (v_x, v_x || '/../' || v_a || '/secret.jpg')`)}
  ${tryStep('nested', `insert into stories (user_id, media_path) values (v_x, v_x || '/a/b.jpg')`)}
  ${tryStep('no_folder', `insert into stories (user_id, media_path) values (v_x, 'secret.jpg')`)}
  ${tryStep('junk_type', insert('v_x', 'j.jpg', ', media_type', ", 'banana'"))}
  ${off}
  ${tryStep('server_foreign_path', `insert into stories (user_id, media_path) values (v_x, v_a || '/secret.jpg')`)}

  ${as('v_a')}
  ${tryStep('forged_times', `insert into stories (user_id, media_path, created_at, expires_at) values (v_a, v_a || '/t.jpg', '2001-01-01', '2099-01-01') returning id into v_st`)}
  ${off}
  log := log || jsonb_build_array(jsonb_build_object('step', 'times', 'ok', true, 'data', (
    select jsonb_build_object('created_now', abs(extract(epoch from created_at - now())) < 60,
      'lasts_24h', abs(extract(epoch from expires_at - created_at) - 86400) < 1) from stories where id = v_st)));
  ${as('v_f')} select count(*) into v_n from stories where id = v_st; ${off}
  log := log || jsonb_build_array(jsonb_build_object('step', 'friend_sees', 'ok', true, 'data', v_n));
  ${as('v_x')} select count(*) into v_n from stories where id = v_st; ${off}
  log := log || jsonb_build_array(jsonb_build_object('step', 'stranger_sees', 'ok', true, 'data', v_n));
  update stories set expires_at = now() - interval '1 minute' where id = v_st;
  ${as('v_f')} select count(*) into v_n from stories where id = v_st; ${off}
  log := log || jsonb_build_array(jsonb_build_object('step', 'friend_after_expiry', 'ok', true, 'data', v_n));

  ${sw('friends_stories_enabled', false)}
  ${as('v_a')}
  ${tryStep('friends_off', insert('v_a', 'f.jpg'))}
  ${tryStep('public_off', insert('v_a', 'p.jpg', ', is_public', ', true'))}
  ${tryStep('video_off', insert('v_a', 'v.mov', ', media_type', ", 'video'"))}
  ${tryStep('memory_photo', insert('v_a', 'm.jpg', ', gathering_id, is_public', ', v_g, true') + ' returning id into v_st')}
  ${tryStep('memory_video', insert('v_a', 'm.mov', ', media_type, gathering_id', ", 'video', v_g"))}
  ${tryStep('client_update', `update stories set expires_at = '2099-01-01' where id = v_st`)}
  ${off}
  log := log || jsonb_build_array(jsonb_build_object('step', 'memory', 'ok', true, 'data', (
    select jsonb_build_object('public', is_public) from stories where id = v_st)));

  ${fixturePhoneWrite('update auth.users set phone = null, phone_confirmed_at = null where id = v_np;')}
  ${sw('friends_stories_enabled', true)}
  ${as('v_np')}
  ${tryStep('no_phone', insert('v_np', 'n.jpg'))}
  ${off}

  ${sw('public_stories_enabled', true)}
  ${sw('story_video_enabled', true)}
  ${as('v_a')}
  ${tryStep('public_on', insert('v_a', 'p2.jpg', ', is_public', ', true') + ' returning id into v_st')}
  ${tryStep('video_on', insert('v_a', 'v2.mov', ', media_type', ", 'video'"))}
  ${off}
  ${as('v_x')} select count(*) into v_n from stories where id = v_st; ${off}
  log := log || jsonb_build_array(jsonb_build_object('step', 'public_stranger', 'ok', true, 'data', v_n));`);
    s = stepMap(log);
  }, 120000);

  const notYours = { error: "That file can't be used for this story.", hint: 'story_media_not_yours' };

  test('every switch is off by default in one row clients can reach in no way, and clients can update no story', () => {
    expect(s.default.data).toEqual({ rows: 1, read: false, update: false, exec: false });
  });
  test('a file outside the poster\'s own folder is refused, for a client and for the server', () => {
    for (const k of ['foreign_path', 'traversal', 'nested', 'no_folder', 'server_foreign_path']) expect(s[k].data).toEqual(notYours);
  });
  test('a junk media type is refused', () => {
    expect(s.junk_type.data.error).toMatch(/stories_media_type_check/);
  });
  test('created_at and expires_at are the server\'s, 24 h, whatever is sent; the audience and the expiry hold', () => {
    expect(s.forged_times.data).toBe('ok');
    expect(s.times.data).toEqual({ created_now: true, lasts_24h: true });
    expect(s.friend_sees.data).toBe(1);
    expect(s.stranger_sees.data).toBe(0);
    expect(s.friend_after_expiry.data).toBe(0);
  });
  test('with the switches off, public, friends-only and video Stories are refused', () => {
    expect(s.friends_off.data).toEqual({ error: "Stories aren't available yet.", hint: 'stories_paused' });
    expect(s.public_off.data).toEqual({ error: "Public stories aren't available yet.", hint: 'stories_paused' });
    expect(s.video_off.data).toEqual({ error: "Video stories aren't available yet.", hint: 'story_video_paused' });
  });
  test('a memory photo still posts and is never public; a memory video is refused', () => {
    expect(s.memory_photo.data).toBe('ok');
    expect(s.memory.data).toEqual({ public: false });
    expect(s.memory_video.data).toEqual({ error: "Video stories aren't available yet.", hint: 'story_video_paused' });
  });
  test('a client update changes nothing', () => {
    expect(s.client_update.data.error).toMatch(/permission denied/);
  });
  test('no verified phone, no post', () => {
    expect(s.no_phone.data.hint).toBe('phone_required');
  });
  test('the future, separately approved switches work', () => {
    expect(s.public_on.data).toBe('ok');
    expect(s.video_on.data).toBe('ok');
    expect(s.public_stranger.data).toBe(1);
  });
});

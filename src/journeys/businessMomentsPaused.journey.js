// Business Moments paused for the first launch (owner 2026-11-05, temporary; migration 20270389; staged, run with 0348-0389 as
// JOURNEY_PRELUDE_FILE until live). The database refuses a moment photo for the signed-in manager and for the server, with
// hint business_moments_paused; a moment video keeps 0388's refusal; a person's own story is unchanged; a live moment is ended
// by the migration's own update; switching on (the future, separately approved re-enable) lets photos through; clients can't
// read the switch.
const { runJourney, stepMap, hasToken, actorDeclares, actorsSql } = require('./journeyHarness');

const d = hasToken ? describe : describe.skip;

const tryStep = (step, stmt) => `
  begin ${stmt}; v_out := '"ok"'::jsonb;
  exception when others then
    get stacked diagnostics v_hint = pg_exception_hint;
    v_out := jsonb_build_object('error', sqlerrm, 'hint', v_hint);
  end;
  log := log || jsonb_build_array(jsonb_build_object('step', '${step}', 'ok', true, 'data', v_out));`;

d('journey: business moments paused (20270389)', () => {
  let s;
  beforeAll(async () => {
    const log = await runJourney(`${actorDeclares(['v_o', 'v_p'])} v_st uuid; v_out jsonb; v_hint text;`, `
  ${actorsSql({ people: ['v_o'], business: { owner: 'v_o', partner: 'v_p' } })}
  update brand_partners set tier = 'growth' where id = v_p; -- a paid feature: the refusals below must be the pause's
  update private.business_moments_settings set enabled = false where id;
  log := log || jsonb_build_array(jsonb_build_object('step', 'default', 'ok', true, 'data', jsonb_build_object(
    'enabled', (select enabled from private.business_moments_settings), 'rows', (select count(*) from private.business_moments_settings))));

  perform set_config('request.jwt.claims', json_build_object('sub', v_o, 'role', 'authenticated')::text, true);
  set local role authenticated;
  ${tryStep('manager_photo', `insert into stories (user_id, partner_id, media_path, media_type) values (v_o, v_p, v_o || '/m.jpg', 'image')`)}
  ${tryStep('manager_video', `insert into stories (user_id, partner_id, media_path, media_type) values (v_o, v_p, v_o || '/m.mov', 'video')`)}
  ${tryStep('person_photo', `insert into stories (user_id, media_path, media_type) values (v_o, v_o || '/p.jpg', 'image') returning id into v_st`)}
  reset role;
  perform set_config('request.jwt.claims', '', true);

  ${tryStep('server_photo', `insert into stories (user_id, partner_id, media_path, media_type) values (v_o, v_p, v_o || '/s.jpg', 'image')`)}
  ${tryStep('story_becomes_moment', `update stories set partner_id = v_p where id = v_st`)}
  log := log || jsonb_build_array(jsonb_build_object('step', 'written', 'ok', true, 'data', jsonb_build_object(
    'moments', (select count(*) from stories where partner_id = v_p),
    'own', (select count(*) from stories where user_id = v_o and partner_id is null))));
  log := log || jsonb_build_array(jsonb_build_object('step', 'client', 'ok', true, 'data', jsonb_build_object(
    'read', has_table_privilege('authenticated', 'private.business_moments_settings', 'select'),
    'exec', has_function_privilege('authenticated', 'private._refuse_paused_business_moment()', 'execute'))));

  update private.business_moments_settings set enabled = true where id;
  ${tryStep('on_photo', `insert into stories (user_id, partner_id, media_path, media_type) values (v_o, v_p, v_o || '/on.jpg', 'image')`)}
  update private.business_moments_settings set enabled = false where id;
  ${tryStep('existing_unrelated', `update stories set is_public = false where partner_id = v_p`)}`);
    s = stepMap(log);
  }, 120000);

  const refused = { error: "Business Moments aren't available yet.", hint: 'business_moments_paused' };

  test('off by default, one settings row', () => {
    expect(s.default.data).toEqual({ enabled: false, rows: 1 });
  });
  test('a moment photo is refused for the signed-in manager and the server; nothing is written', () => {
    expect(s.manager_photo.data).toEqual(refused);
    expect(s.server_photo.data).toEqual(refused);
    expect(s.written.data.moments).toBe(0);
  });
  test('a moment video keeps the 0388 refusal', () => {
    expect(s.manager_video.data).toEqual({ error: "Video moments aren't available yet. Post a photo instead.", hint: 'business_video_paused' });
  });
  test("a person's own story is unchanged and can't be turned into a moment", () => {
    expect(s.person_photo.data).toBe('ok');
    expect(s.story_becomes_moment.data).toEqual(refused);
    expect(s.written.data.own).toBe(1);
  });
  test('clients can neither read the switch nor call its function', () => {
    expect(s.client.data).toEqual({ read: false, exec: false });
  });
  test('switched on, a moment photo goes through; an unrelated edit of an existing moment is never refused while off', () => {
    expect(s.on_photo.data).toBe('ok');
    expect(s.existing_unrelated.data).toBe('ok');
  });
});

// Trending needs established attendees (migration 20270409, owner 2026-11-11; staged, run with it as JOURNEY_PRELUDE_FILE until
// live). get_gathering_approved_counts keeps approved_count exactly as before and adds `trending` = 5+ approved attendees whose
// accounts are Established (verified phone + account age, not suspended), never the host. Every read runs as an ordinary
// signed-in viewer under the real client role, in ONE rolled-back transaction. Fails on a database without 20270409 (no
// `trending` column).
// Not covered: the phone (Jest guard `trendingEstablished.test.js` covers the client reading only the server answer).
const { runJourney, stepMap, hasToken, actorDeclares, actorsSql, fixturePhoneWrite } = require('./journeyHarness');

const d = hasToken ? describe : describe.skip;

const NEW = ['v_n1', 'v_n2', 'v_n3', 'v_n4', 'v_n5'];
const EST = ['v_e1', 'v_e2', 'v_e3', 'v_e4', 'v_e5'];
const PEOPLE = ['v_host', 'v_viewer', 'v_aged_no_phone', ...NEW, ...EST];

const gathering = (title) => `insert into gatherings (host_id, title, scheduled_at, duration_minutes, precise_lat, precise_lng, interest_tag, area, visibility, is_public)
    values (v_host, '${title}', now() + interval '3 days', 60, 10.02, -10.03, 'Pickleball', 'j', 'everyone', true)`;
const join = (g, people) => `insert into gathering_interest (gathering_id, user_id, status) values ${people.map((p) => `(${g}, ${p}, 'approved')`).join(', ')};`;
const read = (step, ids) => `
  perform set_config('request.jwt.claims', json_build_object('sub', v_viewer, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    select coalesce(jsonb_object_agg(r.gathering_id, jsonb_build_object('count', r.approved_count, 'trending', r.trending)), '{}'::jsonb) into v_out
      from get_gathering_approved_counts(array[${ids}]) r;
  exception when others then v_out := jsonb_build_object('error', sqlerrm);
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  log := log || jsonb_build_array(jsonb_build_object('step', '${step}', 'ok', true, 'data', jsonb_build_object(
    'all_new', v_out -> v_g_new::text, 'established', v_out -> v_g_est::text, 'four_and_one_new', v_out -> v_g_mix::text,
    'invited', v_out -> v_g_inv::text, 'one_without_phone', v_out -> v_g_nophone::text, 'four_plus_host', v_out -> v_g_host::text,
    'nobody', v_out -> v_g_empty::text)));`;
const IDS = 'v_g_new, v_g_est, v_g_mix, v_g_inv, v_g_nophone, v_g_host, v_g_empty';

d('journey: Trending needs five established attendees (20270409)', () => {
  let s;
  beforeAll(async () => {
    const log = await runJourney(`
      ${actorDeclares(PEOPLE)}
      v_out jsonb; v_g_new uuid; v_g_est uuid; v_g_mix uuid; v_g_inv uuid; v_g_nophone uuid; v_g_host uuid; v_g_empty uuid; v_old_shape jsonb;`, `
  ${actorsSql({ people: PEOPLE })}
  ${fixturePhoneWrite(`
    update auth.users set created_at = now() - interval '1 hour' where id in (${NEW.join(', ')});
    update auth.users set created_at = now() - interval '30 days' where id in (v_host, v_viewer, v_aged_no_phone, ${EST.join(', ')});
    update auth.users set phone = null, phone_confirmed_at = null where id = v_aged_no_phone;`)}
  log := log || jsonb_build_array(jsonb_build_object('step', 'levels', 'ok', true, 'data', jsonb_build_object(
    'new', (select array_agg(distinct private.trust_level(u)) from unnest(array[${NEW.join(', ')}]) u),
    'established', (select array_agg(distinct private.trust_level(u)) from unnest(array[${EST.join(', ')}]) u),
    'aged_no_phone', private.trust_level(v_aged_no_phone), 'host', private.trust_level(v_host))));

  ${gathering('Five new accounts')} returning id into v_g_new;
  ${gathering('Five established')} returning id into v_g_est;
  ${gathering('Four established + one new')} returning id into v_g_mix;
  ${gathering('Five invited established')} returning id into v_g_inv;
  ${gathering('Four established + one aged without a phone')} returning id into v_g_nophone;
  ${gathering('Four established + the host')} returning id into v_g_host;
  ${gathering('Nobody yet')} returning id into v_g_empty;
  ${join('v_g_new', NEW)}
  ${join('v_g_est', EST)}
  ${join('v_g_mix', [...EST.slice(0, 4), 'v_n1'])}
  insert into social_invites (inviter_id, invitee_id, invite_type, target_id) select v_host, u, 'gathering', v_g_inv from unnest(array[${EST.join(', ')}]) u;
  ${join('v_g_inv', EST)}
  ${join('v_g_nophone', [...EST.slice(0, 4), 'v_aged_no_phone'])}
  ${join('v_g_host', EST.slice(0, 4))}
  -- the host is never an attendee through the app (join_gathering refuses it); force a row to prove the rule never counts it
  begin
    insert into gathering_interest (gathering_id, user_id, status) values (v_g_host, v_host, 'approved');
    log := log || jsonb_build_array(jsonb_build_object('step', 'host_row', 'ok', true, 'data', to_jsonb('inserted'::text)));
  exception when others then
    log := log || jsonb_build_array(jsonb_build_object('step', 'host_row', 'ok', true, 'data', to_jsonb('refused: ' || sqlerrm)));
  end;

  ${read('before_suspension', IDS)}

  -- the old build's query shape: only gathering_id + approved_count, unchanged
  perform set_config('request.jwt.claims', json_build_object('sub', v_viewer, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select jsonb_agg(jsonb_build_object('id', gathering_id, 'n', approved_count) order by approved_count) into v_old_shape
    from get_gathering_approved_counts(array[v_g_new, v_g_mix]);
  reset role;
  perform set_config('request.jwt.claims', '', true);
  log := log || jsonb_build_array(jsonb_build_object('step', 'old_shape', 'ok', true, 'data', jsonb_build_object('rows', v_old_shape, 'new', v_g_new, 'mix', v_g_mix)));

  -- one of the five established attendees is suspended: four remain, no longer Trending; their join still counts as attending
  update profiles set suspended_at = now() where id = v_e5;
  ${read('after_suspension', IDS)}

  log := log || jsonb_build_array(jsonb_build_object('step', 'grants', 'ok', true, 'data', jsonb_build_object(
    'authenticated', has_function_privilege('authenticated', 'public.get_gathering_approved_counts(uuid[])', 'execute'),
    'anon', has_function_privilege('anon', 'public.get_gathering_approved_counts(uuid[])', 'execute'),
    'public', exists (select 1 from information_schema.routine_privileges where routine_name = 'get_gathering_approved_counts' and grantee = 'PUBLIC'),
    'overloads', (select count(*) from pg_proc where proname = 'get_gathering_approved_counts'),
    'columns', (select proargnames from pg_proc where proname = 'get_gathering_approved_counts' limit 1))));
`);
    s = stepMap(log);
  }, 120000);

  const data = (n) => s[n].data;

  it('the fixtures are what they claim: new, established, aged without a phone', () => {
    expect(data('levels')).toEqual({ new: ['new'], established: ['established'], aged_no_phone: 'new', host: 'established' });
  });

  it('five brand-new accounts make a count, not a trend', () => {
    expect(data('before_suspension').all_new).toEqual({ count: 5, trending: false });
  });

  it('five established attendees make it Trending; invited established joiners count like any other', () => {
    expect(data('before_suspension').established).toEqual({ count: 5, trending: true });
    expect(data('before_suspension').invited).toEqual({ count: 5, trending: true });
  });

  it('four established + one new, or one aged account without a verified phone, is not Trending', () => {
    expect(data('before_suspension').four_and_one_new).toEqual({ count: 5, trending: false });
    expect(data('before_suspension').one_without_phone).toEqual({ count: 5, trending: false });
  });

  it('the host is never counted toward Trending', () => {
    const host = data('before_suspension').four_plus_host;
    if (String(data('host_row')).startsWith('refused')) expect(host).toEqual({ count: 4, trending: false });
    else expect(host).toEqual({ count: 5, trending: false });
  });

  it('a gathering nobody joined has no row (as before)', () => {
    expect(data('before_suspension').nobody).toBeNull();
  });

  it('a suspended attendee no longer counts toward Trending; the attending count is unchanged', () => {
    expect(data('after_suspension').established).toEqual({ count: 5, trending: false });
    expect(data('after_suspension').invited).toEqual({ count: 5, trending: false });
    expect(data('after_suspension').all_new).toEqual({ count: 5, trending: false });
  });

  it('only a yes/no is added: no established-attendee count is ever returned', () => {
    expect(data('grants').columns).toEqual(['gathering_ids', 'gathering_id', 'approved_count', 'trending']);
  });

  it('build <= 87 query shape: approved_count per gathering, unchanged', () => {
    const o = data('old_shape');
    expect(o.rows).toHaveLength(2);
    expect(o.rows).toEqual(expect.arrayContaining([{ id: o.new, n: 5 }, { id: o.mix, n: 5 }]));
  });

  it('same grants as before: signed-in only, one function', () => {
    const { columns, ...grants } = data('grants');
    expect(grants).toEqual({ authenticated: true, anon: false, public: false, overloads: 1 });
  });
});

// Host familiarity (migration 20270410, owner 2026-11-11; staged, run with it as JOURNEY_PRELUDE_FILE until live).
// get_my_familiar_hosts returns, for the signed-in viewer only, the people they were really at ENDED gatherings with in the
// last 365 days (attendee or host on either side), capped at 3; never upcoming / in-progress / older gatherings, pending rows,
// blocked or suspended people, or the viewer. Every read runs as an ordinary signed-in person under the real client role, in
// ONE rolled-back transaction. Fails on a database without 20270410 (no function).
// Not covered: the phone (Jest guard `hostFamiliarity.test.js` covers the tie-break on every surface).
const { runJourney, stepMap, hasToken, actorDeclares, actorsSql, LIFT_GATHERING_CREATION_LIMIT } = require('./journeyHarness');

const d = hasToken ? describe : describe.skip;

const PEOPLE = ['v_viewer', 'v_other', 'v_h3', 'v_h5', 'v_up', 'v_live', 'v_old', 'v_co', 'v_host_co', 'v_guest', 'v_pending', 'v_blocked', 'v_susp'];

const gathering = (host, when, mins = 60) => `insert into gatherings (host_id, title, scheduled_at, duration_minutes, precise_lat, precise_lng, interest_tag, area, visibility, is_public)
    values (${host}, 'Familiar', now() + interval '3 days', ${mins}, 10.02, -10.03, 'Coffee', 'j', 'everyone', true) returning id into v_g;
  insert into tmp_fam_g values (v_g, ${host}, ${when});`;
const attend = (people, status = 'approved') => `insert into gathering_interest (gathering_id, user_id, status) select v_g, u, '${status}' from unnest(array[${people.join(', ')}]::uuid[]) u;`;
const as = (who, step) => `
  perform set_config('request.jwt.claims', json_build_object('sub', ${who}, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    select coalesce(jsonb_object_agg(f.person_id, f.shared_count), '{}'::jsonb) into v_out from get_my_familiar_hosts() f;
  exception when others then v_out := jsonb_build_object('error', sqlerrm);
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  log := log || jsonb_build_array(jsonb_build_object('step', '${step}', 'ok', true, 'data', v_out));`;

d('journey: host familiarity from ended shared gatherings (20270410)', () => {
  let s;
  beforeAll(async () => {
    const log = await runJourney(`
      ${actorDeclares(PEOPLE)}
      v_out jsonb; v_g uuid; v_names jsonb; v_signed_out text;`, `
  ${actorsSql({ people: PEOPLE })}
  ${LIFT_GATHERING_CREATION_LIMIT}
  create temp table tmp_fam_g (id uuid, host uuid, start_at timestamptz) on commit drop;

  -- v_h3 hosted three ended gatherings the viewer attended; v_h5 five (capped at 3)
  ${[1, 2, 3].map(() => `${gathering('v_h3', "now() - interval '10 days'")} ${attend(['v_viewer'])}`).join('\n  ')}
  ${[1, 2, 3, 4, 5].map(() => `${gathering('v_h5', "now() - interval '20 days'")} ${attend(['v_viewer'])}`).join('\n  ')}
  -- not yet ended: upcoming, and in progress right now
  ${gathering('v_up', "now() + interval '2 days'")} ${attend(['v_viewer'])}
  ${gathering('v_live', "now() - interval '10 minutes'", 120)} ${attend(['v_viewer'])}
  -- ended more than 365 days ago
  ${gathering('v_old', "now() - interval '400 days'")} ${attend(['v_viewer'])}
  -- a fellow attendee at someone else's ended gathering (v_co), and its host (v_host_co)
  ${gathering('v_host_co', "now() - interval '5 days'")} ${attend(['v_viewer', 'v_co'])}
  -- the viewer hosted an ended gathering: v_guest attended, v_pending only asked
  ${gathering('v_viewer', "now() - interval '3 days'")} ${attend(['v_guest', 'v_blocked', 'v_susp'])} ${attend(['v_pending'], 'pending')}
  -- the viewer only asked to join v_other's ended gathering (pending): no familiarity
  ${gathering('v_other', "now() - interval '4 days'")} ${attend(['v_viewer'], 'pending')}

  update gatherings g set scheduled_at = t.start_at from tmp_fam_g t where g.id = t.id;
  insert into blocks (blocker_id, blocked_id) values (v_blocked, v_viewer);
  update profiles set suspended_at = now() where id = v_susp;

  ${as('v_viewer', 'viewer')}
  ${as('v_guest', 'guest')}
  ${as('v_up', 'upcoming_host')}

  -- signed out: refused
  begin
    perform set_config('request.jwt.claims', '', true);
    set local role authenticated;
    perform * from get_my_familiar_hosts();
    v_signed_out := 'allowed';
  exception when others then v_signed_out := sqlerrm;
  end;
  reset role;

  select jsonb_object_agg(k, v) into v_names from (values
    ('h3', v_h3), ('h5', v_h5), ('up', v_up), ('live', v_live), ('old', v_old), ('co', v_co), ('host_co', v_host_co),
    ('guest', v_guest), ('pending', v_pending), ('blocked', v_blocked), ('susp', v_susp), ('other', v_other), ('viewer', v_viewer)) x(k, v);
  log := log || jsonb_build_array(jsonb_build_object('step', 'names', 'ok', true, 'data', v_names));
  log := log || jsonb_build_array(jsonb_build_object('step', 'access', 'ok', true, 'data', jsonb_build_object(
    'signed_out', v_signed_out,
    'authenticated', has_function_privilege('authenticated', 'public.get_my_familiar_hosts()', 'execute'),
    'anon', has_function_privilege('anon', 'public.get_my_familiar_hosts()', 'execute'),
    'public', exists (select 1 from information_schema.routine_privileges where routine_name = 'get_my_familiar_hosts' and grantee = 'PUBLIC'),
    'definer', (select prosecdef from pg_proc where proname = 'get_my_familiar_hosts'),
    'volatility', (select provolatile from pg_proc where proname = 'get_my_familiar_hosts'))));
`);
    s = stepMap(log);
  }, 120000);

  const named = (step) => {
    const n = s.names.data;
    const byId = Object.fromEntries(Object.entries(n).map(([k, v]) => [v, k]));
    return Object.fromEntries(Object.entries(s[step].data).map(([id, c]) => [byId[id] ?? 'unknown', c]));
  };

  it('counts only ENDED shared gatherings in the last year, capped at 3, either side hosting or attending', () => {
    expect(named('viewer')).toEqual({ h3: 3, h5: 3, co: 1, host_co: 1, guest: 1 });
  });

  it('never upcoming or in-progress gatherings, older than a year, pending rows, the viewer, blocked or suspended people', () => {
    const v = named('viewer');
    for (const k of ['up', 'live', 'old', 'pending', 'other', 'viewer', 'blocked', 'susp']) expect(v).not.toHaveProperty(k);
  });

  it('each person sees only their own familiarity', () => {
    // the guest was at the viewer's gathering with v_blocked (that block is between the viewer and v_blocked only) and v_susp (suspended: left out)
    expect(named('guest')).toEqual({ viewer: 1, blocked: 1 });
    expect(named('upcoming_host')).toEqual({});
  });

  it('signed-in only: signed out refused, no anon or public EXECUTE; read-only definer function', () => {
    expect(s.access.data).toEqual({ signed_out: 'Not authenticated', authenticated: true, anon: false, public: false, definer: true, volatility: 's' });
  });
});

// Journey (owner idea "356", 2026-10-23): Interested marks reach a business's anonymous "N people nearby are interested in
// {category} gatherings" row ONLY from people who turned the Settings switch on (migration 20270340). Under real roles, real
// floor (demand_min_people() = 5, not lowered), one rolled-back transaction, synthetic actors only:
//   a new account starts OFF; five people Interested but nobody opted in = no row; four opted in = still no row (floor);
//   the fifth opts in = "5"; opting in without a mark adds nobody; one opts out = the row is gone on the very next read;
//   every switch change is logged with its time in a table the client cannot read; the payload never carries a person or
//   gathering id. Not covered (device only): the Settings switch and the first-Interested explanation on a phone.
const { runJourney, stepMap, hasToken, actorsSql, journeyOwner } = require('./journeyHarness');

const d = hasToken ? describe : describe.skip;

const P = ['v_p1', 'v_p2', 'v_p3', 'v_p4', 'v_p5', 'v_p6'];

function as(sub) {
  return `perform set_config('request.jwt.claims', json_build_object('sub', ${sub}, 'role', 'authenticated')::text, true);
  set local role authenticated;`;
}
function optIn(sub, on) {
  return `${as(sub)}
  update profiles set share_interest_in_demand = ${on} where id = ${sub};
  reset role;`;
}
function businessRead(step) {
  return `${as('v_owner')}
  v_demand := get_partner_demand_signals(v_partner);
  reset role;
  select e into v_row from jsonb_array_elements(v_demand->'signals') e where e->>'kind' = 'gathering_interest' limit 1;
  log := log || jsonb_build_array(jsonb_build_object('step', '${step}', 'ok', true, 'data', jsonb_build_object(
    'row', v_row, 'min_people', v_demand->'min_people',
    'leaks', (select count(*) from unnest(array[v_g, v_host, ${P.join(', ')}]) x where position(x::text in v_demand::text) > 0))));`;
}

d('journey: Interested reaches anonymous business demand only by opt-in, at 5+ (idea 356)', () => {
  let s;
  beforeAll(async () => {
    const owner = journeyOwner();
    const log = await runJourney(`
      v_owner uuid := '${owner.id}'; v_partner uuid := '${owner.managed_partner_id}'; v_host uuid := gen_random_uuid();
      ${P.map((v) => `${v} uuid := gen_random_uuid();`).join(' ')}
      v_g uuid; v_demand jsonb; v_row jsonb; v_res text;`, `
  ${actorsSql({ people: ['v_owner', 'v_host', ...P], business: { owner: 'v_owner', partner: 'v_partner', lat: -0.5, lng: -0.5, subcategory: 'Coffee' } })}
  perform set_config('app.trusted_update', '', true);

  -- a new account (inserted without the column, as sign-up does) starts OFF, with no consent record
  log := log || jsonb_build_array(jsonb_build_object('step', 'new_accounts', 'ok', true, 'data', jsonb_build_object(
    'on', (select count(*) from profiles where id = any(array[${P.join(', ')}]) and share_interest_in_demand),
    'off', (select count(*) from profiles where id = any(array[${P.join(', ')}]) and not share_interest_in_demand),
    'consent_rows', (select count(*) from private.interest_demand_consent where user_id = any(array[${P.join(', ')}])),
    'column_default', (select column_default from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'share_interest_in_demand'))));

  -- a public Coffee gathering in the business's own area bucket; p1..p5 mark it Interested (p6 never does)
  ${as('v_host')}
  insert into gatherings (host_id, title, scheduled_at, precise_lat, precise_lng, interest_tag, area, capacity, visibility)
    values (v_host, 'J356 coffee', now() + interval '3 days', -0.5, -0.5, 'Coffee', 'journey', 8, 'everyone') returning id into v_g;
  reset role;
  update gatherings set wide_area = '-0.5,-0.5', is_public = true where id = v_g;
  ${['v_p1', 'v_p2', 'v_p3', 'v_p4', 'v_p5'].map((p) => `${as(p)} perform set_gathering_interested(v_g, true); reset role;`).join('\n  ')}

  ${businessRead('nobody_opted_in')}
  ${['v_p1', 'v_p2', 'v_p3', 'v_p4'].map((p) => optIn(p, 'true')).join('\n  ')}
  ${businessRead('four_opted_in')}
  ${optIn('v_p5', 'true')}
  ${businessRead('five_opted_in')}
  ${optIn('v_p6', 'true')}
  ${businessRead('opted_in_without_mark')}

  log := log || jsonb_build_array(jsonb_build_object('step', 'consent_after_opt_in', 'ok', true, 'data', jsonb_build_object(
    'rows', (select count(*) from private.interest_demand_consent where user_id = any(array[${P.join(', ')}]) and opted_in and at is not null),
    'people', (select count(distinct user_id) from private.interest_demand_consent where user_id = any(array[${P.join(', ')}])))));

  ${optIn('v_p3', 'false')}
  ${businessRead('after_one_opt_out')}
  log := log || jsonb_build_array(jsonb_build_object('step', 'opt_out_recorded', 'ok', true, 'data', (
    select jsonb_agg(jsonb_build_object('opted_in', opted_in, 'timed', at is not null) order by at, opted_in desc)
    from private.interest_demand_consent where user_id = v_p3)));

  -- the consent record is not readable or writable by any client role
  ${as('v_p1')}
  begin select count(*)::text into v_res from private.interest_demand_consent; exception when others then v_res := 'refused: ' || sqlerrm; end;
  log := log || jsonb_build_array(jsonb_build_object('step', 'client_reads_consent', 'ok', true, 'data', v_res));
  begin insert into private.interest_demand_consent (user_id, opted_in) values (v_p1, true); v_res := 'ok';
  exception when others then v_res := 'refused: ' || sqlerrm; end;
  log := log || jsonb_build_array(jsonb_build_object('step', 'client_writes_consent', 'ok', true, 'data', v_res));
  reset role;
`);
    s = stepMap(log);
  }, 60000);

  const refused = (v) => typeof v === 'string' && v.startsWith('refused');

  test('a new account starts with sharing OFF and no consent record; the column default is false', () => {
    expect(s.new_accounts.data).toMatchObject({ on: 0, off: 6, consent_rows: 0, column_default: 'false' });
  });
  test('five people Interested but nobody opted in = no row (a missing choice is never consent)', () => {
    expect(s.nobody_opted_in.data.row).toBeNull();
  });
  test('four opted in = still no row: the real floor of 5 holds', () => {
    expect(s.four_opted_in.data.min_people).toBe(5);
    expect(s.four_opted_in.data.row).toBeNull();
  });
  test('the fifth opts in = category + count only, never an id', () => {
    expect(s.five_opted_in.data.row).toEqual({ kind: 'gathering_interest', category: 'Coffee', people_count: 5 });
    expect(s.five_opted_in.data.leaks).toBe(0);
  });
  test('opting in without marking Interested adds nobody', () => {
    expect(s.opted_in_without_mark.data.row).toMatchObject({ people_count: 5 });
  });
  test('each opt-in is recorded with its time', () => {
    expect(s.consent_after_opt_in.data).toEqual({ rows: 6, people: 6 });
  });
  test('opting out removes the person on the very next read (here: back under the floor = no row) and is recorded', () => {
    expect(s.after_one_opt_out.data.row).toBeNull();
    expect(s.opt_out_recorded.data).toEqual([{ opted_in: true, timed: true }, { opted_in: false, timed: true }]);
  });
  test('no client can read or write the consent record', () => {
    expect(refused(s.client_reads_consent.data)).toBe(true);
    expect(refused(s.client_writes_consent.data)).toBe(true);
  });
});

// Owner (2026-10-17, idea "152" follow-up, LOCKED): Interested is private to the person; the ONE exception is an aggregate
// count, visible only to the host of that gathering (GatheringDetail's host view, `get_gathering_interested_count`). Every
// actor runs under the REAL database role the API uses (`set local role anon` / `authenticated` + JWT claims), so RLS,
// grants and the function's own host check are exercised, not bypassed:
//   host, each interested person, an approved attendee, an unrelated signed-in viewer, a business owner, signed out:
//   the count (value or refusal), which gathering_interested rows a plain read returns, and whose ids they carry.
//   Writes: nobody can insert / change / delete another person's mark directly; marks go only through
//   set_gathering_interested. Marking Interested sends the host nothing. A business's demand read stays below its floor
//   and never carries a gathering or person id. Cancelling (= deleting) the gathering leaves no count for anyone.
//   And the set of database functions that read gathering_interested is pinned: a new reader must be reviewed here.
// Rolled back. Coordinates are mid-Atlantic so no real gathering is involved.
const { runJourney, stepMap, hasToken } = require('./journeyHarness');

const d = hasToken ? describe : describe.skip;

const LAT = 13.335577;
const LNG = -44.668822;

// What `sub` (null = signed out) can learn about g's Interested marks, under `role`.
function probe(step, role, sub) {
  const claims = sub
    ? `json_build_object('sub', ${sub}, 'role', 'authenticated')::text`
    : `json_build_object('role', 'anon')::text`;
  return `
  perform set_config('request.jwt.claims', ${claims}, true);
  set local role ${role};
  begin v_count := to_jsonb(get_gathering_interested_count(g));
  exception when others then v_count := to_jsonb('refused: ' || sqlerrm); end;
  begin
    select coalesce(jsonb_agg(user_id order by user_id), '[]'::jsonb) into v_rows from gathering_interested where gathering_id = g;
  exception when others then v_rows := to_jsonb('refused: ' || sqlerrm); end;
  reset role;
  log := log || jsonb_build_array(jsonb_build_object('step', '${step}', 'ok', true,
    'data', jsonb_build_object('count', v_count, 'rows', v_rows)));`;
}

// A statement attempted as `sub` under the real role; records 'ok' + rows touched, or the error text.
function attempt(step, sub, stmt) {
  return `
  perform set_config('request.jwt.claims', json_build_object('sub', ${sub}, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin ${stmt}; get diagnostics v_n = row_count; v_err := 'ok:' || v_n;
  exception when others then v_err := sqlerrm; end;
  reset role;
  log := log || jsonb_build_array(jsonb_build_object('step', '${step}', 'ok', true, 'data', to_jsonb(v_err)));`;
}

d('journey: Interested stays private; only the host sees an aggregate count', () => {
  let s;
  let ids;
  beforeAll(async () => {
    const log = await runJourney(`
      v_host uuid := gen_random_uuid(); v_i1 uuid := gen_random_uuid(); v_i2 uuid := gen_random_uuid(); v_i3 uuid := gen_random_uuid();
      v_att uuid := gen_random_uuid(); v_str uuid := gen_random_uuid(); v_po uuid := gen_random_uuid(); v_p uuid := gen_random_uuid();
      u uuid; g uuid; v_count jsonb; v_rows jsonb; v_err text; v_n int; v_push_before bigint; v_sig jsonb;`, `
  perform set_config('app.trusted_update', 'on', true);
  perform set_config('app.push_handoff_test_failure', 'on', true);
  foreach u in array array[v_host, v_i1, v_i2, v_i3, v_att, v_str, v_po] loop
    insert into auth.users (id, aud, role, email) values (u, 'authenticated', 'authenticated', u || '@jint.test');
    insert into profiles (id, display_name, birthdate) values (u, 'JINT-' || left(u::text, 4), date '1990-01-01');
  end loop;
  insert into brand_partners (id, name, active, latitude, longitude, subcategory) values (v_p, 'JINT Cafe', true, ${LAT}, ${LNG}, 'Coffee');
  update profiles set managed_partner_id = v_p where id = v_po;

  perform set_config('request.jwt.claims', json_build_object('sub', v_host, 'role', 'authenticated')::text, true);
  insert into gatherings (host_id, title, scheduled_at, precise_lat, precise_lng, interest_tag, area, wide_area, capacity, visibility, is_public, discoverable)
    values (v_host, 'JINT coffee', now() + interval '1 day', ${LAT}, ${LNG}, 'Coffee', 'journey', 'JINT-area', 10, 'everyone', true, true) returning id into g;
  insert into gathering_interest (gathering_id, user_id, status) values (g, v_att, 'approved');

  -- three people mark Interested, each themselves, through the one writer, under the real role
  select count(*) into v_push_before from push_outbox where recipient_id = v_host;
  ${['v_i1', 'v_i2', 'v_i3'].map((who) => `
  perform set_config('request.jwt.claims', json_build_object('sub', ${who}, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform set_gathering_interested(g, true);
  reset role;`).join('')}
  log := log || jsonb_build_array(jsonb_build_object('step', 'marked', 'ok', true, 'data', jsonb_build_object(
    'ids', jsonb_build_object('host', v_host, 'i1', v_i1, 'i2', v_i2, 'i3', v_i3, 'att', v_att, 'str', v_str, 'po', v_po, 'g', g),
    'host_pushes', (select count(*) from push_outbox where recipient_id = v_host) - v_push_before)));

  ${probe('host', 'authenticated', 'v_host')}
  ${probe('interested_i1', 'authenticated', 'v_i1')}
  ${probe('interested_i2', 'authenticated', 'v_i2')}
  ${probe('attendee', 'authenticated', 'v_att')}
  ${probe('stranger', 'authenticated', 'v_str')}
  ${probe('business_owner', 'authenticated', 'v_po')}
  ${probe('signed_out', 'anon', null)}

  -- direct writes: nobody touches another person's mark, and nobody bypasses the one writer
  ${attempt('stranger_inserts_for_i1', 'v_str', "insert into gathering_interested (gathering_id, user_id) values (g, v_i1)")}
  ${attempt('stranger_inserts_own', 'v_str', "insert into gathering_interested (gathering_id, user_id) values (g, v_str)")}
  ${attempt('host_deletes_marks', 'v_host', 'delete from gathering_interested where gathering_id = g')}
  ${attempt('attendee_updates_mark', 'v_att', "update gathering_interested set created_at = now() where gathering_id = g")}
  ${attempt('host_marks_own', 'v_host', 'perform set_gathering_interested(g, true)')}

  -- a business's demand read: below the floor, nothing about Interested; never a gathering or person id
  perform set_config('request.jwt.claims', json_build_object('sub', v_po, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin v_sig := get_partner_demand_signals(v_p); exception when others then v_sig := to_jsonb('refused: ' || sqlerrm); end;
  reset role;
  log := log || jsonb_build_array(jsonb_build_object('step', 'business_demand', 'ok', true, 'data', jsonb_build_object(
    'signals', v_sig,
    'carries_ids', position(g::text in coalesce(v_sig::text, '')) > 0 or position(v_i1::text in coalesce(v_sig::text, '')) > 0
      or position(v_i2::text in coalesce(v_sig::text, '')) > 0 or position(v_i3::text in coalesce(v_sig::text, '')) > 0)));

  -- the count is the current aggregate: one person changes their mind, one joins (joining clears Interested)
  perform set_config('request.jwt.claims', json_build_object('sub', v_i1, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform set_gathering_interested(g, false);
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_i2, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform join_gathering(g);
  reset role;
  ${probe('host_after_changes', 'authenticated', 'v_host')}

  -- the host cancels (= deletes): no count for anyone afterwards, the host included
  perform set_config('request.jwt.claims', json_build_object('sub', v_host, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform cancel_gathering(g);
  reset role;
  ${probe('host_after_cancel', 'authenticated', 'v_host')}
  ${probe('interested_i3_after_cancel', 'authenticated', 'v_i3')}

  -- every database function that reads Interested marks (a new one must be reviewed against the rule above)
  log := log || jsonb_build_array(jsonb_build_object('step', 'readers', 'ok', true, 'data', (
    select coalesce(jsonb_agg(p.proname order by p.proname), '[]'::jsonb) from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.prosrc ~ 'gathering_interested([^_]|$)')));
`);
    s = stepMap(log);
    ids = s.marked.data.ids;
  }, 60000);

  const refused = (v) => typeof v === 'string' && v.startsWith('refused');

  test('the host sees only the number of people Interested, never who', () => {
    expect(s.host.data.count).toBe(3);
    expect(s.host.data.rows).toEqual([]);
  });
  test('each interested person sees their own mark only, and no count', () => {
    expect(s.interested_i1.data.rows).toEqual([ids.i1]);
    expect(s.interested_i2.data.rows).toEqual([ids.i2]);
    expect(refused(s.interested_i1.data.count)).toBe(true);
    expect(refused(s.interested_i2.data.count)).toBe(true);
  });
  test.each(['attendee', 'stranger', 'business_owner', 'signed_out'])('%s: no count and no marks', (who) => {
    expect(refused(s[who].data.count)).toBe(true);
    expect(s[who].data.rows).toEqual([]);
  });
  test('nobody writes or removes another person\'s mark directly; the one writer refuses the host', () => {
    for (const k of ['stranger_inserts_for_i1', 'stranger_inserts_own']) expect(s[k].data).not.toMatch(/^ok/);
    expect(s.host_deletes_marks.data).toBe('ok:0');
    expect(s.attendee_updates_mark.data).toBe('ok:0');
    expect(s.host_marks_own.data).toBe('This is your own gathering');
  });
  test('marking Interested sends the host nothing', () => {
    expect(s.marked.data.host_pushes).toBe(0);
  });
  test('a business never gets Interested as anything identifiable: no row below its floor, no gathering or person id', () => {
    expect(refused(s.business_demand.data.signals)).toBe(false);
    expect(s.business_demand.data.signals.signals.filter((x) => x.kind === 'gathering_interest')).toEqual([]);
    expect(s.business_demand.data.carries_ids).toBe(false);
  });
  test('the host\'s count is the current aggregate: an unmark and a join both leave it', () => {
    expect(s.host_after_changes.data.count).toBe(1);
  });
  test('after cancelling, no count for anyone (no new audience)', () => {
    expect(refused(s.host_after_cancel.data.count)).toBe(true);
    expect(refused(s.interested_i3_after_cancel.data.count)).toBe(true);
    expect(s.interested_i3_after_cancel.data.rows).toEqual([]);
  });
  test('the readers of Interested marks are exactly the reviewed set', () => {
    expect(s.readers.data).toEqual([
      'clear_interested_on_join', // the joiner's own mark, removed on join
      'dismiss_recommended_gathering', // the caller's OWN mark only, to refuse Not interested on their own plan (idea 153)
      'get_gathering_interested_count', // host only, aggregate
      'get_partner_demand_signals', // category aggregate, floor of 5 distinct people, opt-out switch, no ids
      'notify_gathering_cancelled', // tells each interested person themselves
      'notify_gathering_updated', // tells each interested person themselves
      'notify_interested_friend_joined', // tells the interested person a friend joined; nobody learns of them
      'send_gathering_reminders', // the interested person's own reminder
      'set_gathering_interested', // the one writer (the person's own mark)
    ]);
  });
});

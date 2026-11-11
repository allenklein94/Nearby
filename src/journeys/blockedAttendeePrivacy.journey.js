// A host's read of attendance rows respects blocks in BOTH directions (migration 20270411, owner 2026-11-11; staged, run with
// it as JOURNEY_PRELUDE_FILE until live). Every read and write runs as an ordinary signed-in person under the real client role
// (grants, RLS, triggers), in ONE rolled-back transaction. Fails on a database without 20270411 (the host reads blocked rows).
//   Gathering g1 (host H): approved OK, HB (H blocked them), AB (they blocked H); pending PB (H blocked them after the request);
//   waitlisted WB (they blocked H); pending PO (no block).
//   Host: reads OK + PO only (plain read, embed from gatherings, the host's pending list, exact count); approved count stays 3;
//   each blocked person still reads their own row; a fellow attendee still sees HB (no block between them).
//   Unchanged refusals (both directions): a direct insert (item 147's visibility trigger), join_gathering, approving PB;
//   approving PO works; removing OK works.
//   Capacity (g3, 3 incl. host = 2 guests): HB's seat still counts, the next joiner is approved, the one after waitlisted.
//   Invitations and cancellation work; familiarity (20270410) still leaves the blocked person out and the familiar one in.
//   Waitlist promotion never moves up someone blocked either way with the host (they keep their place): g4 (open, 1 guest)
//   promotes W1 past WB + HB when X leaves; raising to "No limit" seats nobody blocked; g5 (approval) moves W2, not HB, to
//   pending; no host match is re-created for a blocked person.
//   Business-hosted gathering: top members and member history leave out a member who blocked the business account.
//   Every row is still there for the database owner (service / moderation): nothing is deleted or changed by a block.
// Not covered here: realtime delivery (follows the same policy; no realtime server in the replay), the phone.
const { runJourney, stepMap, hasToken, actorDeclares, actorsSql, LIFT_GATHERING_CREATION_LIMIT } = require('./journeyHarness');

const d = hasToken ? describe : describe.skip;

const PEOPLE = ['v_h', 'v_ok', 'v_hb', 'v_ab', 'v_pb', 'v_wb', 'v_po', 'v_c1', 'v_c2', 'v_friend', 'v_biz', 'v_bm', 'v_bm2', 'v_x', 'v_w1', 'v_y', 'v_w2'];
const LABELS = PEOPLE.map((p) => `when ${p} then '${p.slice(2)}'`).join(' ');
const who = (col) => `(case ${col} ${LABELS} end)`;

function as(step, sub, stmt, value = `'ok'::text`) {
  return `
  perform set_config('request.jwt.claims', json_build_object('sub', ${sub}, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin ${stmt}; v_out := to_jsonb(${value});
  exception when others then v_out := jsonb_build_object('error', sqlerrm);
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  log := log || jsonb_build_array(jsonb_build_object('step', '${step}', 'ok', true, 'data', v_out));`;
}
const gathering = (v, host, extra = '', when = "now() + interval '2 days'") => `insert into gatherings (host_id, title, scheduled_at, duration_minutes, precise_lat, precise_lng, interest_tag, area, visibility, is_public${extra ? ', capacity' : ''})
    values (${host}, 'Blocked privacy', ${when}, 60, 10.02, -10.03, 'Coffee', 'j', 'everyone', true${extra ? `, ${extra}` : ''}) returning id into ${v};`;
const agg = (col) => `coalesce(jsonb_agg(${who(col)} order by ${who(col)}), '[]')`;
const labels = (where) => `(select ${agg('gi.user_id')} from gathering_interest gi where ${where})`;

d('journey: a host never reads a blocked person\'s attendance row, either direction (20270411)', () => {
  let s;
  beforeAll(async () => {
    const log = await runJourney(`
      ${actorDeclares(PEOPLE)}
      g1 uuid; g2 uuid; g3 uuid; g4 uuid; g5 uuid; g_old uuid; gb uuid; v_partner uuid := gen_random_uuid(); v_out jsonb; v_n int; v_id uuid;`, `
  ${actorsSql({ people: PEOPLE, friends: [['v_h', 'v_friend']], business: { owner: 'v_biz', partner: 'v_partner' } })}
  ${LIFT_GATHERING_CREATION_LIMIT}
  ${gathering('g1', 'v_h')}
  ${gathering('g2', 'v_h')}
  update gatherings set requires_approval = true where id = g2;
  ${gathering('g3', 'v_h', '3')}
  ${gathering('g_old', 'v_h', '', "now() + interval '1 day'")}
  ${gathering('gb', 'v_biz', '', "now() + interval '1 day'")}
  update gatherings set hosting_partner_id = v_partner where id = gb;
  insert into gathering_interest (gathering_id, user_id, status) values
    (g1, v_ok, 'approved'), (g1, v_hb, 'approved'), (g1, v_ab, 'approved'), (g1, v_pb, 'pending'), (g1, v_wb, 'waitlisted'), (g1, v_po, 'pending'),
    (g3, v_hb, 'approved'), (g_old, v_ok, 'approved'), (g_old, v_hb, 'approved'), (gb, v_bm, 'approved'), (gb, v_bm2, 'approved');
  update gatherings set scheduled_at = now() - interval '3 days' where id in (g_old, gb);
  insert into blocks (blocker_id, blocked_id) values (v_h, v_hb), (v_ab, v_h), (v_h, v_pb), (v_wb, v_h), (v_bm, v_biz);
  select count(*) into v_n from gathering_interest where gathering_id in (g1, g3, g_old, gb);
  log := log || jsonb_build_array(jsonb_build_object('step', 'rows_before', 'ok', true, 'data', v_n));

  -- host reads (the app's shapes, in SQL): plain, embed from gatherings, the pending list, exact count
  ${as('host_rows', 'v_h', 'v_n := 0', labels('gi.gathering_id = g1'))}
  ${as('host_embed', 'v_h', 'v_n := 0', `(select ${agg('gi.user_id')} from gatherings g join gathering_interest gi on gi.gathering_id = g.id where g.id = g1)`)}
  ${as('host_pending', 'v_h', 'v_n := 0', `(select ${agg('gi.user_id')} from gathering_interest gi join gatherings g on g.id = gi.gathering_id where gi.status = 'pending' and g.host_id = v_h)`)}
  ${as('host_count', 'v_h', 'select count(*) into v_n from gathering_interest where gathering_id = g1', 'v_n')}
  ${as('host_by_user', 'v_h', 'v_n := 0', labels('gi.user_id in (v_hb, v_ab, v_pb, v_wb)'))}
  ${as('approved_count', 'v_h', 'select c.approved_count into v_n from get_gathering_approved_counts(array[g1]) c', 'v_n')}
  -- the blocked people still read their own rows; a fellow attendee still sees HB
  ${as('own_hb', 'v_hb', 'v_n := 0', labels('gi.user_id = v_hb and gi.gathering_id = g1'))}
  ${as('own_ab', 'v_ab', 'v_n := 0', labels('gi.user_id = v_ab'))}
  ${as('own_pb', 'v_pb', 'v_n := 0', labels('gi.user_id = v_pb'))}
  ${as('own_wb', 'v_wb', 'v_n := 0', labels('gi.user_id = v_wb'))}
  ${as('fellow_sees', 'v_ok', 'v_n := 0', labels(`gi.gathering_id = g1 and gi.status = 'approved'`))}
  ${as('on_my_way_hb', 'v_hb', 'perform set_gathering_on_my_way(g1)')}

  -- writes: direct insert and join (refused both ways, unchanged), approvals, removal
  -- on the staged stack 20270348's profile column limits refuse EVERY direct insert first (the women-only check reads
  -- profiles.gender; the app never inserts directly). That one column is made readable again here (rolled back) so the
  -- check that also holds on production today is the one tested: item 147's visibility trigger.
  if not has_column_privilege('authenticated', 'public.profiles', 'gender', 'select') then
    execute 'grant select (gender) on public.profiles to authenticated';
  end if;
  ${as('direct_hb', 'v_hb', `insert into gathering_interest (gathering_id, user_id, status) values (g2, v_hb, 'pending')`)}
  ${as('direct_ab', 'v_ab', `insert into gathering_interest (gathering_id, user_id, status) values (g2, v_ab, 'pending')`)}
  select count(*) into v_n from gathering_interest where gathering_id = g2;
  log := log || jsonb_build_array(jsonb_build_object('step', 'direct_wrote', 'ok', true, 'data', v_n));
  ${as('join_hb', 'v_hb', 'perform join_gathering(g2)')}
  ${as('join_ab', 'v_ab', 'perform join_gathering(g2)')}
  select id into v_id from gathering_interest where gathering_id = g1 and user_id = v_pb;
  ${as('approve_pb', 'v_h', 'perform approve_gathering_interest(v_id)')}
  select id into v_id from gathering_interest where gathering_id = g1 and user_id = v_po;
  ${as('approve_po', 'v_h', `select a->'status' into v_out from approve_gathering_interest(v_id) a`, 'v_out')}
  select id into v_id from gathering_interest where gathering_id = g1 and user_id = v_ok;
  ${as('remove_ok', 'v_h', `select r->'removed' into v_out from host_remove_gathering_attendee(v_id) r`, 'v_out')}

  -- capacity: 3 incl. host = 2 guests; HB already holds one
  ${as('cap_c1', 'v_c1', `select j->'status' into v_out from join_gathering(g3) j`, 'v_out')}
  ${as('cap_c2', 'v_c2', `select j->'status' into v_out from join_gathering(g3) j`, 'v_out')}
  ${as('cap_host_sees', 'v_h', 'v_n := 0', labels('gi.gathering_id = g3'))}
  ${as('cap_count', 'v_h', 'select c.approved_count into v_n from get_gathering_approved_counts(array[g3]) c', 'v_n')}

  -- waitlist promotion (owner: a block never ADDS access)
  ${gathering('g4', 'v_h', '2')}
  ${gathering('g5', 'v_h', '2')}
  update gatherings set requires_approval = true where id = g5;
  insert into gathering_interest (gathering_id, user_id, status, created_at) values
    (g4, v_x, 'approved', now() - interval '5 min'), (g4, v_wb, 'waitlisted', now() - interval '4 min'),
    (g4, v_hb, 'waitlisted', now() - interval '3 min'), (g4, v_w1, 'waitlisted', now() - interval '2 min'),
    (g5, v_y, 'approved', now() - interval '5 min'), (g5, v_hb, 'waitlisted', now() - interval '4 min'),
    (g5, v_w2, 'waitlisted', now() - interval '3 min');
  ${as('leave_x', 'v_x', 'perform leave_gathering(g4)')}
  ${as('leave_y', 'v_y', 'perform leave_gathering(g5)')}
  select jsonb_build_object('g4', (select jsonb_object_agg(${who('user_id')}, status) from gathering_interest where gathering_id = g4),
    'g5', (select jsonb_object_agg(${who('user_id')}, status) from gathering_interest where gathering_id = g5)) into v_out;
  log := log || jsonb_build_array(jsonb_build_object('step', 'after_leave', 'ok', true, 'data', v_out));
  ${as('no_limit', 'v_h', `select c->'promoted' into v_out from set_gathering_capacity(g4, null) c`, 'v_out')}
  select jsonb_build_object('g4', (select jsonb_object_agg(${who('user_id')}, status) from gathering_interest where gathering_id = g4),
    'host_matches', (select count(*) from matches where (user_a = v_h or user_b = v_h) and (user_a in (v_wb, v_hb) or user_b in (v_wb, v_hb)))) into v_out;
  log := log || jsonb_build_array(jsonb_build_object('step', 'after_no_limit', 'ok', true, 'data', v_out));

  -- invitations and cancellation
  ${as('invite_friend', 'v_h', 'perform invite_friend_to_gathering(g1, v_friend)')}

  -- 20270410 familiarity: g_old ended with OK + HB
  ${as('fam_host', 'v_h', 'v_n := 0', `(select coalesce(jsonb_object_agg(${who('f.person_id')}, f.shared_count), '{}') from get_my_familiar_hosts() f)`)}
  ${as('fam_hb', 'v_hb', 'v_n := 0', `(select coalesce(jsonb_object_agg(${who('f.person_id')}, f.shared_count), '{}') from get_my_familiar_hosts() f)`)}

  -- a business that hosts: BM blocked the business account
  ${as('biz_top', 'v_biz', 'v_n := 0', `(select ${agg('t.user_id')} from get_business_top_members(v_partner) t)`)}
  ${as('biz_hist_bm', 'v_biz', 'select count(*) into v_n from get_business_member_gathering_history(v_partner, v_bm)', 'v_n')}
  ${as('biz_hist_bm2', 'v_biz', 'select count(*) into v_n from get_business_member_gathering_history(v_partner, v_bm2)', 'v_n')}

  -- records: the owner (service / moderation) reads every row; blocked people's rows are unchanged
  select jsonb_build_object(
    'g1', ${labels('gi.gathering_id = g1')},
    'hb_status', (select status from gathering_interest where gathering_id = g1 and user_id = v_hb),
    'hb_on_my_way', (select on_my_way_at is not null from gathering_interest where gathering_id = g1 and user_id = v_hb),
    'ab_status', (select status from gathering_interest where gathering_id = g1 and user_id = v_ab),
    'pb_status', (select status from gathering_interest where gathering_id = g1 and user_id = v_pb),
    'wb_status', (select status from gathering_interest where gathering_id = g1 and user_id = v_wb)) into v_out;
  log := log || jsonb_build_array(jsonb_build_object('step', 'owner_rows', 'ok', true, 'data', v_out));

  ${as('cancel_g1', 'v_h', 'perform cancel_gathering(g1)')}`);
    s = stepMap(log);
  }, 60000);

  test('the host reads no blocked person\'s row, whoever blocked whom, through any read shape', () => {
    expect(s.host_rows.data).toEqual(['ok', 'po']);
    expect(s.host_embed.data).toEqual(['ok', 'po']);
    expect(s.host_pending.data).toEqual(['po']);
    expect(s.host_count.data).toBe(2);
    expect(s.host_by_user.data).toEqual([]);
  });

  test('attendance totals stay accurate: the blocked attendees still count', () => {
    expect(s.approved_count.data).toBe(3);
    expect(s.cap_c1.data).toBe('approved');
    expect(s.cap_c2.data).toBe('waitlisted');
    expect(s.cap_count.data).toBe(2);
    expect(s.cap_host_sees.data).toEqual(['c1', 'c2']);
  });

  test('the blocked people still read their own rows; an unrelated fellow attendee is unaffected', () => {
    expect(s.own_hb.data).toEqual(['hb']);
    expect(s.own_ab.data).toEqual(['ab']);
    expect(s.own_pb.data).toEqual(['pb']);
    expect(s.own_wb.data).toEqual(['wb']);
    expect(s.fellow_sees.data).toEqual(['ab', 'hb', 'ok']);
    expect(s.on_my_way_hb.data).toBe('ok');
  });

  test('unchanged: a direct insert (item 147 trigger), join and approval are refused for a blocked pair, both directions', () => {
    expect(s.direct_hb.data).toEqual({ error: 'Gathering not found' });
    expect(s.direct_ab.data).toEqual({ error: 'Gathering not found' });
    expect(s.direct_wrote.data).toBe(0);
    expect(s.join_hb.data).toEqual({ error: 'Cannot express interest in this gathering' });
    expect(s.join_ab.data).toEqual({ error: 'Cannot express interest in this gathering' });
    expect(s.approve_pb.data).toEqual({ error: 'Cannot approve interest from a blocked user' });
  });

  test('legitimate hosting keeps working: approve, remove, invite, cancel', () => {
    expect(s.approve_po.data).toBe('approved');
    expect(s.remove_ok.data).toBe(true);
    expect(s.invite_friend.data).toBe('ok');
    expect(s.cancel_g1.data).toBe('ok');
  });

  test('a block never adds access: waitlist promotion skips a blocked person both ways, who keeps their place', () => {
    expect(s.leave_x.data).toBe('ok');
    expect(s.leave_y.data).toBe('ok');
    expect(s.after_leave.data).toEqual({ g4: { wb: 'waitlisted', hb: 'waitlisted', w1: 'approved' }, g5: { hb: 'waitlisted', w2: 'pending' } });
    expect(s.no_limit.data).toBe(0);
    expect(s.after_no_limit.data).toEqual({ g4: { wb: 'waitlisted', hb: 'waitlisted', w1: 'approved' }, host_matches: 0 });
  });

  test('familiarity (20270410) is unchanged: the familiar attendee in, the blocked host out (both sides)', () => {
    expect(s.fam_host.data).toEqual({ ok: 1 });
    expect(s.fam_hb.data).toEqual({ ok: 1 });
  });

  test('a hosting business: member lists leave out someone who blocked the business account', () => {
    expect(s.biz_top.data).toEqual(['bm2']);
    expect(s.biz_hist_bm.data).toBe(0);
    expect(s.biz_hist_bm2.data).toBe(1);
  });

  test('records are intact: every row is still there for the owner, statuses unchanged', () => {
    expect(s.rows_before.data).toBe(11);
    expect(s.owner_rows.data).toEqual({
      g1: ['ab', 'hb', 'pb', 'po', 'wb'], hb_status: 'approved', hb_on_my_way: true, ab_status: 'approved', pb_status: 'pending', wb_status: 'waitlisted',
    });
  });
});

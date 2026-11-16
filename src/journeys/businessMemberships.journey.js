// Multi-location foundation (owner, 2026-11-16; migration 20270424, STAGED). One account may be a member of several
// businesses (each a physical location); profiles.managed_partner_id stays the ONE location the account is acting for,
// so every existing business function stays scoped to a single location. Proven through the real roles:
//   * a second approved application no longer moves the owner off the first business (both memberships kept, owner);
//   * a manager set by a trusted path is recorded as staff of only that business;
//   * get_my_businesses lists only the caller's own memberships;
//   * select_managed_business switches only to a membership; outsiders, staff of another location, signed-out and
//     suspended callers are refused with the same answer whether or not the business exists, and nothing changes;
//   * a client still cannot set managed_partner_id directly, nor read or write the membership table;
//   * with location A selected, location B's settings are refused (the existing per-location checks), and A's work
//     never touches B;
//   * people who must hear about B (digest, expiry warning, block check) are its members even while they act for A;
//   * removing a membership moves the account to its remaining business, never leaves it acting for the removed one.
// One rolled-back transaction. Not covered (later build): the location selector, push taps switching location.
jest.mock('../services/supabase', () => ({ supabase: {} }));
const { locationAwareSessionSql, runJourney, stepMap, hasToken, actorDeclares, actorsSql } = require('./journeyHarness');

const d = hasToken ? describe : describe.skip;
const as = (sub) => `perform set_config('request.jwt.claims', json_build_object('sub', ${sub}, 'role', 'authenticated')::text, true);
  set local role authenticated;`;
const asAnon = `perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  set local role anon;`;
const asServer = `reset role; perform set_config('request.jwt.claims', '', true);`;
const rec = (step, expr) => `log := log || jsonb_build_array(jsonb_build_object('step', '${step}', 'ok', true, 'data', ${expr}));`;
const attempt = (step, sql) => `begin
    ${sql}
    ${rec(step, `jsonb_build_object('result', 'allowed')`)}
  exception when others then
    ${rec(step, `jsonb_build_object('result', 'refused', 'msg', sqlerrm, 'hint', (select null::text))`)}
  end;`;
const selected = (who) => `(select managed_partner_id from profiles where id = ${who})`;
const mine = (who) => `(select coalesce(jsonb_agg(jsonb_build_object('partner', m.partner_id, 'role', m.role) order by m.partner_id), '[]'::jsonb)
    from private.business_memberships m where m.user_id = ${who})`;
const app = (who, name, lat) => `${as(who)}
  insert into business_partner_requests (requester_id, business_name, category, subcategory, address, latitude, longitude, location_source)
    values (auth.uid(), '${name}', 'food_drink', 'Coffee', '1 ${name} St', ${lat}, -75.0, 'host_pin') returning id into v_req;
  ${asServer}
  ${as('v_admin')}`;

d('journey: one account manages several locations, each kept separate', () => {
  let s;
  beforeAll(async () => {
    const people = ['v_admin', 'v_owner', 'v_staff', 'v_out', 'v_cust', 'v_susp'];
    const log = await runJourney(`${actorDeclares(people)} v_req uuid; v_pa uuid; v_pb uuid; v_sess uuid; v_r uuid; v_o uuid; v_n int;`, `
  ${actorsSql({ people })}
  update profiles set is_admin = true where id = v_admin;

  -- the owner applies twice; both are approved
  ${app('v_owner', 'Journey Loc A', 40.0)}
  v_pa := approve_business_partner_request(v_req);
  ${asServer}
  ${locationAwareSessionSql('v_owner')}
  ${app('v_owner', 'Journey Loc B', 40.3)}
  v_pb := approve_business_partner_request(v_req);
  ${asServer}
  ${rec('after_two_approvals', `jsonb_build_object('selected_b', ${selected('v_owner')} = v_pb, 'memberships', ${mine('v_owner')},
      'a', v_pa, 'b', v_pb)`)}

  -- a staff member placed at A by a trusted path (as approval / the web claim / an operator would)
  perform set_config('app.trusted_update', 'true', true);
  update profiles set managed_partner_id = v_pa where id in (v_staff, v_susp);
  update profiles set suspended_at = now() where id = v_susp;
  perform set_config('app.trusted_update', 'false', true);
  ${rec('staff', mine('v_staff'))}

  -- what each account sees
  ${as('v_owner')} ${rec('list_owner', `(select coalesce(jsonb_agg(jsonb_build_object('partner', partner_id, 'role', role, 'selected', is_selected) order by partner_id), '[]'::jsonb) from get_my_businesses())`)} reset role;
  ${as('v_staff')} ${rec('list_staff', `(select coalesce(jsonb_agg(partner_id), '[]'::jsonb) from get_my_businesses())`)} reset role;
  ${as('v_out')} ${rec('list_out', `(select count(*) from get_my_businesses())`)} reset role;
  ${asAnon} ${attempt('list_anon', `perform (select count(*) from get_my_businesses());`)} reset role;

  -- switching
  ${as('v_owner')} ${attempt('owner_select_a', `perform select_managed_business(v_pa);`)} reset role;
  ${rec('owner_now', `jsonb_build_object('selected_a', ${selected('v_owner')} = v_pa)`)}
  ${as('v_staff')} ${attempt('staff_select_b', `perform select_managed_business(v_pb);`)} reset role;
  ${as('v_out')} ${attempt('out_select_a', `perform select_managed_business(v_pa);`)} reset role;
  ${as('v_out')} ${attempt('out_select_missing', `perform select_managed_business(gen_random_uuid());`)} reset role;
  ${as('v_susp')} ${attempt('susp_select_a', `perform select_managed_business(v_pa);`)} reset role;
  ${asAnon} ${attempt('anon_select', `perform select_managed_business(v_pa);`)} reset role;
  ${rec('after_refused_switches', `jsonb_build_object('staff_a', ${selected('v_staff')} = v_pa, 'out', ${selected('v_out')},
      'staff_memberships', ${mine('v_staff')}, 'out_memberships', ${mine('v_out')})`)}

  -- direct client writes
  ${as('v_owner')}
  ${attempt('direct_select_b', `update profiles set managed_partner_id = v_pb where id = auth.uid();`)}
  ${attempt('direct_membership_read', `perform (select count(*) from private.business_memberships);`)}
  ${attempt('direct_membership_insert', `insert into private.business_memberships (user_id, partner_id, role) values (auth.uid(), gen_random_uuid(), 'owner');`)}
  reset role;
  ${as('v_out')}
  ${attempt('out_self_member', `update profiles set managed_partner_id = v_pa where id = auth.uid();`)}
  reset role;
  ${rec('after_direct', `jsonb_build_object('owner_a', ${selected('v_owner')} = v_pa, 'out', ${selected('v_out')}, 'out_memberships', ${mine('v_out')})`)}

  -- acting for A: A's settings save, B's are refused (the existing per-location check), B untouched
  ${rec('b_before', `(select to_jsonb(b) from brand_partners b where b.id = v_pb)`)}
  ${as('v_owner')}
  ${attempt('save_a', `perform set_business_max_group_size(v_pa, 12);`)}
  ${attempt('save_b_while_a', `perform set_business_max_group_size(v_pb, 30);`)}
  reset role;
  ${rec('b_after', `(select to_jsonb(b) from brand_partners b where b.id = v_pb)`)}
  ${rec('a_saved', `(select max_group_size from brand_partners where id = v_pa)`)}

  -- B's people hear about B while acting for A
  ${asServer}
  insert into business_requests (requester_id, raw_text, latitude, longitude, expires_at, created_at, status, category, party_size, radius_miles)
    values (v_cust, 'journey multi-location', 40.3, -75.0, now() + interval '90 minutes', now() - interval '3 hours', 'open', 'Coffee', 2, 10)
    returning id into v_r;
  insert into business_request_offers (request_id, partner_id, status, created_at) values (v_r, v_pb, 'pending', now() - interval '3 hours') returning id into v_o;
  ${rec('expiry_candidates', `(select coalesce(jsonb_agg(owner_id), '[]'::jsonb) from _business_request_expiry_warning_candidates() c where c.offer_id = v_o)`)}
  delete from business_opportunity_digest_state where user_id in (v_owner, v_staff);
  update business_requests set expires_at = now() + interval '1 day' where id = v_r;
  update business_request_offers set created_at = now() - interval '1 hour' where id = v_o;
  perform send_business_opportunity_digests();
  ${rec('digests', `(select coalesce(jsonb_agg(jsonb_build_object('to', recipient_id, 'partner', data->>'partner_id', 'count', data->>'count')), '[]'::jsonb)
      from push_outbox where recipient_id in (v_owner, v_staff) and data->>'type' = 'business_opportunities_digest')`)}
  insert into blocks (blocker_id, blocked_id) values (v_cust, v_owner);
  ${as('v_cust')} ${rec('blocked_b', `jsonb_build_object('b', partner_owner_blocked_with_me(v_pb), 'a', partner_owner_blocked_with_me(v_pa))`)} reset role;

  -- removing the owner's A membership moves them to B; removing staff's only membership leaves them with none
  ${asServer}
  delete from private.business_memberships where user_id = v_owner and partner_id = v_pa;
  delete from private.business_memberships where user_id = v_staff and partner_id = v_pa;
  ${rec('after_removal', `jsonb_build_object('owner_b', ${selected('v_owner')} = v_pb, 'staff', ${selected('v_staff')}, 'owner_memberships', ${mine('v_owner')})`)}
  ${as('v_owner')} ${attempt('select_removed', `perform select_managed_business(v_pa);`)} reset role;`);
    s = stepMap(log);
  }, 120000);

  test('a second approved application keeps the first business: two memberships, both owner, the newest selected', () => {
    const { a, b } = s.after_two_approvals.data;
    expect(s.after_two_approvals.data.selected_b).toBe(true);
    expect(s.after_two_approvals.data.memberships).toEqual(
      [{ partner: a, role: 'owner' }, { partner: b, role: 'owner' }].sort((x, y) => (x.partner < y.partner ? -1 : 1)));
  });

  test('a manager set by a trusted path is staff of only that business', () => {
    expect(s.staff.data).toEqual([{ partner: s.after_two_approvals.data.a, role: 'staff' }]);
  });

  test('get_my_businesses lists only the caller’s own memberships', () => {
    const { a, b } = s.after_two_approvals.data;
    expect(s.list_owner.data.map((r) => r.partner).sort()).toEqual([a, b].sort());
    expect(s.list_owner.data.find((r) => r.partner === b).selected).toBe(true);
    expect(s.list_staff.data).toEqual([a]);
    expect(s.list_out.data).toBe(0);
    expect(s.list_anon.data.result).toBe('refused');
  });

  test('switching works only to a membership; every other caller is refused the same way and nothing changes', () => {
    expect(s.owner_select_a.data.result).toBe('allowed');
    expect(s.owner_now.data.selected_a).toBe(true);
    for (const k of ['staff_select_b', 'out_select_a', 'out_select_missing']) {
      expect([k, s[k].data.result, s[k].data.msg]).toEqual([k, 'refused', 'Business not found']);
    }
    expect(s.susp_select_a.data).toMatchObject({ result: 'refused', msg: expect.stringMatching(/suspended/i) });
    expect(s.anon_select.data).toMatchObject({ result: 'refused', msg: expect.stringMatching(/permission denied/i) });
    expect(s.after_refused_switches.data).toEqual({
      staff_a: true, out: null, staff_memberships: s.staff.data, out_memberships: [],
    });
  });

  test('a client cannot set its business directly or touch the membership table', () => {
    expect(s.direct_membership_read.data.result).toBe('refused');
    expect(s.direct_membership_insert.data.result).toBe('refused');
    expect(s.after_direct.data).toEqual({ owner_a: true, out: null, out_memberships: [] });
  });

  test('acting for A, B’s settings are refused and B is untouched', () => {
    expect(s.save_a.data.result).toBe('allowed');
    expect(s.a_saved.data).toBe(12);
    expect(s.save_b_while_a.data.result).toBe('refused');
    expect(s.b_after.data).toEqual(s.b_before.data);
  });

  test('B’s members hear about B while acting for A; A-only staff do not', () => {
    const { b } = s.after_two_approvals.data;
    expect(s.expiry_candidates.data).toEqual([expect.any(String)]);
    expect(s.digests.data).toEqual([{ to: expect.any(String), partner: b, count: '1' }]);
    expect(s.digests.data[0].to).toBe(s.expiry_candidates.data[0]);
    expect(s.blocked_b.data).toEqual({ b: true, a: true }); // the owner is a member of both
  });

  test('removing a membership never leaves the account acting for that business', () => {
    expect(s.after_removal.data.owner_b).toBe(true);
    expect(s.after_removal.data.staff).toBeNull();
    expect(s.after_removal.data.owner_memberships).toEqual([{ partner: s.after_two_approvals.data.b, role: 'owner' }]);
    expect(s.select_removed.data.result).toBe('refused');
  });
});

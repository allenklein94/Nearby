// Journey (owner, 2026-11-15; migration 20270422): a customer's read receipt on a business reply never reaches the business.
//   * a stranger can't mark someone else's reply viewed; the requester can (once: a repeat changes nothing);
//   * the receipt is stored in business_offer_views, never on the offer row (viewed_at stays NULL, by constraint);
//   * the requester reads their own receipt; the BUSINESS that sent the reply reads nothing: no receipt row, NULL on
//     its own offer row, no viewed_at in get_business_opportunities, no viewed_count in get_partner_offer_performance;
//   * no client can write a receipt or set viewed_at on the offer row; signed out reads nothing.
// Every read runs as an ordinary signed-in user (or signed out) under the real role + JWT claims, as a direct REST call
// with the app's public key would. One rolled-back transaction. Not covered: realtime delivery itself (opening a reply
// writes only business_offer_views, which is not in the realtime publication; the offer row's viewed_at stays NULL),
// the app screens.
const { runJourney, stepMap, hasToken, actorsSql, journeyPeople, journeyOwner } = require('./journeyHarness');

const d = hasToken ? describe : describe.skip;

function as(step, role, sub, stmt, value = `'ok'::text`) {
  const claims = role === 'anon' ? `'{"role":"anon"}'` : `json_build_object('sub', ${sub}, 'role', 'authenticated')::text`;
  return `
  perform set_config('request.jwt.claims', ${claims}, true);
  set local role ${role};
  begin ${stmt}; v_out := to_jsonb(${value});
  exception when others then
    v_out := jsonb_build_object('error', sqlerrm, 'code', sqlstate);
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  log := log || jsonb_build_array(jsonb_build_object('step', '${step}', 'ok', true, 'data', v_out));`;
}
const user = (step, sub, stmt, value) => as(step, 'authenticated', sub, stmt, value);

d('journey: a customer opening a business reply is never visible to the business (20270422)', () => {
  let s;
  beforeAll(async () => {
    const owner = journeyOwner();
    const [host, stranger] = journeyPeople(2);
    const log = await runJourney(`
      v_owner uuid := '${owner.id}'; v_partner uuid := '${owner.managed_partner_id}'; v_host uuid := '${host.id}'; v_stranger uuid := '${stranger.id}';
      v_g uuid; v_res jsonb; v_req uuid; v_offer uuid; v_out jsonb; v_n int; v_t timestamptz; v_j jsonb;`, `
  ${actorsSql({ people: ['v_owner', 'v_host', 'v_stranger'], business: { owner: 'v_owner', partner: 'v_partner' } })}
  update brand_partners set active = true, latitude = 40.0, longitude = -75.0 where id = v_partner;

  perform set_config('request.jwt.claims', json_build_object('sub', v_host, 'role', 'authenticated')::text, true);
  insert into gatherings (host_id, title, scheduled_at, precise_lat, precise_lng, interest_tag, area, capacity, visibility)
    values (v_host, 'Receipt journey coffee', now() + interval '3 days', 40.0, -75.0, 'Coffee', 'journey', 8, 'everyone') returning id into v_g;
  v_res := create_business_request_for_gathering(v_g, 'Coffee for the group', 'Coffee', 20, 15, null, null, v_partner, null);
  v_req := (v_res->>'requestId')::uuid;
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  v_res := submit_business_offer(request_id_param := v_req, offer_type_param := 'standard',
     offer_description_param := 'We can accommodate this as requested.', offer_price_param := 12.5);
  select id into v_offer from business_request_offers where request_id = v_req and partner_id = v_partner;
  perform set_config('request.jwt.claims', '', true);
  log := log || jsonb_build_array(jsonb_build_object('step', 'setup', 'ok', v_offer is not null,
    'data', (select status from business_request_offers where id = v_offer)));

  ${user('stranger_marks', 'v_stranger', 'perform public.mark_business_offer_viewed(v_offer)',
    `(select count(*) from public.business_offer_views where offer_id = v_offer)`)}
  ${user('requester_marks', 'v_host', 'perform public.mark_business_offer_viewed(v_offer)', `'ok'::text`)}
  select viewed_at into v_t from public.business_offer_views where offer_id = v_offer;
  ${user('requester_marks_again', 'v_host', 'perform public.mark_business_offer_viewed(v_offer)', `'ok'::text`)}
  log := log || jsonb_build_array(jsonb_build_object('step', 'stored', 'ok', true, 'data', jsonb_build_object(
    'receipts', (select count(*) from public.business_offer_views where offer_id = v_offer),
    'unchanged_by_repeat', (select viewed_at from public.business_offer_views where offer_id = v_offer) = v_t,
    'offer_row_viewed_at', (select viewed_at from business_request_offers where id = v_offer),
    'constraint', exists (select 1 from pg_constraint where conname = 'business_request_offers_viewed_at_moved'))));

  ${user('requester_reads_receipt', 'v_host', `select count(*) into v_n from public.business_offer_views where offer_id = v_offer and viewed_at is not null`, 'v_n')}
  ${user('business_reads_receipt', 'v_owner', `select count(*) into v_n from public.business_offer_views`, 'v_n')}
  ${user('business_reads_offer_row', 'v_owner', `select jsonb_build_object('visible', count(*), 'viewed', count(viewed_at)) into v_j from public.business_request_offers where id = v_offer`, 'v_j')}
  ${user('business_opportunities', 'v_owner', `select jsonb_build_object(
      'found', count(*), 'has_viewed_key', coalesce(bool_or(e ? 'viewed_at'), false), 'has_viewed_text', coalesce(bool_or(e::text like '%viewed%'), false))
      into v_j from jsonb_array_elements(public.get_business_opportunities(v_partner)) e where e->>'id' = v_offer::text`, 'v_j')}
  ${user('business_performance', 'v_owner', `select jsonb_build_object('rows', count(*), 'has_viewed', coalesce(bool_or(to_jsonb(p) ? 'viewed_count'), false),
      'offers', coalesce(sum(p.offer_count), 0)) into v_j from public.get_partner_offer_performance(v_partner) p`, 'v_j')}
  log := log || jsonb_build_array(jsonb_build_object('step', 'performance_signature', 'ok', true,
    'data', (select pg_get_function_result(p.oid) from pg_proc p where p.proname = 'get_partner_offer_performance' and p.pronamespace = 'public'::regnamespace)));

  ${user('client_inserts_receipt', 'v_owner', `insert into public.business_offer_views (offer_id) values (v_offer)`)}
  ${user('requester_inserts_receipt', 'v_host', `insert into public.business_offer_views (offer_id) values (v_offer)`)}
  ${user('client_sets_offer_viewed_at', 'v_host', `update public.business_request_offers set viewed_at = now() where id = v_offer`,
    `(select count(viewed_at) from public.business_request_offers where id = v_offer)`)}
  ${as('anon_reads_receipts', 'anon', 'null', `select count(*) into v_n from public.business_offer_views`, 'v_n')}
  log := log || jsonb_build_array(jsonb_build_object('step', 'service_role_still_sees', 'ok', true,
    'data', (select count(*) from public.business_offer_views where offer_id = v_offer)));
`);
    s = stepMap(log);
  });

  it('a stranger cannot mark another person\'s reply viewed', () => {
    expect(s.setup.ok).toBe(true);
    expect(Number(s.stranger_marks.data)).toBe(0);
  });
  it('the requester\'s receipt is stored once, never on the offer row', () => {
    expect(s.stored.data).toEqual({ receipts: 1, unchanged_by_repeat: true, offer_row_viewed_at: null, constraint: true });
  });
  it('the requester reads their own receipt', () => {
    expect(Number(s.requester_reads_receipt.data)).toBe(1);
  });
  it('the business reads no receipt, directly or through its functions', () => {
    expect(Number(s.business_reads_receipt.data)).toBe(0);
    expect(s.business_reads_offer_row.data).toEqual({ visible: 1, viewed: 0 });
    expect(s.business_opportunities.data).toEqual({ found: 1, has_viewed_key: false, has_viewed_text: false });
    expect(s.business_performance.data.has_viewed).toBe(false);
    expect(Number(s.business_performance.data.offers)).toBe(1);
    expect(s.performance_signature.data).not.toMatch(/viewed/);
  });
  it('no client can write a receipt or a viewed_at, and signed out reads nothing', () => {
    expect(s.client_inserts_receipt.data.code).toBe('42501');
    expect(s.requester_inserts_receipt.data.code).toBe('42501');
    // refused outright, or (no client UPDATE policy) changes nothing: the offer row's viewed_at stays NULL either way
    const upd = s.client_sets_offer_viewed_at.data;
    expect(upd?.code ? true : Number(upd) === 0).toBe(true);
    expect(s.anon_reads_receipts.data.code).toBe('42501');
    expect(Number(s.service_role_still_sees.data)).toBe(1);
  });
});

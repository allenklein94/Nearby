// Owner item 147 (2026-10-17, approved, high priority security): a gathering row is readable only by someone who may see
// it, decided in the database by ONE rule (_gathering_row_visible). Every actor runs under the REAL database role the API
// uses (`set local role anon` / `authenticated` + the JWT claims), so the RLS policy and grants are exercised, not bypassed:
//   per actor (signed out, stranger, woman stranger, friend of the host, community member, invitee, pending request,
//   waitlisted, approved attendee, host, blocked friend, partner business owner), over one host's gatherings of every kind
//   (public, link-only, friends, community, invite-only, women-only, partnered friends-only, invite-only with a pending
//   partnership request): which rows a plain read returns, and the same set from every by-id RPC (distances/pin, approved
//   counts, attendee breakdown, first-timer count) and id list (bounded nearby, trending), the gathering's Q&A, and its
//   cover photo objects.
//   Writes: joining / Interested / inviting / asking a question on a gathering the caller may not see is refused with the
//   same 'Gathering not found' as a missing id; the legitimate versions still work; the host's own insert/update
//   `returning` still works.
// Rolled back. Coordinates are mid-Atlantic so no real gathering is involved.
const { runJourney, stepMap, hasToken } = require('./journeyHarness');

const d = hasToken ? describe : describe.skip;

const LAT = 12.445678;
const LNG = -45.778912;
const KEYS = ['pub', 'link', 'friends', 'comm', 'invite', 'women', 'partnered', 'asked'];

// What `sub` (null = signed out) sees of the journey's gatherings, through every read path, under `role`.
function probe(step, role, sub) {
  const claims = sub
    ? `json_build_object('sub', ${sub}, 'role', 'authenticated')::text`
    : `json_build_object('role', 'anon')::text`;
  const names = (from) => `(select coalesce(jsonb_agg(k order by k), '[]'::jsonb) from (select distinct v_names->>(x.id::text) k from ${from} x) s where k is not null)`;
  return `
  perform set_config('request.jwt.claims', ${claims}, true);
  set local role ${role};
  v_rows := ${names('(select id from gatherings where id = any(v_ids))')};
  begin v_dist := ${names('get_gathering_distances(0, 0, v_ids)')};
  exception when insufficient_privilege then v_dist := '"denied"'; end;
  begin v_counts := ${names('(select gathering_id id from get_gathering_approved_counts(v_ids))')};
  exception when insufficient_privilege then v_counts := '"denied"'; when others then v_counts := to_jsonb(sqlerrm); end;
  begin v_bounded := ${names(`get_bounded_nearby_gathering_ids(${LAT}, ${LNG}, 50)`)};
  exception when insufficient_privilege then v_bounded := '"denied"'; end;
  begin v_trend := ${names(`get_trending_gathering_ids('J147-area')`)};
  exception when insufficient_privilege then v_trend := '"denied"'; end;
  begin v_breakdown := ${names(`(select v_ids[i] id from generate_subscripts(v_ids, 1) i, get_gathering_attendee_breakdown(v_ids[i]) b where b.total_attending > 0)`)};
  exception when insufficient_privilege then v_breakdown := '"denied"'; end;
  begin v_first := ${names(`(select v_ids[i] id from generate_subscripts(v_ids, 1) i where get_gathering_first_timer_count(v_ids[i]) > 0)`)};
  exception when insufficient_privilege then v_first := '"denied"'; end;
  v_qa := ${names('(select gathering_id id from gathering_questions where gathering_id = any(v_ids))')};
  begin v_photos := ${names(`(select (storage.foldername(name))[1]::uuid id from storage.objects where bucket_id = 'gathering-photos' and (storage.foldername(name))[1] = any(v_id_texts))`)};
  exception when insufficient_privilege then v_photos := '"denied"'; end; -- anon: another storage policy's check_is_admin() refuses anon
  reset role;
  log := log || jsonb_build_array(jsonb_build_object('step', '${step}', 'ok', true, 'data', jsonb_build_object(
    'rows', v_rows, 'distances', v_dist, 'counts', v_counts, 'bounded', v_bounded, 'trending', v_trend,
    'breakdown', v_breakdown, 'first_timers', v_first, 'questions', v_qa, 'photos', v_photos)));`;
}

// A write attempted as `sub` under the real role; records 'ok' or the error text.
function attempt(step, sub, stmt) {
  return `
  perform set_config('request.jwt.claims', json_build_object('sub', ${sub}, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin ${stmt}; v_err := 'ok';
  exception when others then v_err := sqlerrm; end;
  reset role;
  log := log || jsonb_build_array(jsonb_build_object('step', '${step}', 'ok', true, 'data', to_jsonb(v_err)));`;
}

d('journey: a gathering row reaches only the people who may see it, on every database path', () => {
  let s;
  beforeAll(async () => {
    const log = await runJourney(`
      v_host uuid := gen_random_uuid(); v_str uuid := gen_random_uuid(); v_wom uuid := gen_random_uuid();
      v_fr uuid := gen_random_uuid(); v_mem uuid := gen_random_uuid(); v_inv uuid := gen_random_uuid();
      v_pend uuid := gen_random_uuid(); v_wait uuid := gen_random_uuid(); v_fill uuid := gen_random_uuid();
      v_blk uuid := gen_random_uuid(); v_po uuid := gen_random_uuid(); v_p uuid := gen_random_uuid(); u uuid;
      v_comm uuid; g_pub uuid; g_link uuid; g_friends uuid; g_comm uuid; g_invite uuid; g_women uuid; g_partnered uuid; g_asked uuid;
      g_new uuid; v_title text;
      v_ids uuid[]; v_id_texts text[]; v_names jsonb;
      v_rows jsonb; v_dist jsonb; v_counts jsonb; v_bounded jsonb; v_trend jsonb; v_breakdown jsonb; v_first jsonb;
      v_qa jsonb; v_photos jsonb; v_err text;`, `
  perform set_config('app.trusted_update', 'on', true);
  perform set_config('app.push_handoff_test_failure', 'on', true);
  foreach u in array array[v_host, v_str, v_wom, v_fr, v_mem, v_inv, v_pend, v_wait, v_fill, v_blk, v_po] loop
    insert into auth.users (id, aud, role, email) values (u, 'authenticated', 'authenticated', u || '@j147.test');
    update auth.users set phone = '1555' || lpad(((('x0' || substr(md5(id::text), 1, 7))::bit(32)::int) % 100000000)::text, 8, '0'), phone_confirmed_at = now() where id in (u);
    insert into profiles (id, display_name, birthdate) values (u, 'J147-' || left(u::text, 4), date '1990-01-01');
  end loop;
  update profiles set gender = 'female' where id in (v_wom, v_host, v_fill);
  insert into brand_partners (id, name, active, latitude, longitude, subcategory) values (v_p, 'J147 Cafe', true, ${LAT}, ${LNG}, 'Coffee');
  update profiles set managed_partner_id = v_p where id = v_po;
  insert into friendships (user_a, user_b, status, requested_by) values
    (v_host, v_fr, 'accepted', v_host), (v_host, v_blk, 'accepted', v_host), (v_str, v_wom, 'accepted', v_str);
  insert into communities (name, creator_id) values ('J147 community', v_host) returning id into v_comm;
  insert into community_members (community_id, user_id) values (v_comm, v_mem), (v_comm, v_blk)
    on conflict do nothing;
  insert into blocks (blocker_id, blocked_id) values (v_host, v_blk);

  perform set_config('request.jwt.claims', json_build_object('sub', v_host, 'role', 'authenticated')::text, true);
  insert into gatherings (host_id, title, scheduled_at, precise_lat, precise_lng, interest_tag, area, wide_area, capacity, visibility, is_public, discoverable, women_only, community_id, hosting_partner_id)
    values (v_host, 'J147 pub', now() + interval '1 day', ${LAT}, ${LNG}, 'Coffee', 'journey', 'J147-area', 10, 'everyone', true, true, false, null, null) returning id into g_pub;
  insert into gatherings (host_id, title, scheduled_at, precise_lat, precise_lng, interest_tag, area, wide_area, capacity, visibility, is_public, discoverable)
    values (v_host, 'J147 link', now() + interval '1 day', ${LAT}, ${LNG}, 'Coffee', 'journey', 'J147-area', 10, 'everyone', true, false) returning id into g_link;
  insert into gatherings (host_id, title, scheduled_at, precise_lat, precise_lng, interest_tag, area, wide_area, capacity, visibility, is_public)
    values (v_host, 'J147 friends', now() + interval '1 day', ${LAT}, ${LNG}, 'Coffee', 'journey', 'J147-area', 10, 'friends', false) returning id into g_friends;
  insert into gatherings (host_id, title, scheduled_at, precise_lat, precise_lng, interest_tag, area, wide_area, capacity, visibility, is_public, community_id)
    values (v_host, 'J147 comm', now() + interval '1 day', ${LAT}, ${LNG}, 'Coffee', 'journey', 'J147-area', 10, 'community', false, v_comm) returning id into g_comm;
  insert into gatherings (host_id, title, scheduled_at, precise_lat, precise_lng, interest_tag, area, wide_area, capacity, visibility, is_public)
    values (v_host, 'J147 invite', now() + interval '1 day', ${LAT}, ${LNG}, 'Coffee', 'journey', 'J147-area', 10, 'invite_only', false) returning id into g_invite;
  insert into gatherings (host_id, title, scheduled_at, precise_lat, precise_lng, interest_tag, area, wide_area, capacity, visibility, is_public, women_only)
    values (v_host, 'J147 women', now() + interval '1 day', ${LAT}, ${LNG}, 'Coffee', 'journey', 'J147-area', 10, 'everyone', true, true) returning id into g_women;
  insert into gatherings (host_id, title, scheduled_at, precise_lat, precise_lng, interest_tag, area, wide_area, capacity, visibility, is_public, hosting_partner_id)
    values (v_host, 'J147 partnered', now() + interval '1 day', ${LAT}, ${LNG}, 'Coffee', 'journey', 'J147-area', 10, 'friends', false, v_p) returning id into g_partnered;
  insert into gatherings (host_id, title, scheduled_at, precise_lat, precise_lng, interest_tag, area, wide_area, capacity, visibility, is_public)
    values (v_host, 'J147 asked', now() + interval '1 day', ${LAT}, ${LNG}, 'Coffee', 'journey', 'J147-area', 10, 'invite_only', false) returning id into g_asked;
  insert into business_partnership_requests (requester_id, target_type, target_id, partner_id, status)
    values (v_host, 'gathering', g_asked, v_p, 'pending');
  insert into social_invites (inviter_id, invitee_id, invite_type, target_id, status) values (v_host, v_inv, 'gathering', g_invite, 'pending');
  v_ids := array[g_pub, g_link, g_friends, g_comm, g_invite, g_women, g_partnered, g_asked];
  v_id_texts := array(select x::text from unnest(v_ids) x);
  v_names := jsonb_build_object(g_pub, 'pub', g_link, 'link', g_friends, 'friends', g_comm, 'comm', g_invite, 'invite',
    g_women, 'women', g_partnered, 'partnered', g_asked, 'asked');
  -- one approved first-timer on every gathering (so counts / trending / breakdowns have something to return), plus the
  -- pending and waitlisted actors' own rows, written by the host the way approve/waitlist paths do
  insert into gathering_interest (gathering_id, user_id, status) select x, v_fill, 'approved' from unnest(v_ids) x;
  insert into gathering_interest (gathering_id, user_id, status) values (g_comm, v_pend, 'pending'), (g_invite, v_wait, 'waitlisted');
  insert into gathering_questions (gathering_id, asker_id, question_body) select x, v_fill, 'J147 question?' from unnest(v_ids) x;
  insert into storage.objects (bucket_id, name, owner) select 'gathering-photos', x || '/cover-j147.jpg', v_host from unnest(v_ids) x;

  ${probe('anon', 'anon', null)}
  ${probe('stranger', 'authenticated', 'v_str')}
  ${probe('woman_stranger', 'authenticated', 'v_wom')}
  ${probe('friend', 'authenticated', 'v_fr')}
  ${probe('member', 'authenticated', 'v_mem')}
  ${probe('invitee', 'authenticated', 'v_inv')}
  ${probe('pending', 'authenticated', 'v_pend')}
  ${probe('waitlisted', 'authenticated', 'v_wait')}
  ${probe('approved', 'authenticated', 'v_fill')}
  ${probe('host', 'authenticated', 'v_host')}
  ${probe('blocked_friend', 'authenticated', 'v_blk')}
  ${probe('partner_owner', 'authenticated', 'v_po')}

  -- writes that would have granted visibility, refused
  ${attempt('stranger_joins_friends', 'v_str', 'perform join_gathering(g_friends)')}
  ${attempt('stranger_joins_community', 'v_str', 'perform join_gathering(g_comm)')}
  ${attempt('stranger_inserts_join_row', 'v_str', "insert into gathering_interest (gathering_id, user_id, status) values (g_invite, v_str, 'pending')")}
  ${attempt('man_inserts_women_only_row', 'v_str', "insert into gathering_interest (gathering_id, user_id, status) values (g_women, v_str, 'pending')")}
  ${attempt('stranger_interested_friends', 'v_str', 'perform set_gathering_interested(g_friends, true)')}
  ${attempt('stranger_invites_to_friends', 'v_str', "perform send_social_invite('gathering', g_friends, v_wom)")}
  ${attempt('stranger_asks_on_invite', 'v_str', "insert into gathering_questions (gathering_id, asker_id, question_body) values (g_invite, v_str, 'J147 sneaky?')")}
  -- the legitimate versions still work
  ${attempt('friend_joins_friends', 'v_fr', 'perform join_gathering(g_friends)')}
  ${attempt('member_joins_community', 'v_mem', 'perform join_gathering(g_comm)')}
  ${attempt('stranger_interested_public', 'v_str', 'perform set_gathering_interested(g_pub, true)')}
  ${attempt('stranger_invites_to_public', 'v_str', "perform send_social_invite('gathering', g_pub, v_wom)")}
  ${attempt('stranger_asks_on_public', 'v_str', "insert into gathering_questions (gathering_id, asker_id, question_body) values (g_pub, v_str, 'J147 fine?')")}
  ${attempt('host_creates_returning', 'v_host', `insert into gatherings (host_id, title, scheduled_at, interest_tag, area, visibility, is_public)
      values (v_host, 'J147 created', now() + interval '2 day', 'Coffee', 'journey', 'invite_only', false) returning id into g_new`)}
  ${attempt('host_edits_returning', 'v_host', "update gatherings set title = 'J147 edited' where id = g_new returning title into v_title")}
  log := log || jsonb_build_array(jsonb_build_object('step', 'host_write_results', 'ok', true, 'data', jsonb_build_object(
    'created', g_new is not null, 'edited_title', v_title)));
  log := log || jsonb_build_array(jsonb_build_object('step', 'policy', 'ok', true, 'data', jsonb_build_object(
    'select_policies', (select jsonb_agg(polname order by polname) from pg_policy where polrelid = 'public.gatherings'::regclass and polcmd = 'r'),
    'any_true_select', exists (select 1 from pg_policy where polrelid = 'public.gatherings'::regclass and polcmd in ('r', '*')
      and pg_get_expr(polqual, polrelid) = 'true'))));`);
    s = stepMap(log);
  }, 180000);

  const data = (k) => s[k].data;
  const ALL = [...KEYS].sort();
  const sorted = (a) => [...a].sort();
  // Every read path agrees with the plain row read (the counts and trending lists only hold gatherings with an attendee,
  // which every journey gathering has; bounded excludes link-only by design, and the host's own).
  function expectSees(k, keys) {
    const want = sorted(keys);
    const v = data(k);
    expect(v.rows).toEqual(want);
    expect(v.distances).toEqual(want);
    expect(v.counts).toEqual(want);
    expect(v.trending).toEqual(want.filter((x) => x !== 'link'));
    expect(v.breakdown).toEqual(want);
    expect(v.first_timers).toEqual(want);
    expect(v.questions).toEqual(want);
    expect(v.photos).toEqual(want);
    expect(v.bounded).toEqual(k === 'host' ? [] : want.filter((x) => x !== 'link'));
  }

  test('signed out: no row, no Q&A, no photo; the by-id RPCs are not callable', () => {
    const v = data('anon');
    expect(v.rows).toEqual([]);
    expect(v.questions).toEqual([]);
    expect(v.photos).not.toEqual(expect.arrayContaining(['pub']));
    for (const f of ['distances', 'bounded', 'trending', 'breakdown', 'first_timers']) expect(v[f]).toBe('denied');
    expect(v.counts).toBe('denied');
  });

  test('stranger: only public + link-only (not women-only for a man)', () => expectSees('stranger', ['pub', 'link']));
  test('woman stranger: public, link-only, women-only', () => expectSees('woman_stranger', ['pub', 'link', 'women']));
  test("friend of the host: public, link-only, the host's friends-only ones", () => expectSees('friend', ['pub', 'link', 'friends', 'partnered']));
  test('community member: public, link-only, the community one', () => expectSees('member', ['pub', 'link', 'comm']));
  test('invitee (pending invite): public, link-only, the invite-only one', () => expectSees('invitee', ['pub', 'link', 'invite']));
  test('pending request: keeps seeing the gathering it asked to join', () => expectSees('pending', ['pub', 'link', 'comm']));
  test('waitlisted: keeps seeing the gathering it is waitlisted for', () => expectSees('waitlisted', ['pub', 'link', 'invite']));
  test('approved attendee: every gathering it attends', () => expectSees('approved', ALL));
  test('host: every own gathering (bounded nearby never lists your own)', () => expectSees('host', ALL));
  test('blocked by the host (though a friend + community member): nothing of the host', () => expectSees('blocked_friend', []));
  test('partner business owner: public, link-only, the partnered one and the one it was asked to partner', () =>
    expectSees('partner_owner', ['pub', 'link', 'partnered', 'asked']));

  test.each([
    'stranger_joins_friends', 'stranger_joins_community', 'stranger_inserts_join_row', 'man_inserts_women_only_row',
    'stranger_interested_friends', 'stranger_invites_to_friends',
  ])('%s: refused with the same error a missing gathering gets', (k) => {
    expect(data(k)).toBe('Gathering not found');
  });

  test('asking a question on a gathering you may not see is refused by the policy', () => {
    expect(data('stranger_asks_on_invite')).toMatch(/row-level security/);
  });

  test.each([
    'friend_joins_friends', 'member_joins_community', 'stranger_interested_public', 'stranger_invites_to_public',
    'stranger_asks_on_public', 'host_creates_returning', 'host_edits_returning',
  ])('%s: still works', (k) => {
    expect(data(k)).toBe('ok');
  });

  test("the host's insert/update returning get their row back", () => {
    expect(data('host_write_results')).toEqual({ created: true, edited_title: 'J147 edited' });
  });

  test('gatherings has one SELECT policy and it is not `true`', () => {
    expect(data('policy')).toEqual({ select_policies: ['Gatherings visible to who may see them'], any_true_select: false });
  });
});

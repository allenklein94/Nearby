// Owner idea 156 (2026-10-17): swiping is a choice, never a requirement for meeting friends. Migration 20270328.
// Every actor runs under the REAL database role the API uses (`set local role authenticated` + JWT claims), so RLS, the
// column's check and each function's own checks are exercised. One story:
//   a new person opens Friends -> it is the list (column default) -> they switch to the optional deck and back (their own
//   row only; another person cannot change it; Dating's own view setting is untouched; a junk value is refused) -> from the
//   list they Pass on one person and Connect with another (the two labelled actions' directions) -> each leaves their
//   candidates -> the other person Connects back -> a mutual friend match -> eligibility and the separate pool unchanged
//   (a person who never opted in is never a candidate and can't be connected to). Rolled back.
const { runJourney, stepMap, hasToken } = require('./journeyHarness');
const { friendViewStyle, otherFriendViewStyle, undecidedCandidates, FRIEND_DECISIONS } = require('../utils/friendDiscoveryView');

const d = hasToken ? describe : describe.skip;

// A statement run as `sub` (authenticated); records its jsonb result / 'ok', or the error text.
function as(step, sub, stmt) {
  return `
  perform set_config('request.jwt.claims', json_build_object('sub', ${sub}, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin v_res := null; ${stmt}; v_err := coalesce(v_res::text, 'ok');
  exception when others then v_err := 'error: ' || sqlerrm; end;
  reset role;
  log := log || jsonb_build_array(jsonb_build_object('step', '${step}', 'ok', true, 'data', to_jsonb(v_err)));`;
}

// The person's own row is read the way the app reads it (readMyProfile): get_my_profile() once N6 (20270348) is live,
// a direct read before it.
const myStyle = (sub) => `if to_regprocedure('public.get_my_profile()') is not null then
      execute 'select to_jsonb(friend_discovery_view_style) from public.get_my_profile()' into v_res;
    else select to_jsonb(p.friend_discovery_view_style) into v_res from profiles p where p.id = ${sub}; end if`;
const candidates = (sub) => `select coalesce(jsonb_agg(c.id order by c.id), '[]'::jsonb) into v_res from get_friend_discovery_candidates(20) c where c.id in (v_a, v_b, v_c, v_x)`;
const decide = (target, direction) => `select to_jsonb(r) into v_res from record_friend_discovery_swipe(${target}, '${direction}') r`;

d('journey: Friends discovery opens as a list, the deck is optional, Pass and Connect decide', () => {
  let s;
  let ids;
  beforeAll(async () => {
    const log = await runJourney(`
      v_a uuid := gen_random_uuid(); v_b uuid := gen_random_uuid(); v_c uuid := gen_random_uuid(); v_x uuid := gen_random_uuid();
      u uuid; v_res jsonb; v_err text;`, `
  perform set_config('app.trusted_update', 'on', true);
  foreach u in array array[v_a, v_b, v_c, v_x] loop
    insert into auth.users (id, aud, role, email) values (u, 'authenticated', 'authenticated', u || '@jfd.test');
    update auth.users set phone = '1555' || lpad(((('x0' || substr(md5(id::text), 1, 7))::bit(32)::int) % 100000000)::text, 8, '0'), phone_confirmed_at = now() where id in (u);
    -- signed up with a screened photo (Friends Browse only offers profiles others may see, 20270351)
    insert into profiles (id, display_name, birthdate, wide_area, photo_verified) values (u, 'JFD-' || left(u::text, 4), date '1990-01-01', '13.3,-44.6', true);
  end loop;
  update profiles set open_to_friend_discovery = true where id in (v_a, v_b, v_c);
  update profiles set open_to_friend_discovery = false where id = v_x;
  perform set_config('app.trusted_update', 'off', true);
  log := log || jsonb_build_array(jsonb_build_object('step', 'ids', 'ok', true,
    'data', jsonb_build_object('a', v_a, 'b', v_b, 'c', v_c, 'x', v_x)));

  log := log || jsonb_build_array(jsonb_build_object('step', 'column', 'ok', true, 'data', (
    select jsonb_build_object('default', column_default, 'nullable', is_nullable)
    from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'friend_discovery_view_style')));
  log := log || jsonb_build_array(jsonb_build_object('step', 'dating_before', 'ok', true,
    'data', (select to_jsonb(discovery_view_style) from profiles where id = v_a)));

  ${as('a_opens_friends', 'v_a', myStyle('v_a'))}
  ${as('a_chooses_deck', 'v_a', "update profiles set friend_discovery_view_style = 'cards' where id = v_a")}
  ${as('a_after_deck', 'v_a', myStyle('v_a'))}
  log := log || jsonb_build_array(jsonb_build_object('step', 'dating_after', 'ok', true,
    'data', (select to_jsonb(discovery_view_style) from profiles where id = v_a)));
  ${as('a_junk_value', 'v_a', "update profiles set friend_discovery_view_style = 'swipe' where id = v_a")}
  ${as('b_changes_a', 'v_b', "with u as (update profiles set friend_discovery_view_style = 'list' where id = v_a returning 1) select to_jsonb(count(*)) into v_res from u")}
  ${as('a_after_b', 'v_a', myStyle('v_a'))}
  ${as('a_back_to_list', 'v_a', "update profiles set friend_discovery_view_style = 'list' where id = v_a")}
  ${as('a_after_list', 'v_a', myStyle('v_a'))}

  ${as('a_candidates_before', 'v_a', candidates('v_a'))}
  ${as('a_passes_b', 'v_a', decide('v_b', FRIEND_DECISIONS.pass.direction))}
  ${as('a_connects_c', 'v_a', decide('v_c', FRIEND_DECISIONS.connect.direction))}
  ${as('a_candidates_after', 'v_a', candidates('v_a'))}
  log := log || jsonb_build_array(jsonb_build_object('step', 'swipe_rows', 'ok', true, 'data', (
    select coalesce(jsonb_object_agg(to_user, direction), '{}'::jsonb) from friend_discovery_swipes where from_user = v_a)));
  ${as('c_connects_a', 'v_c', decide('v_a', FRIEND_DECISIONS.connect.direction))}
  log := log || jsonb_build_array(jsonb_build_object('step', 'friendship', 'ok', true, 'data', (
    select to_jsonb(status) from friendships where user_a = least(v_a, v_c) and user_b = greatest(v_a, v_c))));
  ${as('a_connects_x', 'v_a', decide('v_x', FRIEND_DECISIONS.connect.direction))}
  log := log || jsonb_build_array(jsonb_build_object('step', 'x_rows', 'ok', true,
    'data', (select to_jsonb(count(*)) from friend_discovery_swipes where to_user = v_x)));
  ${as('x_candidates', 'v_x', candidates('v_x'))}
  ${as('bad_direction', 'v_b', "select to_jsonb(r) into v_res from record_friend_discovery_swipe(v_c, 'right') r")}
`);
    s = stepMap(log);
    ids = s.ids.data;
  }, 120000);

  it('a new person starts on the list; the column defaults to list and is never null', () => {
    expect(s.column.data).toEqual({ default: "'list'::text", nullable: 'NO' });
    expect(JSON.parse(s.a_opens_friends.data)).toBe('list');
    expect(friendViewStyle(JSON.parse(s.a_opens_friends.data))).toBe('list');
  });

  it('the deck is the person\'s own choice, on their own row, and leaves Dating alone', () => {
    expect(s.a_chooses_deck.data).toBe('ok');
    expect(JSON.parse(s.a_after_deck.data)).toBe('cards');
    expect(s.dating_after.data).toEqual(s.dating_before.data);
    expect(s.a_junk_value.data).toMatch(/^error: .*friend_discovery_view_style_check/);
    expect(JSON.parse(s.b_changes_a.data)).toBe(0);
    expect(JSON.parse(s.a_after_b.data)).toBe('cards');
  });

  it('returning between modes: back to the list is stored too', () => {
    expect(otherFriendViewStyle(JSON.parse(s.a_after_deck.data))).toBe('list');
    expect(s.a_back_to_list.data).toBe('ok');
    expect(JSON.parse(s.a_after_list.data)).toBe('list');
  });

  it('Pass and Connect record their directions and both people leave the candidates, as the client already hid them', () => {
    const before = JSON.parse(s.a_candidates_before.data);
    expect(before.sort()).toEqual([ids.b, ids.c].sort());
    expect(JSON.parse(s.a_passes_b.data)).toEqual({ is_mutual_match: false, match_id: null });
    expect(JSON.parse(s.a_connects_c.data)).toEqual({ is_mutual_match: false, match_id: null });
    expect(s.swipe_rows.data).toEqual({ [ids.b]: 'pass', [ids.c]: 'like' });
    const after = JSON.parse(s.a_candidates_after.data);
    expect(after).toEqual([]);
    const clientShown = undecidedCandidates(before.map((id) => ({ id })), new Set([ids.b, ids.c])).map((c) => c.id);
    expect(clientShown).toEqual(after);
  });

  it('Connect both ways is a mutual friend match', () => {
    const r = JSON.parse(s.c_connects_a.data);
    expect(r.is_mutual_match).toBe(true);
    expect(r.match_id).toEqual(expect.any(String));
    expect(s.friendship.data).toBe('accepted');
  });

  it('eligibility is unchanged: someone who never opted in is never a candidate and cannot be connected to', () => {
    expect(JSON.parse(s.a_candidates_before.data)).not.toContain(ids.x);
    expect(JSON.parse(s.a_connects_x.data)).toEqual({ is_mutual_match: false, match_id: null });
    expect(s.x_rows.data).toBe(0);
    expect(JSON.parse(s.x_candidates.data)).toEqual([]);
    expect(s.bad_direction.data).toBe('error: Invalid direction');
  });
});

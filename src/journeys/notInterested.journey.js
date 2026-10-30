// Owner idea "153" (2026-10-17, LOCKED): "Not interested" on a recommended gathering card. Migration 20270327.
// Every actor runs under the REAL database role the API uses (`set local role anon` / `authenticated` + JWT claims), so RLS,
// grants and each function's own checks are exercised, not bypassed. One story:
//   the person dismisses a Coffee gathering -> it is hidden for them and Coffee ranks lower (full weight, even for a brand-new
//   account) -> a search naming Coffee ignores it -> the host, an attendee, the partner business, a stranger and a signed-out
//   caller learn nothing (no table read, no feedback, no push) -> refusals for their own / joined / Interested / invisible
//   gatherings -> a never-learned kind hides the gathering only -> latest word per kind (an older or newer "How was it?") ->
//   edits (time/title keep it hidden, a new kind lifts it) -> Undo -> Forget -> cancel keeps the kind word -> 90 days ->
//   Clear. The set of database functions that read the table is pinned.
// Rolled back. Coordinates are mid-Atlantic so no real gathering is involved.
const { runJourney, stepMap, hasToken } = require('./journeyHarness');
const { LIFT_GATHERING_CREATION_LIMIT } = require('./journeyHarness'); // 20270362: fixture hosts create many gatherings
const {
  experienceFeedbackFromRow, feedbackFor, feedbackDelta, forTypedAsk, FEEDBACK_POINTS, EMPTY_EXPERIENCE_FEEDBACK,
} = require('../utils/experienceFeedback');
const { selectHomeAttention } = require('../utils/homeAttention');
const { hiddenRecommendationIds, withoutHidden, dismissLowersKind } = require('../utils/notInterested');

const d = hasToken ? describe : describe.skip;

const LAT = 13.335577;
const LNG = -44.668822;

// `sub`'s view under `role` (null sub = signed out): the feedback row, and whether a plain table read is refused.
function probe(step, role, sub) {
  const claims = sub
    ? `json_build_object('sub', ${sub}, 'role', 'authenticated')::text`
    : `json_build_object('role', 'anon')::text`;
  return `
  perform set_config('request.jwt.claims', ${claims}, true);
  set local role ${role};
  begin select to_jsonb(f) into v_fb from get_my_experience_feedback() f;
  exception when others then v_fb := to_jsonb('refused: ' || sqlerrm); end;
  begin select to_jsonb(count(*)) into v_rows from gathering_dismissals;
  exception when others then v_rows := to_jsonb('refused: ' || sqlerrm); end;
  reset role;
  log := log || jsonb_build_array(jsonb_build_object('step', '${step}', 'ok', true, 'data', jsonb_build_object('feedback', v_fb, 'table', v_rows)));`;
}

// A statement run as `sub` (authenticated) or signed out (sub null); records its jsonb result / 'ok', or the error text.
function attempt(step, sub, stmt) {
  const claims = sub
    ? `json_build_object('sub', ${sub}, 'role', 'authenticated')::text`
    : `json_build_object('role', 'anon')::text`;
  return `
  perform set_config('request.jwt.claims', ${claims}, true);
  set local role ${sub ? 'authenticated' : 'anon'};
  begin v_res := null; ${stmt}; v_err := coalesce(v_res::text, 'ok');
  exception when others then v_err := 'error: ' || sqlerrm; end;
  reset role;
  log := log || jsonb_build_array(jsonb_build_object('step', '${step}', 'ok', true, 'data', to_jsonb(v_err)));`;
}

const dismiss = (g) => `v_res := dismiss_recommended_gathering(${g})`;
const mine = (step) => probe(step, 'authenticated', 'v_me');

d('journey: Not interested hides one gathering for one person and lowers its kind, privately', () => {
  let s;
  let ids;
  beforeAll(async () => {
    const log = await runJourney(`
      v_me uuid := gen_random_uuid(); v_host uuid := gen_random_uuid(); v_att uuid := gen_random_uuid(); v_po uuid := gen_random_uuid();
      v_str uuid := gen_random_uuid(); v_p uuid := gen_random_uuid(); u uuid;
      g_a uuid; g_b uuid; g_c uuid; g_f uuid; g_fr uuid; g_mine uuid; g_int uuid; g_join uuid; g_past uuid;
      v_fb jsonb; v_rows jsonb; v_res jsonb; v_err text; v_push bigint;`, `
  perform set_config('app.trusted_update', 'on', true);
  perform set_config('app.push_handoff_test_failure', 'on', true);
  foreach u in array array[v_me, v_host, v_att, v_po, v_str] loop
    insert into auth.users (id, aud, role, email) values (u, 'authenticated', 'authenticated', u || '@jni.test');
    update auth.users set phone = '1555' || lpad(((('x0' || substr(md5(id::text), 1, 7))::bit(32)::int) % 100000000)::text, 8, '0'), phone_confirmed_at = now() where id in (u);
    insert into profiles (id, display_name, birthdate) values (u, 'JNI-' || left(u::text, 4), date '1990-01-01');
  end loop;
  insert into brand_partners (id, name, active, latitude, longitude, subcategory) values (v_p, 'JNI Cafe', true, ${LAT}, ${LNG}, 'Coffee');
  update profiles set managed_partner_id = v_p where id = v_po;

  perform set_config('request.jwt.claims', json_build_object('sub', v_host, 'role', 'authenticated')::text, true);
  ${LIFT_GATHERING_CREATION_LIMIT}
  insert into gatherings (host_id, title, scheduled_at, precise_lat, precise_lng, interest_tag, area, wide_area, capacity, visibility, is_public, discoverable, hosting_partner_id)
    values (v_host, 'JNI coffee A', now() + interval '1 day', ${LAT}, ${LNG}, 'Coffee', 'journey', 'JNI-area', 10, 'everyone', true, true, v_p) returning id into g_a;
  insert into gatherings (host_id, title, scheduled_at, precise_lat, precise_lng, interest_tag, area, wide_area, capacity, visibility, is_public, discoverable)
    values (v_host, 'JNI coffee B', now() + interval '2 days', ${LAT}, ${LNG}, 'Coffee', 'journey', 'JNI-area', 10, 'everyone', true, true) returning id into g_b;
  insert into gatherings (host_id, title, scheduled_at, precise_lat, precise_lng, interest_tag, area, wide_area, capacity, visibility, is_public, discoverable)
    values (v_host, 'JNI hike', now() + interval '1 day', ${LAT}, ${LNG}, 'Hiking', 'journey', 'JNI-area', 10, 'everyone', true, true) returning id into g_c;
  insert into gatherings (host_id, title, scheduled_at, precise_lat, precise_lng, interest_tag, area, wide_area, capacity, visibility, is_public, discoverable)
    values (v_host, 'JNI faith', now() + interval '1 day', ${LAT}, ${LNG}, 'Faith & Spirituality', 'journey', 'JNI-area', 10, 'everyone', true, true) returning id into g_f;
  insert into gatherings (host_id, title, scheduled_at, precise_lat, precise_lng, interest_tag, area, wide_area, capacity, visibility, is_public, discoverable)
    values (v_host, 'JNI friends only', now() + interval '1 day', ${LAT}, ${LNG}, 'Coffee', 'journey', 'JNI-area', 10, 'friends', true, true) returning id into g_fr;
  insert into gatherings (host_id, title, scheduled_at, precise_lat, precise_lng, interest_tag, area, wide_area, capacity, visibility, is_public, discoverable)
    values (v_host, 'JNI interested', now() + interval '1 day', ${LAT}, ${LNG}, 'Coffee', 'journey', 'JNI-area', 10, 'everyone', true, true) returning id into g_int;
  insert into gatherings (host_id, title, scheduled_at, precise_lat, precise_lng, interest_tag, area, wide_area, capacity, visibility, is_public, discoverable)
    values (v_host, 'JNI joined', now() + interval '1 day', ${LAT}, ${LNG}, 'Coffee', 'journey', 'JNI-area', 10, 'everyone', true, true) returning id into g_join;
  insert into gatherings (host_id, title, scheduled_at, precise_lat, precise_lng, interest_tag, area, wide_area, capacity, visibility, is_public, discoverable)
    values (v_host, 'JNI past coffee', now() - interval '3 days', ${LAT}, ${LNG}, 'Coffee', 'journey', 'JNI-area', 10, 'everyone', true, true) returning id into g_past;
  perform set_config('request.jwt.claims', json_build_object('sub', v_me, 'role', 'authenticated')::text, true);
  insert into gatherings (host_id, title, scheduled_at, precise_lat, precise_lng, interest_tag, area, wide_area, capacity, visibility, is_public, discoverable)
    values (v_me, 'JNI my own', now() + interval '1 day', ${LAT}, ${LNG}, 'Coffee', 'journey', 'JNI-area', 10, 'everyone', true, true) returning id into g_mine;
  insert into gathering_interest (gathering_id, user_id, status) values (g_a, v_att, 'approved'), (g_join, v_me, 'approved');
  insert into gathering_interested (gathering_id, user_id) values (g_int, v_me);
  log := log || jsonb_build_array(jsonb_build_object('step', 'ids', 'ok', true, 'data', jsonb_build_object(
    'a', g_a, 'b', g_b, 'c', g_c, 'f', g_f)));

  -- 1. the person dismisses Coffee A
  select count(*) into v_push from push_outbox;
  ${attempt('dismiss_a', 'v_me', dismiss('g_a'))}
  log := log || jsonb_build_array(jsonb_build_object('step', 'pushes_after_dismiss', 'ok', true, 'data', (select count(*) from push_outbox) - v_push));
  ${mine('me_after_a')}

  -- 2. what nobody else can learn
  ${probe('host', 'authenticated', 'v_host')}
  ${probe('attendee', 'authenticated', 'v_att')}
  ${probe('business_owner', 'authenticated', 'v_po')}
  ${probe('stranger', 'authenticated', 'v_str')}
  ${probe('signed_out', 'anon', null)}
  ${attempt('anon_dismiss', null, dismiss('g_b'))}
  ${attempt('me_inserts_directly', 'v_me', 'insert into gathering_dismissals (user_id, gathering_id, interest_tag) values (v_me, g_b, \'Coffee\')')}
  ${attempt('stranger_undoes_mine', 'v_str', 'perform undo_dismiss_recommended_gathering(g_a)')}
  ${attempt('stranger_forgets_coffee', 'v_str', 'perform forget_my_not_interested_category(\'Coffee\')')}
  ${mine('me_after_others')}

  -- 3. only a recommendation can be dismissed
  ${attempt('refuse_own', 'v_me', dismiss('g_mine'))}
  ${attempt('refuse_interested', 'v_me', dismiss('g_int'))}
  ${attempt('refuse_joined', 'v_me', dismiss('g_join'))}
  ${attempt('refuse_invisible', 'v_me', dismiss('g_fr'))}
  ${attempt('refuse_unknown', 'v_me', dismiss('gen_random_uuid()'))}

  -- 4. a never-learned kind: the gathering is hidden, no kind is lowered
  ${attempt('dismiss_faith', 'v_me', dismiss('g_f'))}
  ${mine('me_after_faith')}

  -- 5. latest word per kind: an OLDER "loved it" on Coffee loses to the Not interested; a NEWER one replaces it
  insert into gathering_feedback (gathering_id, reviewer_id, satisfaction_rating, created_at) values (g_past, v_me, 'loved_it', now() - interval '1 day');
  ${mine('me_older_loved')}
  update gathering_feedback set created_at = now() + interval '1 minute' where gathering_id = g_past and reviewer_id = v_me;
  ${mine('me_newer_loved')}
  delete from gathering_feedback where gathering_id = g_past and reviewer_id = v_me;

  -- 6. edits: time and title keep it hidden; another kind lifts it (the down-rank stays on Coffee); back to Coffee hides again
  update gatherings set scheduled_at = scheduled_at + interval '2 hours', title = 'JNI coffee A (moved)' where id = g_a;
  ${mine('me_after_time_title_edit')}
  update gatherings set interest_tag = 'Hiking' where id = g_a;
  ${mine('me_after_kind_edit')}
  update gatherings set interest_tag = 'Coffee' where id = g_a;

  -- 7. Undo reverses both the hide and the kind word
  ${attempt('undo_a', 'v_me', 'perform undo_dismiss_recommended_gathering(g_a)')}
  ${mine('me_after_undo')}

  -- 8. Forget Coffee removes every Coffee dismissal (its gatherings come back), nothing else
  ${attempt('dismiss_a_again', 'v_me', dismiss('g_a'))}
  ${attempt('dismiss_b', 'v_me', dismiss('g_b'))}
  ${attempt('forget_coffee', 'v_me', 'perform forget_my_not_interested_category(\'Coffee\')')}
  ${mine('me_after_forget')}

  -- 9. cancelled (= deleted): the kind word stays, nothing is left to hide; a recreated gathering is a new id, not hidden
  ${attempt('dismiss_a_third', 'v_me', dismiss('g_a'))}
  ${attempt('host_cancels_a', 'v_host', 'perform cancel_gathering(g_a)')}
  ${mine('me_after_cancel')}

  -- 10. older than 90 days counts for nothing
  ${attempt('dismiss_hike', 'v_me', dismiss('g_c'))}
  update gathering_dismissals set created_at = now() - interval '91 days' where user_id = v_me and gathering_id = g_c;
  ${mine('me_after_90_days')}

  -- 11. Clear my activity history clears every Not interested
  ${attempt('clear', 'v_me', 'perform clear_my_behavior_history()')}
  ${mine('me_after_clear')}

  -- every database function that reads or writes the table (a new one must be reviewed against the privacy rule)
  log := log || jsonb_build_array(jsonb_build_object('step', 'readers', 'ok', true, 'data', (
    select coalesce(jsonb_agg(p.proname order by p.proname), '[]'::jsonb) from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.prosrc ~ 'gathering_dismissals')));
`);
    s = stepMap(log);
    ids = s.ids.data;
  }, 90000);

  const fb = (step) => s[step].data.feedback;
  const refused = (v) => typeof v === 'string' && v.startsWith('refused');

  test('dismissing returns that a kind is now lower, and nobody is notified', () => {
    expect(JSON.parse(s.dismiss_a.data)).toEqual({ kind_down_ranked: true });
    expect(s.pushes_after_dismiss.data).toBe(0);
  });
  test('the person: that gathering is hidden, Coffee is a Not interested word, nothing else changes', () => {
    const f = fb('me_after_a');
    expect(f.dismissed_gathering_ids).toEqual([ids.a]);
    expect(f.not_interested_categories).toEqual(['Coffee']);
    expect(f.not_for_me_categories).toEqual([]);
    expect(f.not_for_me_host_ids).toEqual([]); // never the host
    expect(f.not_for_me_partner_ids).toEqual([]); // never the business
  });
  test('the ranking really changes, even for a brand-new account (maturity 0), and only for Coffee', () => {
    const f = experienceFeedbackFromRow(fb('me_after_a'));
    const coffee = feedbackFor({ hostId: 'h', partnerId: 'p', category: 'Coffee' }, f);
    expect(coffee).toMatchObject({ direction: -1, scope: 'kind', explicit: true, dropsLearned: true });
    expect(feedbackDelta(coffee, 0)).toBe(-FEEDBACK_POINTS);
    expect(feedbackFor({ category: 'Hiking' }, f).direction).toBe(0);
    const g = (id, tag) => ({ id, title: id, interest_tag: tag, scheduled_at: new Date(Date.now() + 864e5).toISOString() });
    // Idea "291": Picked For You cards carry a personal reason (here a declared interest in each).
    const cards = [g('coffee-b', 'Coffee'), g('hike', 'Hiking')].map((x) => ({ gathering: x, signals: [{ kind: 'interest', text: `Because you like ${x.interest_tag}` }], reasons: [] }));
    const order = (feedback) => selectHomeAttention({ cards, feedback, maturity: 0 }).items.map((e) => e.gathering.id);
    expect(order(EMPTY_EXPERIENCE_FEEDBACK)).toEqual(['coffee-b', 'hike']);
    expect(order(f)).toEqual(['hike', 'coffee-b']);
  });
  test('the dismissed gathering leaves the recommendation lists; a typed ask naming Coffee ignores the word', () => {
    const f = experienceFeedbackFromRow(fb('me_after_a'));
    expect(withoutHidden([{ id: ids.a }, { id: ids.b }], hiddenRecommendationIds(f)).map((x) => x.id)).toEqual([ids.b]);
    expect(feedbackFor({ category: 'Coffee' }, forTypedAsk(f, ['coffee'])).direction).toBe(0);
    expect(feedbackFor({ category: 'Coffee' }, forTypedAsk(f, ['Hiking'])).direction).toBe(-1);
  });
  test.each(['host', 'attendee', 'business_owner', 'stranger'])('%s: no table read, and their own feedback carries none of it', (who) => {
    expect(refused(s[who].data.table)).toBe(true);
    const f = fb(who);
    expect(f.dismissed_gathering_ids).toEqual([]);
    expect(f.not_interested_categories).toEqual([]);
    expect(JSON.stringify(f)).not.toContain(ids.a);
  });
  test('signed out: nothing at all', () => {
    expect(refused(s.signed_out.data.feedback)).toBe(true);
    expect(refused(s.signed_out.data.table)).toBe(true);
    expect(s.anon_dismiss.data).toMatch(/^error/);
  });
  test('nobody writes the table directly, and nobody else can undo or forget the person\'s word', () => {
    expect(s.me_inserts_directly.data).toMatch(/^error/);
    expect(refused(s.me_after_a.data.table)).toBe(true); // not even the person reads the raw table
    expect(fb('me_after_others')).toEqual(fb('me_after_a'));
  });
  test('only a recommendation: never the person\'s own, Interested, joined, or an invisible / unknown gathering', () => {
    expect(s.refuse_own.data).toBe('error: This is your own gathering');
    expect(s.refuse_interested.data).toBe('error: Already in your plans');
    expect(s.refuse_joined.data).toBe('error: Already in your plans');
    expect(s.refuse_invisible.data).toBe('error: Gathering not found');
    expect(s.refuse_unknown.data).toBe('error: Gathering not found');
  });
  test('a never-learned kind: hidden, never stored as a kind word, and the card says so truthfully', () => {
    expect(JSON.parse(s.dismiss_faith.data)).toEqual({ kind_down_ranked: false });
    expect(dismissLowersKind({ interest_tag: 'Faith & Spirituality' })).toBe(false);
    const f = fb('me_after_faith');
    expect(f.dismissed_gathering_ids.sort()).toEqual([ids.a, ids.f].sort());
    expect(f.not_interested_categories).toEqual(['Coffee']);
  });
  test('latest word per kind: an older "loved it" loses, a newer one replaces the Not interested (the hide stays)', () => {
    expect(fb('me_older_loved').not_interested_categories).toEqual(['Coffee']);
    expect(fb('me_older_loved').loved_categories).toEqual([]);
    expect(fb('me_newer_loved').not_interested_categories).toEqual([]);
    expect(fb('me_newer_loved').loved_categories).toEqual(['Coffee']);
    expect(fb('me_newer_loved').dismissed_gathering_ids).toContain(ids.a);
  });
  test('a changed gathering never inherits the wrong dismissal', () => {
    expect(fb('me_after_time_title_edit').dismissed_gathering_ids).toContain(ids.a);
    expect(fb('me_after_kind_edit').dismissed_gathering_ids).not.toContain(ids.a);
    expect(fb('me_after_kind_edit').not_interested_categories).toEqual(['Coffee']);
  });
  test('Undo reverses the whole thing: shown again and Coffee ranked as before', () => {
    expect(s.undo_a.data).toBe('ok');
    expect(fb('me_after_undo').dismissed_gathering_ids).toEqual([ids.f]);
    expect(fb('me_after_undo').not_interested_categories).toEqual([]);
  });
  test('Forget Coffee removes every Coffee dismissal and its kind word, and leaves the others', () => {
    expect(fb('me_after_forget').not_interested_categories).toEqual([]);
    expect(fb('me_after_forget').dismissed_gathering_ids).toEqual([ids.f]);
  });
  test('cancelled: the kind word stays, nothing left to hide', () => {
    expect(s.host_cancels_a.data).toBe('ok');
    expect(fb('me_after_cancel').not_interested_categories).toEqual(['Coffee']);
    expect(fb('me_after_cancel').dismissed_gathering_ids).toEqual([ids.f]);
  });
  test('older than 90 days counts for nothing', () => {
    expect(fb('me_after_90_days').not_interested_categories).toEqual(['Coffee']);
    expect(fb('me_after_90_days').dismissed_gathering_ids).not.toContain(ids.c);
  });
  test('Clear my activity history clears every Not interested', () => {
    expect(s.clear.data).toBe('ok');
    expect(fb('me_after_clear').not_interested_categories).toEqual([]);
    expect(fb('me_after_clear').dismissed_gathering_ids).toEqual([]);
  });
  test('the functions touching the table are exactly the reviewed set', () => {
    expect(s.readers.data).toEqual([
      'clear_my_behavior_history', // the person's own rows, deleted
      'dismiss_recommended_gathering', // the one writer, the person's own row
      'forget_my_not_interested_category', // the person's own rows of one kind, deleted
      'get_my_experience_feedback', // the person's own words, auth.uid() only
      'undo_dismiss_recommended_gathering', // the person's own row, deleted
    ]);
  });
});

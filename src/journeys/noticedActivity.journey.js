// Owner item 54 (2026-10-12): "You've been into X lately." One person (fan) does things; the server's ONE rule
// (get_my_noticed_categories, migration 20270302) is applied to the rows the database actually holds, then Home's helpers
// (utils/noticedActivity.js) to its answer. The fan's own behavior history and interests are replaced inside the
// transaction so the story starts clean. Rolled back.
//   Hiking      2 joins (+3 views) this month              -> named
//   Bowling     2 gatherings created (+2 views)            -> named
//   Pickleball  1 join + 3 views                           -> not (views are not doing; only 1 thing done)
//   Coffee      2 joins, but already a declared interest   -> not (nothing to tell)
//   Faith & Spirituality 2 joins                           -> never (never-learned category)
//   Board Games 2 joins, 45 days ago                       -> not "lately"
//   Yoga        searches only                              -> not (a search is not doing)
//   Dental      2 accepts on a business-only tag           -> never (not a consumer category)
// Then: at most 2 named, strongest first; Forget removes one; adding one to interests removes it; a category Settings would
// not list (5 heavier ones) is never named; no caller = nothing. Not covered: rendering on a device.
const { runJourney, stepMap, hasToken, actorsSql, journeyPeople } = require('./journeyHarness');
import { noticedCategories, takeNoticedMoment } from '../utils/noticedActivity';
import { learnedAffinities } from '../utils/learnedAffinity';

const d = hasToken ? describe : describe.skip;

const NOTICED = `(select coalesce(jsonb_agg(to_jsonb(n)), '[]'::jsonb) from public.get_my_noticed_categories() n)`;
const LEARNED = `(select coalesce(jsonb_agg(to_jsonb(l)), '[]'::jsonb) from public.get_my_behavior_categories(90) l)`;

d('journey: things the person did -> "You\'ve been into X lately" -> Settings', () => {
  let s;
  beforeAll(async () => {
    const people = journeyPeople(2);
    const log = await runJourney(`
      v_fan uuid := '${people[1].id}';
      v_t text;`, `
  ${actorsSql({ people: ['v_fan'] })}
  delete from behavior_events where user_id = v_fan;
  perform set_config('app.trusted_update', 'true', true);
  update profiles set interests = array['Coffee'], monthly_interests = null where id = v_fan;

  -- what the fan did (each row = one real thing; entity ids are separate gatherings / requests)
  insert into behavior_events (user_id, event_type, entity_type, entity_id, category, created_at) values
    (v_fan, 'join',   'gathering', gen_random_uuid(), 'Hiking', now() - interval '10 days'),
    (v_fan, 'join',   'gathering', gen_random_uuid(), 'Hiking', now() - interval '3 days'),
    (v_fan, 'create', 'gathering', gen_random_uuid(), 'Bowling', now() - interval '12 days'),
    (v_fan, 'create', 'gathering', gen_random_uuid(), 'Bowling', now() - interval '2 days'),
    -- a few views too (they weigh in the learned list, never in "done")
    (v_fan, 'open',   'gathering', gen_random_uuid(), 'Hiking', now() - interval '9 days'),
    (v_fan, 'open',   'gathering', gen_random_uuid(), 'Hiking', now() - interval '8 days'),
    (v_fan, 'open',   'gathering', gen_random_uuid(), 'Hiking', now() - interval '7 days'),
    (v_fan, 'open',   'gathering', gen_random_uuid(), 'Bowling', now() - interval '9 days'),
    (v_fan, 'open',   'gathering', gen_random_uuid(), 'Bowling', now() - interval '8 days'),
    (v_fan, 'join',   'gathering', gen_random_uuid(), 'Pickleball', now() - interval '5 days'),
    (v_fan, 'open',   'gathering', gen_random_uuid(), 'Pickleball', now() - interval '4 days'),
    (v_fan, 'open',   'gathering', gen_random_uuid(), 'Pickleball', now() - interval '4 days'),
    (v_fan, 'open',   'gathering', gen_random_uuid(), 'Pickleball', now() - interval '4 days'),
    (v_fan, 'join',   'gathering', gen_random_uuid(), 'Coffee', now() - interval '6 days'),
    (v_fan, 'join',   'gathering', gen_random_uuid(), 'Coffee', now() - interval '1 day'),
    (v_fan, 'join',   'gathering', gen_random_uuid(), 'Faith & Spirituality', now() - interval '6 days'),
    (v_fan, 'join',   'gathering', gen_random_uuid(), 'Faith & Spirituality', now() - interval '1 day'),
    (v_fan, 'join',   'gathering', gen_random_uuid(), 'Board Games', now() - interval '45 days'),
    (v_fan, 'join',   'gathering', gen_random_uuid(), 'Board Games', now() - interval '44 days'),
    (v_fan, 'search', 'search', null, 'Yoga', now() - interval '6 days'),
    (v_fan, 'search', 'search', null, 'Yoga', now() - interval '2 days'),
    (v_fan, 'accept', 'business_request', gen_random_uuid(), 'Dental', now() - interval '6 days'),
    (v_fan, 'accept', 'business_request', gen_random_uuid(), 'Dental', now() - interval '2 days');

  perform set_config('request.jwt.claims', json_build_object('sub', v_fan, 'role', 'authenticated')::text, true);
  log := log || jsonb_build_array(jsonb_build_object('step','first','ok', true, 'data', jsonb_build_object('noticed', ${NOTICED}, 'learned', ${LEARNED})));

  -- more doing: a third hike, a second pickleball game -> three qualify, two are named, strongest first
  insert into behavior_events (user_id, event_type, entity_type, entity_id, category, created_at) values
    (v_fan, 'join', 'gathering', gen_random_uuid(), 'Hiking', now() - interval '1 day'),
    (v_fan, 'join', 'gathering', gen_random_uuid(), 'Pickleball', now() - interval '1 day');
  log := log || jsonb_build_array(jsonb_build_object('step','three_qualify','ok', true, 'data', jsonb_build_object('noticed', ${NOTICED})));

  -- Settings > Forget Hiking (the fan's own call)
  perform public.forget_my_behavior_category('Hiking');
  log := log || jsonb_build_array(jsonb_build_object('step','after_forget','ok', true, 'data', jsonb_build_object('noticed', ${NOTICED})));

  -- Settings > Add Bowling to my interests
  update profiles set interests = interests || array['Bowling'] where id = v_fan;
  log := log || jsonb_build_array(jsonb_build_object('step','after_add','ok', true, 'data', jsonb_build_object('noticed', ${NOTICED})));

  -- five heavier learned categories (viewed a lot): Settings' top 5 no longer surely lists Pickleball -> not named
  for v_t in select tag from category_tag_groups
             where retired_at is null and not coalesce(business_only, false)
               and tag not in ('Hiking', 'Bowling', 'Pickleball', 'Coffee', 'Faith & Spirituality', 'Board Games', 'Yoga')
             order by tag limit 5 loop
    insert into behavior_events (user_id, event_type, entity_type, entity_id, category, created_at)
    select v_fan, 'open', 'gathering', gen_random_uuid(), v_t, now() - interval '1 day' from generate_series(1, 12);
  end loop;
  log := log || jsonb_build_array(jsonb_build_object('step','crowded_out','ok', true, 'data', jsonb_build_object('noticed', ${NOTICED}, 'learned', ${LEARNED})));

  perform set_config('request.jwt.claims', '{}', true);
  log := log || jsonb_build_array(jsonb_build_object('step','no_caller','ok', true, 'data', jsonb_build_object('noticed', ${NOTICED},
    'anon_can_call', has_function_privilege('anon', 'public.get_my_noticed_categories()', 'execute'))));`);
    s = stepMap(log);
  }, 120000);

  const names = (k) => s[k].data.noticed.map((r) => r.category);

  test('only categories with 2+ things DONE lately, canonical, learned and not declared are named', () => {
    expect(names('first')).toEqual(['Hiking', 'Bowling']); // both 2 done: the heavier learned weight first (9 vs 8)
    const learned = s.first.data.learned.map((r) => r.category);
    expect(learned).toContain('Pickleball'); // learned for ranking, but views are not doing
    expect(learned).not.toContain('Faith & Spirituality');
    for (const never of ['Pickleball', 'Coffee', 'Faith & Spirituality', 'Board Games', 'Yoga', 'Dental']) {
      expect(names('first')).not.toContain(never);
    }
  });

  test('at most two are named, the most done first', () => {
    expect(names('three_qualify')).toEqual(['Hiking', 'Pickleball']);
    expect(s.three_qualify.data.noticed[0].did_count).toBe(3);
  });

  test('Forget and Add to my interests (Settings) both take a category out of the line', () => {
    expect(names('after_forget')).toEqual(['Pickleball', 'Bowling']); // same done count: the heavier learned weight first
    expect(names('after_add')).toEqual(['Pickleball']);
  });

  test('a category Settings would not list is never named (the line always lands on it)', () => {
    expect(names('crowded_out')).toEqual([]);
    const shown = learnedAffinities(s.crowded_out.data.learned, []).map((a) => a.category);
    expect(shown).not.toContain('Pickleball');
  });

  test('no caller, nothing; anon cannot call it', () => {
    expect(names('no_caller')).toEqual([]);
    expect(s.no_caller.data.anon_can_call).toBe(false);
  });

  test('Home: the line names what the server gave, on one day only per category', async () => {
    const store = {};
    const storage = { getItem: async (k) => store[k] ?? null, setItem: async (k, v) => { store[k] = v; } };
    const cats = noticedCategories(s.three_qualify.data.noticed);
    expect(await takeNoticedMoment({ userId: 'fan', categories: cats, dayKey: '2026-10-12' }, storage)).toEqual(['Hiking', 'Pickleball']);
    expect(await takeNoticedMoment({ userId: 'fan', categories: cats, dayKey: '2026-10-12' }, storage)).toEqual(['Hiking', 'Pickleball']);
    expect(await takeNoticedMoment({ userId: 'fan', categories: cats, dayKey: '2026-10-13' }, storage)).toEqual([]);
    expect(await takeNoticedMoment({ userId: 'fan', categories: noticedCategories(s.after_forget.data.noticed), dayKey: '2026-10-20' }, storage))
      .toEqual(['Bowling']);
  });
});

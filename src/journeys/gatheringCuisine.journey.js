// Cuisine is a gathering's own structured fact (owner 2026-11-27; migration 20270435): Activity != Category != Cuisine != Title.
// Every client write runs as the host under the real `authenticated` role + JWT claims (grants, RLS, the guard triggers).
//   * Italian dinner: activity Dinner, category Foodie, cuisine italian; a title edit leaves the cuisine alone; the host can change it.
//   * Not a food category: a cuisine is dropped (never refused); moving a food gathering to a non-food category clears it.
//   * Only the canonical vocabulary is accepted (a non-canonical word is refused by the check constraint).
//   * Another signed-in person can read the column (column-level grant).
//   * A business request made from the gathering inherits its cuisine (routing + the Opportunity card read the request row);
//     a request from a non-food gathering gets none.
// One rolled-back transaction.
const { runJourney, stepMap, hasToken, actorDeclares, actorsSql } = require('./journeyHarness');

const d = hasToken ? describe : describe.skip;

function as(step, sub, stmt, value = `'ok'::text`) {
  return `
  perform set_config('request.jwt.claims', json_build_object('sub', ${sub}, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin ${stmt}; v_out := to_jsonb(${value});
  exception when others then
    get stacked diagnostics v_hint = pg_exception_hint;
    v_out := jsonb_build_object('error', sqlerrm, 'hint', v_hint);
  end;
  reset role;
  log := log || jsonb_build_array(jsonb_build_object('step', '${step}', 'ok', true, 'data', v_out));`;
}
const ins = (v, tag, activity, cuisine) => `insert into gatherings (host_id, title, scheduled_at, precise_lat, precise_lng, interest_tag, area, visibility, is_public, activity, cuisine)
    values (v_h, 'Dinner', now() + interval '2 days', 1.5, -150.5, '${tag}', 'journey', 'everyone', true, ${activity}, ${cuisine}) returning id into ${v}`;
const read = (v) => `(select jsonb_build_object('title', title, 'tag', interest_tag, 'activity', activity, 'cuisine', cuisine) from gatherings where id = ${v})`;
// The app may send no category (businessFulfillment.js); the third case aims a food gathering's request at a non-food category.
const ask = (g, text, cat = 'null') => `select public.create_business_request_for_gathering(${g}, '${text}', ${cat}, null, 15, null, null, null, null, null, null, null) into v_req`;
const reqCuisine = `(select jsonb_build_object('res', v_req, 'cuisine', (select cuisine from business_requests where id = (v_req->>'requestId')::uuid)))`;

d('journey: a gathering carries its cuisine, separate from activity and title (migration 20270435)', () => {
  let s;
  beforeAll(async () => {
    const log = await runJourney(`
      ${actorDeclares(['v_h', 'v_o'])}
      g_it uuid; g_cof uuid; g_move uuid; v_out jsonb; v_hint text; v_req jsonb;`, `
  ${actorsSql({ people: ['v_h', 'v_o'] })}
  ${as('insert_italian', 'v_h', ins('g_it', 'Foodie', "'Dinner'", "'italian'"), read('g_it'))}
  ${as('retitle', 'v_h', "update gatherings set title = 'Sam''s Birthday' where id = g_it", read('g_it'))}
  ${as('change_cuisine', 'v_h', "update gatherings set cuisine = 'japanese' where id = g_it", read('g_it'))}
  ${as('back_to_italian', 'v_h', "update gatherings set cuisine = 'italian' where id = g_it", read('g_it'))}
  ${as('insert_coffee', 'v_h', ins('g_cof', 'Coffee', 'null', "'italian'"), read('g_cof'))}
  ${as('non_canonical', 'v_h', "update gatherings set cuisine = 'pizza' where id = g_it")}
  ${as('other_reads', 'v_o', 'perform 1', `(select jsonb_build_object('cuisine', cuisine) from gatherings where id = g_it)`)}
  ${as('ask_italian', 'v_h', ask('g_it', 'Journey italian dinner'), reqCuisine)}
  ${as('ask_coffee', 'v_h', ask('g_cof', 'Journey coffee meetup'), reqCuisine)}
  ${as('insert_move', 'v_h', ins('g_move', 'Foodie', "'Dinner'", "'thai'"), read('g_move'))}
  ${as('move_category', 'v_h', "update gatherings set interest_tag = 'Coffee' where id = g_move", read('g_move'))}
`);
    s = stepMap(log);
  });

  test('stored beside activity + category; a title edit keeps it; the host can change it', () => {
    expect(s.insert_italian.data).toEqual({ title: 'Dinner', tag: 'Foodie', activity: 'Dinner', cuisine: 'italian' });
    expect(s.retitle.data).toEqual({ title: "Sam's Birthday", tag: 'Foodie', activity: 'Dinner', cuisine: 'italian' });
    expect(s.change_cuisine.data.cuisine).toBe('japanese');
    expect(s.back_to_italian.data.cuisine).toBe('italian');
  });

  test('a non-food category never carries one (dropped, not refused); a move off food clears it', () => {
    expect(s.insert_coffee.data).toEqual({ title: 'Dinner', tag: 'Coffee', activity: null, cuisine: null });
    expect(s.move_category.data.cuisine).toBeNull();
    expect(s.move_category.data.tag).toBe('Coffee');
  });

  test('only the canonical vocabulary', () => {
    expect(s.non_canonical.data.error).toMatch(/gatherings_cuisine_check/);
  });

  test('readable by another signed-in person', () => {
    expect(s.other_reads.data).toEqual({ cuisine: 'italian' });
  });

  test("the gathering's business request inherits the cuisine; a non-food one gets none", () => {
    expect(s.ask_italian.data.error).toBeUndefined();
    expect(s.ask_italian.data.res.requestId).toBeTruthy();
    expect(s.ask_italian.data.cuisine).toBe('italian');
    expect(s.ask_coffee.data.error).toBeUndefined();
    expect(s.ask_coffee.data.res.requestId).toBeTruthy();
    expect(s.ask_coffee.data.res.duplicate).toBeUndefined();
    expect(s.ask_coffee.data.cuisine).toBeNull();
  });
});

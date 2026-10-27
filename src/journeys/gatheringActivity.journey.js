// A gathering keeps the activity the person picked (owner 2026-10-27; migration 20270346): Activity != Category != Title.
// Every write runs as the host under the real `authenticated` role + JWT claims (grants, RLS, the guard trigger).
//   * Created from Dinner: activity 'Dinner' kept beside category Foodie; a title edit ("Sam's Birthday") leaves it alone.
//   * A pick that isn't of the category is dropped on insert (never refused: the gathering still publishes).
//   * A direct change of the activity is refused (hint gathering_activity_fixed); clearing isn't a change the client can make
//     either unless the category moves.
//   * Changing the category to one the pick doesn't belong to clears it; the row still saves.
//   * The column is readable by the app (column-level grant).
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
const ins = (v, tag, activity) => `insert into gatherings (host_id, title, scheduled_at, precise_lat, precise_lng, interest_tag, area, visibility, is_public, activity)
    values (v_h, 'Dinner', now() + interval '2 days', 1.5, -150.5, '${tag}', 'journey', 'everyone', true, ${activity}) returning id into ${v}`;
const read = (v) => `(select jsonb_build_object('title', title, 'tag', interest_tag, 'activity', activity) from gatherings where id = ${v})`;

d('journey: a gathering keeps the activity it was started from (migration 20270346)', () => {
  let s;
  beforeAll(async () => {
    const log = await runJourney(`
      ${actorDeclares(['v_h'])}
      g_dinner uuid; g_bad uuid; g_none uuid; v_out jsonb; v_hint text;`, `
  ${actorsSql({ people: ['v_h'] })}
  ${as('insert_dinner', 'v_h', ins('g_dinner', 'Foodie', "'Dinner'"), read('g_dinner'))}
  ${as('insert_mismatch', 'v_h', ins('g_bad', 'Coffee', "'Dinner'"), read('g_bad'))}
  ${as('insert_none', 'v_h', ins('g_none', 'Foodie', 'null'), read('g_none'))}
  ${as('retitle', 'v_h', "update gatherings set title = 'Sam''s Birthday' where id = g_dinner", read('g_dinner'))}
  ${as('change_activity', 'v_h', "update gatherings set activity = 'Lunch' where id = g_dinner")}
  ${as('set_on_existing', 'v_h', "update gatherings set activity = 'Dinner' where id = g_none")}
  ${as('after_refusals', 'v_h', 'perform 1', `jsonb_build_object('dinner', ${read('g_dinner')}, 'none', ${read('g_none')})`)}
  ${as('change_category', 'v_h', "update gatherings set interest_tag = 'Coffee' where id = g_dinner", read('g_dinner'))}
`);
    s = stepMap(log);
  });

  test('stored at creation beside the category; a title edit never changes it', () => {
    expect(s.insert_dinner.data).toEqual({ title: 'Dinner', tag: 'Foodie', activity: 'Dinner' });
    expect(s.retitle.data).toEqual({ title: "Sam's Birthday", tag: 'Foodie', activity: 'Dinner' });
  });

  test('a pick not of the category is dropped, never refused; none stays none', () => {
    expect(s.insert_mismatch.data).toEqual({ title: 'Dinner', tag: 'Coffee', activity: null });
    expect(s.insert_none.data.activity).toBeNull();
  });

  test('a direct change is refused, nothing moves', () => {
    expect(s.change_activity.data.hint).toBe('gathering_activity_fixed');
    expect(s.set_on_existing.data.hint).toBe('gathering_activity_fixed');
    expect(s.after_refusals.data.dinner.activity).toBe('Dinner');
    expect(s.after_refusals.data.none.activity).toBeNull();
  });

  test('changing the category to one the pick is not of clears it; the edit saves', () => {
    expect(s.change_category.data).toEqual({ title: "Sam's Birthday", tag: 'Coffee', activity: null });
  });
});

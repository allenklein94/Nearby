// Screen-reduction audit 2026-10-24 (owner approved item 2): Emergency contacts now open in place under Settings > Safety
// (components/EmergencyContactsSection.js); the date check-in reads the first one. This journey proves the data the section
// shows under real roles: add, list in order, nobody else sees them, nobody else can remove them, remove your own.
// One rolled-back transaction. Not covered (device only): the section opening in place, the check-in link landing on it.
jest.mock('../services/supabase', () => ({ supabase: {} }));
const { runJourney, stepMap, hasToken, actorDeclares, actorsSql } = require('./journeyHarness');

const d = hasToken ? describe : describe.skip;

const as = (sub) => `perform set_config('request.jwt.claims', json_build_object('sub', ${sub}, 'role', 'authenticated')::text, true);
  set local role authenticated;`;
// What getMyEmergencyContacts reads (own rows, oldest first).
const list = (step, who) => `log := log || jsonb_build_array(jsonb_build_object('step', '${step}', 'ok', true, 'data', (
    select coalesce(jsonb_agg(jsonb_build_object('name', name, 'phone', phone, 'relationship', relationship) order by created_at, name), '[]'::jsonb)
    from emergency_contacts where user_id = ${who})));`;

d('journey: emergency contacts in Settings > Safety', () => {
  let s;
  beforeAll(async () => {
    const log = await runJourney(`${actorDeclares(['v_a', 'v_b'])} v_first uuid; v_n int;`, `
  ${actorsSql({ people: ['v_a', 'v_b'] })}
  ${as('v_a')}
  insert into emergency_contacts (user_id, name, phone, relationship, created_at) values (v_a, 'Sam', '555-0101', 'Sister', now() - interval '1 minute') returning id into v_first;
  insert into emergency_contacts (user_id, name, phone, relationship) values (v_a, 'Alex', '555-0102', null);
  ${list('mine', 'v_a')}
  reset role;

  ${as('v_b')}
  ${list('stranger_sees', 'v_a')}
  delete from emergency_contacts where id = v_first;
  get diagnostics v_n = row_count;
  log := log || jsonb_build_array(jsonb_build_object('step', 'stranger_delete', 'ok', v_n = 0));
  reset role;

  ${as('v_a')}
  delete from emergency_contacts where id = v_first;
  ${list('after_remove', 'v_a')}
  reset role;`);
    s = stepMap(log);
  }, 60000);

  test('the person sees their contacts oldest first (the check-in suggests the first)', () => {
    expect(s.mine.data).toEqual([
      { name: 'Sam', phone: '555-0101', relationship: 'Sister' },
      { name: 'Alex', phone: '555-0102', relationship: null },
    ]);
  });

  test('nobody else can see or remove them', () => {
    expect(s.stranger_sees.data).toEqual([]);
    expect(s.stranger_delete.ok).toBe(true);
  });

  test('removing one leaves the rest', () => {
    expect(s.after_remove.data).toEqual([{ name: 'Alex', phone: '555-0102', relationship: null }]);
  });
});

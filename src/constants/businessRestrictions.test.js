import fs from 'fs';
import path from 'path';
import {
  NOT_ACCOMMODATED_KEYS, CHILD_ATTRIBUTES, PET_ATTRIBUTES, notAccommodatedProblem, notAccommodatedLine, childrenInAsk,
  walkInAsk, restrictionAsk, declinedBy, applyRestrictionsToCandidates,
} from './businessRestrictions';

const migration = fs.readFileSync(path.join(__dirname, '../../supabase/migrations/20270222_business_not_accommodated.sql'), 'utf8');

describe('not-accommodated vocabulary (item 86)', () => {
  it('client keys == the database CHECK and the setter list', () => {
    const lists = [...migration.matchAll(/array\['no_children', 'no_pets', 'adults_21_plus'\]/g)];
    expect(lists.length).toBeGreaterThanOrEqual(2);
    expect(NOT_ACCOMMODATED_KEYS).toEqual(['no_children', 'no_pets', 'adults_21_plus']);
  });
  it('client conflict attribute lists == the server trigger and routing rule', () => {
    expect(migration).toContain(`array[${CHILD_ATTRIBUTES.map((a) => `'${a}'`).join(', ')}]`);
    expect(migration).toContain(`array[${PET_ATTRIBUTES.map((a) => `'${a}'`).join(', ')}]`);
  });
  it('the reused declarations are not duplicated as new keys', () => {
    for (const k of ['no_large_groups', 'reservations_required', 'no_walk_ins', 'indoor_only', 'outdoor_only']) expect(NOT_ACCOMMODATED_KEYS).not.toContain(k);
  });
});

describe('owner-side conflicts mirror the server', () => {
  it('no children vs Family-friendly / suited ages; no pets vs Pet friendly; service animals are fine', () => {
    expect(notAccommodatedProblem(['no_children'], { attributes: ['kid_friendly'] })).toMatch(/Family-friendly/);
    expect(notAccommodatedProblem(['adults_21_plus'], { attributes: [], suited_age_min: 5 })).toMatch(/suited ages/);
    expect(notAccommodatedProblem(['no_pets'], { attributes: ['dog_friendly'] })).toMatch(/Pet friendly/);
    expect(notAccommodatedProblem(['no_pets'], { attributes: ['service_animal_friendly'] })).toBeNull();
    expect(notAccommodatedProblem([], { attributes: ['kid_friendly'] })).toBeNull();
  });
  it('public line only when declared', () => {
    expect(notAccommodatedLine({ not_accommodated: [] })).toBeNull();
    expect(notAccommodatedLine({})).toBeNull();
    expect(notAccommodatedLine({ not_accommodated: ['no_pets', 'no_children'] })).toBe('No children · No pets');
    expect(notAccommodatedLine({ not_accommodated: ['adults_21_plus'] })).toBe('21+ only');
  });
});

describe('the ask side reads only the person\'s words and ask attributes', () => {
  it('children', () => {
    for (const t of ['dinner with my kids', 'somewhere for my 5 year old', 'lunch with the children', 'brunch with our daughter', 'we have a stroller'])
      expect(childrenInAsk(t)).toBe(true);
    for (const t of ['dinner, no kids', 'kid-free brunch', 'adults only please', 'date night', 'dinner with my family', 'drinks with coworkers'])
      expect(childrenInAsk(t)).toBe(false);
    expect(childrenInAsk('dinner', ['kid_menu'])).toBe(true);
  });
  it('walk-in', () => {
    for (const t of ['a walk-in place', 'somewhere we can just show up', 'no reservation needed', 'without a booking']) expect(walkInAsk(t)).toBe(true);
    for (const t of ['book a table', 'dinner tonight', 'a place for my walk']) expect(walkInAsk(t)).toBe(false);
  });
});

describe('declinedBy: a declared restriction AND a conflicting ask; unknown is kept', () => {
  const a = (text, extra = {}) => restrictionAsk({ text, ...extra });
  it('each rule', () => {
    expect(declinedBy({ not_accommodated: ['no_children'] }, a('dinner with my kids'))).toBe('children');
    expect(declinedBy({ not_accommodated: ['adults_21_plus'] }, a('dinner with my kids'))).toBe('children');
    expect(declinedBy({ not_accommodated: ['no_pets'] }, a('x', { attributes: ['dog_friendly'] }))).toBe('pets');
    expect(declinedBy({ max_group_size: 6 }, a('x', { partySize: 10 }))).toBe('group');
    expect(declinedBy({ max_group_size: 10 }, a('x', { partySize: 10 }))).toBeNull();
    expect(declinedBy({ weather_setting: 'indoor' }, a('dinner outside'))).toBe('indoor_only');
    expect(declinedBy({ weather_setting: 'indoor' }, a('x', { attributes: ['outdoor_seating'] }))).toBe('indoor_only');
    expect(declinedBy({ weather_setting: 'outdoor' }, a('something indoors'))).toBe('outdoor_only');
    expect(declinedBy({ weather_setting: 'outdoor' }, a('nothing outdoors'))).toBe('outdoor_only');
    expect(declinedBy({ weather_setting: 'weather_dependent' }, a('dinner outside'))).toBeNull();
    expect(declinedBy({ booking_mode: 'request_required' }, a('walk in tonight'))).toBe('booking');
    expect(declinedBy({ booking_mode: 'reservation_recommended' }, a('walk in tonight'))).toBeNull();
  });
  it('a perk is never removed for its business needing a booking', () => {
    expect(declinedBy({ booking_mode: 'reservation_required' }, a('walk in'), { bookable: false })).toBeNull();
  });
  it('unknown business data or an ask that says nothing = kept', () => {
    expect(declinedBy({}, a('dinner with my kids', { partySize: 30 }))).toBeNull();
    expect(declinedBy({ not_accommodated: ['no_children', 'no_pets'], max_group_size: 2, weather_setting: 'indoor' }, a('dinner tonight'))).toBeNull();
  });
  it('apply: removes only conflicts, names them, keeps candidates with no partner row', () => {
    const cands = [{ id: 1, p: { not_accommodated: ['no_children'] } }, { id: 2, p: null }, { id: 3, p: { max_group_size: 4 } }, { id: 4, p: {} }];
    const out = applyRestrictionsToCandidates(cands, a('with my kids', { partySize: 8 }), (c) => c.p);
    expect(out.items.map((c) => c.id)).toEqual([2, 4]);
    expect(out.caption).toBe("Leaving out places that don't take children and places too small for your group");
    const none = applyRestrictionsToCandidates(cands, a('dinner'), (c) => c.p);
    expect(none.items).toBe(cands);
    expect(none.caption).toBeNull();
  });
});

describe('scope', () => {
  const ROOT = path.join(__dirname, '../..');
  const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
  it('typed asks, the owner chips and the public profile only; no server or AI in the rule module', () => {
    const users = fs.readdirSync(path.join(ROOT, 'src'), { recursive: true })
      .filter((f) => /\.js$/.test(f) && !/test\.js$/.test(f) && /from '[^']*businessRestrictions'/.test(read(`src/${f}`)))
      .map((f) => f.split(path.sep).join('/')).sort();
    expect(users).toEqual(['screens/BusinessDashboardScreen.js', 'screens/BusinessProfileScreen.js', 'services/intentResolver.js']);
    expect(read('src/constants/businessRestrictions.js').replace(/^\s*\/\/.*$/gm, '')).not.toMatch(/fetch\(|supabase|functions\.invoke|anthropic/i);
  });
  it('never in a business-facing payload', () => {
    const migs = fs.readdirSync(path.join(ROOT, 'supabase/migrations')).sort();
    for (const fn of ['get_business_opportunities', 'get_partner_demand_signals', 'business_safe_request_summary']) {
      const last = migs.filter((m) => new RegExp(`function\\s+public\\.${fn}\\b`, 'i').test(read(`supabase/migrations/${m}`))).pop();
      expect([fn, /not_accommodated/.test(read(`supabase/migrations/${last}`))]).toEqual([fn, false]);
    }
  });
});

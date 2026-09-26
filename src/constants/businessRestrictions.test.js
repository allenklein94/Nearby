import fs from 'fs';
import path from 'path';
import {
  NOT_ACCOMMODATED_KEYS, CHILD_ATTRIBUTES, PET_ATTRIBUTES, notAccommodatedLine, childrenInAsk,
  walkInAsk, restrictionAsk, askRaisesRestriction, applyRestrictionsToCandidates,
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

describe('save-time contradictions: one server trigger, no client copy (migrations 20270222 + 20270224)', () => {
  const ROOT = path.join(__dirname, '../..');
  const trigger = fs.readFileSync(path.join(ROOT, 'supabase/migrations/20270224_business_restriction_contradictions.sql'), 'utf8');
  const live = fs.readFileSync(path.join(ROOT, 'scripts/live-verify/business-restriction-contradictions.sql'), 'utf8');
  it('No children checks every explicit child/family field from the vocabulary audit', () => {
    for (const needle of ['new.attributes', 'new.suited_age_min', "'family' = any(coalesce(new.accommodates_party_types", "'family_gathering' = any(coalesce(new.offered_occasions",
      'new.priority_attributes', "'family_gathering' = any(coalesce(new.priority_occasions"]) expect([needle, trigger.includes(needle)]).toEqual([needle, true]);
    expect(trigger).toContain(`array[${CHILD_ATTRIBUTES.map((k) => `'${k}'`).join(', ')}]`);
    // not conflicts: an adult event, category classification
    expect(trigger).not.toMatch(/'baby_shower' = any/);
    expect(trigger).not.toMatch(/new\.(category|subcategory|categories)\b/);
  });
  it('Indoor only checks Outdoor dining and the outdoor size only while it counts; 21+ with No children is untouched', () => {
    expect(trigger).toMatch(/new\.weather_setting = 'indoor' and 'outdoor_seating' = any/);
    expect(trigger).toMatch(/new\.outdoor_capacity is not null/);
    expect(trigger).not.toMatch(/'adults_21_plus'[^\n]*'no_children'[^\n]*raise/);
  });
  it('the trigger fires on every column it reads', () => {
    const cols = trigger.match(/before insert or update of ([\s\S]*?)\s+on public\.brand_partners/)[1];
    for (const c of ['not_accommodated', 'attributes', 'suited_age_min', 'suited_age_max', 'accommodates_party_types', 'offered_occasions',
      'priority_attributes', 'priority_occasions', 'weather_setting', 'outdoor_capacity']) expect([c, cols.includes(c)]).toEqual([c, true]);
  });
  it('the live regression script covers every required combination', () => {
    for (const label of ['No children + Family group', 'No children + Group/Family occasion', 'No children + want more families', 'Indoor only + Outdoor dining',
      'Indoor only + outdoor area size', '21+ + No children', 'No children + Family-friendly', 'No children + Kids menu', 'No children + Family seating',
      'No children + Stroller friendly', 'No children + suited ages', 'No pets + Dog friendly', 'No pets + Pet friendly', 'No children + Quiet',
      'No children + Date-friendly', 'No children + Private events', 'No children + Groups', 'No children + large group size'])
      expect([label, live.includes(`('${label}',`)]).toEqual([label, true]);
    expect(live).toMatch(/\('21\+ \+ No children',[^\n]*'ALLOWED'\)/);
  });
  it('offerings (20270225): one label rule and one message, enforced from both sides; explicit designations only', () => {
    const off = fs.readFileSync(path.join(ROOT, 'supabase/migrations/20270225_no_children_offering_conflicts.sql'), 'utf8');
    expect(off).toMatch(/kind = 'experience' and party_type = 'family'/);
    expect(off).toContain(`array[${CHILD_ATTRIBUTES.map((k) => `'${k}'`).join(', ')}]`);
    expect(off).toMatch(/kind = 'package' and occasion = 'family_gathering'/);
    // never from free text: the label rule reads no description / included items
    expect(off.match(/function public\._family_offering_label[\s\S]*?\$\$;/)[0]).not.toMatch(/description|included_items/);
    expect(off).toMatch(/create trigger check_experience_vs_no_children[\s\S]*business_experiences/);
    expect(off).toMatch(/create trigger check_package_vs_no_children[\s\S]*business_occasion_packages/);
    expect(off).toMatch(/public\._business_family_offerings\(new\.id\)/);
    // one message: the shared _no_children_conflict owns the only live raise (the other occurrence is the patch's find-text)
    expect(off).toMatch(/function public\._no_children_conflict[\s\S]*?raise exception 'You said you don''t accommodate children/);
    expect(off).toMatch(/perform public\._no_children_conflict\(v_kids\);\$q\$\);/);
    for (const label of ['No children + Family Signature Experience', 'No children + Family Gathering package', 'No children + paused Family Gathering package',
      '21+ + Family Signature Experience', '21+ + Family Gathering package', 'No children + Groups Signature Experience', 'No children + Birthday package'])
      expect([label, live.includes(`('${label}',`)]).toEqual([label, true]);
  });
  it('experience saves through the screening function surface a rule refusal as 400', () => {
    const fn = fs.readFileSync(path.join(ROOT, 'supabase/functions/screen-business-content/index.ts'), 'utf8');
    expect((fn.match(/experience (update|create) failed', writeError\);\s*return json\(\{ error: writeError\.message \|\| 'Could not save your changes\.' \}, \(writeError\.code === 'P0001'/g) ?? []).length).toBe(2);
  });
  it('no conflict decision in the client; the profile editor surfaces the refusal as the owner\'s to fix', () => {
    const dash = fs.readFileSync(path.join(ROOT, 'src/screens/BusinessDashboardScreen.js'), 'utf8');
    expect(dash).not.toMatch(/notAccommodatedProblem|kid_friendly[^\n]*no_children|no_children[^\n]*kid_friendly/);
    expect(fs.readFileSync(path.join(ROOT, 'src/constants/businessRestrictions.js'), 'utf8')).not.toMatch(/export function notAccommodatedProblem/);
    const fn = fs.readFileSync(path.join(ROOT, 'supabase/functions/screen-business-content/index.ts'), 'utf8');
    expect(fn).toMatch(/writeError\.code === 'P0001'[\s\S]{0,120}isRuleRefusal \? 400 : 500/);
  });
  it('public line only when declared', () => {
    expect(notAccommodatedLine({ not_accommodated: [] })).toBeNull();
    expect(notAccommodatedLine({})).toBeNull();
    expect(notAccommodatedLine({ not_accommodated: ['no_pets', 'no_children'] })).toBe('No children · No pets');
    expect(notAccommodatedLine({ not_accommodated: ['adults_21_plus'] })).toBe('21+ only');
  });
});

describe('explicit words only (owner decision 2026-09-26)', () => {
  it('ordinary asks raise nothing', () => {
    for (const t of ['dinner tonight', 'restaurant tonight', 'nightlife', 'nightlife tonight', 'a date tonight', 'dinner with my family', 'drinks with coworkers', 'brunch', 'a cozy bar'])
      expect([t, askRaisesRestriction(restrictionAsk(t))]).toEqual([t, false]);
  });
  it('children only from their words', () => {
    for (const t of ['dinner with my kids', 'somewhere for my 5 year old', 'lunch with the children', 'brunch with our daughter', 'we have a stroller', 'a kid-friendly place'])
      expect([t, childrenInAsk(t)]).toEqual([t, true]);
    for (const t of ['dinner, no kids', 'kid-free brunch', 'adults only please', 'dinner with my family'])
      expect([t, childrenInAsk(t)]).toEqual([t, false]);
  });
  it('pets, environment, walk-in, party size', () => {
    expect(restrictionAsk('pet-friendly restaurant').pets).toBe(true);
    expect(restrictionAsk('dinner with my dog').pets).toBe(true);
    expect(restrictionAsk('restaurant tonight').pets).toBe(false);
    expect(restrictionAsk('dinner on a patio').wantsOutdoor).toBe(true);
    expect(restrictionAsk('nothing outdoors').wantsIndoor).toBe(true);
    for (const t of ['a walk-in place', 'somewhere we can just show up', 'no reservation needed', 'without a booking']) expect(walkInAsk(t)).toBe(true);
    for (const t of ['book a table', 'dinner tonight', 'a place for my walk']) expect(walkInAsk(t)).toBe(false);
    expect(restrictionAsk('x', 10).partySize).toBe(10);
    expect(restrictionAsk('x', null).partySize).toBeNull();
  });
  it('nightlife never implies 21+: no restriction key is inferred from a category word', () => {
    expect(restrictionAsk('nightlife with friends')).toEqual({ partySize: null, children: false, pets: false, wantsOutdoor: false, wantsIndoor: false, walkIn: false });
  });
});

describe('applying the server answer', () => {
  it('removes only what the server named, keeps the rest, names it', () => {
    const cands = [{ id: 1, partnerId: 'a' }, { id: 2, partnerId: null }, { id: 3, partnerId: 'b' }, { id: 4, partnerId: 'c' }];
    const out = applyRestrictionsToCandidates(cands, new Map([['a', 'children'], ['b', 'group']]));
    expect(out.items.map((c) => c.id)).toEqual([2, 4]);
    expect(out.caption).toBe("Leaving out places that don't take children and places too small for your group");
  });
  it('a booking conflict never removes a perk; an empty or failed answer changes nothing', () => {
    const cands = [{ id: 1, partnerId: 'a', type: 'perk' }, { id: 2, partnerId: 'a', type: 'business_availability' }];
    const out = applyRestrictionsToCandidates(cands, new Map([['a', 'booking']]), { isBusiness: (c) => c.type !== 'perk' });
    expect(out.items.map((c) => c.id)).toEqual([1]);
    const none = applyRestrictionsToCandidates(cands, new Map());
    expect(none.items).toBe(cands);
    expect(none.caption).toBeNull();
  });
});

describe('one rule for every path (migration 20270223)', () => {
  const single = fs.readFileSync(path.join(__dirname, '../../supabase/migrations/20270223_business_declines_single_rule.sql'), 'utf8');
  it('the request wrapper and the typed-ask RPC both call _business_declines; the client decides no conflict itself', () => {
    expect(single).toMatch(/function public\._business_declines_request[\s\S]*public\._business_declines\(/);
    expect(single).toMatch(/function public\.get_declined_businesses[\s\S]*public\._business_declines\(/);
    const src = fs.readFileSync(path.join(__dirname, 'businessRestrictions.js'), 'utf8').replace(/^\s*\/\/.*$/gm, '');
    expect(src).not.toMatch(/not_accommodated\s*[&|.]|max_group_size|weather_setting|booking_mode/);
  });
  it('routing and all three auto-offer matchers use the rule', () => {
    for (const fn of ['_business_request_fanout', '_match_request_to_availability', '_match_request_to_package', '_match_request_to_policy'])
      expect([fn, migration.includes(`'public.${fn}(`) || migration.includes(fn)]).toEqual([fn, true]);
    expect((migration.match(/_business_declines_request\(p\.id, request_id_param\)/g) ?? []).length).toBe(4);
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

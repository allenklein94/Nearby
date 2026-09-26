// Capacity = TOTAL people in the gathering, INCLUDING the host, everywhere (owner decision 2026-09-26, migration 20270209).
const fs = require('fs');
const path = require('path');
const { peopleGoing, guestLimit, isGatheringFull, getGatheringFullness, gatheringBusinessPartySize, gatheringFullnessLabel } = require('./gatheringFullness');
const { capacityForPartySize } = require('./gatheringStructure');
const { gatheringSocialFacts } = require('../constants/socialContext');
const ROOT = path.join(__dirname, '../..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const g = (capacity, guests) => ({ capacity, approvedCount: guests });

describe('capacity counts the host', () => {
  it('1. capacity 1 = 1 person total: the host alone is full', () => {
    expect(guestLimit(1)).toBe(0);
    expect(isGatheringFull(g(1, 0))).toBe(true);
    expect(getGatheringFullness(g(1, 0))).toMatchObject({ people: 1, spotsLeft: 0, isFull: true });
  });
  it('2. capacity 2 = 2 people total: host + one guest', () => {
    expect(guestLimit(2)).toBe(1);
    expect(isGatheringFull(g(2, 0))).toBe(false);
    expect(isGatheringFull(g(2, 1))).toBe(true);
    expect(getGatheringFullness(g(2, 1))).toMatchObject({ people: 2, spotsLeft: 0 });
  });
  it('3. capacity 4 = 4 people total: never 5', () => {
    expect([0, 1, 2, 3].map((n) => isGatheringFull(g(4, n)))).toEqual([false, false, false, true]);
    expect(getGatheringFullness(g(4, 1))).toMatchObject({ people: 2, spotsLeft: 2 });
    expect(gatheringFullnessLabel(g(4, 3))).toBe('🔒 Full — Join Waitlist');
  });
  it('4. guest limit = capacity minus the host; no limit stays no limit', () => {
    expect([1, 2, 4, 6, 10].map(guestLimit)).toEqual([0, 1, 3, 5, 9]);
    expect(guestLimit(null)).toBeNull();
    expect(isGatheringFull(g(null, 50))).toBe(false);
    expect(getGatheringFullness(g(null, 3))).toBeNull();
  });
  it('5. business request party size = capacity (mirrors _gathering_party_size), never capacity + 1', () => {
    expect(gatheringBusinessPartySize(g(2, 0))).toBe(2);
    expect(gatheringBusinessPartySize(g(4, 0))).toBe(4);
    expect(gatheringBusinessPartySize(g(4, 3))).toBe(4);
    expect(gatheringBusinessPartySize(g(null, 3))).toBe(4);
    const sql = read('supabase/migrations/20270161_gathering_party_size_and_demand_floor.sql');
    expect(sql).toMatch(/status = 'approved'\), 0\) \+ 1,\s*coalesce\(\(select capacity from gatherings/);
  });
  it('6. capacity 2 can normalize to one-on-one; capacity 1 to solo', () => {
    expect([...gatheringSocialFacts({ capacity: 2 }).contexts]).toEqual(['one_on_one']);
    expect([...gatheringSocialFacts({ capacity: 1 }).contexts]).toEqual(['solo']);
  });
  it('7. capacity never implies meeting new people', () => {
    for (const c of [1, 2, 3, 8, 50]) expect(gatheringSocialFacts({ capacity: c }).meetNewPeople).toBeNull();
  });
  it('8. no path adds the host twice: the +1 lives in exactly one client helper and one server helper', () => {
    expect(peopleGoing(g(4, 2))).toBe(3);
    const fullness = read('src/utils/gatheringFullness.js');
    expect(fullness).toMatch(/return guests \+ 1;/);
    // no other source file compares an attendee count against capacity or adds 1 to an attendee count for capacity
    const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
    for (const f of walk(path.join(ROOT, 'src')).filter((f) => /\.js$/.test(f) && !/\.test\.js$|journey\.js$|gatheringFullness\.js$/.test(f))) {
      const s = fs.readFileSync(f, 'utf8');
      expect([path.relative(ROOT, f), /attendeeTotal\([^)]*\)\s*(?:>=|>|<=|<)\s*[\w?.]*capacity\b|attendeeTotal\([^)]*\)\s*\+\s*1\b|(?:>=|<=)\s*[\w?.]*\.capacity\b|\.capacity\s*-\s*attendee/.test(s)]).toEqual([path.relative(ROOT, f), false]);
    }
    const mig = read('supabase/migrations/20270209_capacity_total_people.sql');
    for (const fn of ['join_gathering', 'approve_gathering_interest', '_promote_from_waitlist']) {
      const body = mig.slice(mig.indexOf(`FUNCTION public.${fn}(`));
      expect([fn, /_gathering_guest_limit\(v_capacity\)/.test(body.slice(0, body.indexOf('$function$;')))]).toEqual([fn, true]);
    }
    expect(mig).toMatch(/capacity_param < v_approved \+ 1/);
  });
});

describe('Create / Edit use the same meaning', () => {
  it('"2-4 people" stores 4 = 4 people total; the copy says it includes the host', () => {
    const create = read('src/screens/CreateGatheringScreen.js');
    expect(create).toContain("{ key: '2-4', label: '2-4 people', capacity: 4 }");
    expect(create).toContain('Counts everyone, including you.');
    expect(capacityForPartySize(4)).toMatchObject({ option: '2-4' });
    const edit = read('src/screens/EditGatheringScreen.js');
    expect(edit).toMatch(/Math\.max\(peopleGoing\(gathering\), n - 1\)/);
  });
});

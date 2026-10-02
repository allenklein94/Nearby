import { buildDiscoverSections, SECTION_CAP, compareDiscover } from './discoverSections';
import { tierVector, SIGNAL_TIERS } from '../constants/signalPriority';

const NOW = new Date(2026, 8, 25, 20, 0); // Fri 8 PM
const at = (h, dayOffset = 0) => new Date(2026, 8, 25 + dayOffset, h, 0).toISOString();
// Deterministic window stub: 'now' = within the hour, 'today' = later today, 'weekend' = Sat/Sun.
const isInWindow = (iso, key) => {
  const d = new Date(iso);
  const mins = (d - NOW) / 60000;
  if (key === 'now') return mins >= -30 && mins <= 60;
  if (key === 'today') return d.toDateString() === NOW.toDateString() && mins > 0;
  if (key === 'weekend') return [0, 6].includes(d.getDay());
  return false;
};
const g = (id, over = {}) => ({ id, scheduled_at: at(12, 5), interest_tag: 'Coffee', approvedCount: 0, ...over });
const run = (gatherings, extra = {}) => buildDiscoverSections({ gatherings, now: NOW, isInWindow, ...extra });
const keys = (s) => s.map((x) => x.key);
const ids = (s) => s.flatMap((x) => x.items.map((i) => i.id));

describe('Discover contextual sections (item 91)', () => {
  it('orders Happening Now, Tonight, Because you like, Friends, Trending, Weekend (the ranking ladder; 2026-09-27)', () => {
    const s = run([
      g('now', { scheduled_at: at(20) }),
      g('tonight', { scheduled_at: at(23) }),
      g('hot', { approvedCount: 9 }),
      g('yoga', { interest_tag: 'Yoga' }),
      g('jazz', { interest_tag: 'Jazz' }),
      g('sat', { scheduled_at: at(12, 1), interest_tag: 'Hiking' }),
    ], { declared: ['Yoga'], friendInterestByTag: { Jazz: { friend_count: 2, sample_names: ['Sam', 'Alex'] } } });
    expect(keys(s)).toEqual(['now', 'tonight', 'because', 'friends', 'trending', 'weekend']);
    expect(s.find((x) => x.key === 'tonight').title).toBe('🌙 Tonight');
    expect(s.find((x) => x.key === 'because').title).toBe('✨ Because you like Yoga');
    expect(s.find((x) => x.key === 'friends').title).toBe('🤝 Sam and Alex are into Jazz');
  });
  it('a gathering never appears twice, and excluded ids never appear', () => {
    const list = [g('a', { scheduled_at: at(22), approvedCount: 9 }), g('b', { approvedCount: 9 }), g('c')];
    const s = run(list, { declared: ['Coffee'], excludeIds: new Set(['c']) });
    const all = ids(s);
    expect(new Set(all).size).toBe(all.length);
    expect(all).not.toContain('c');
    // a popular gathering in a declared interest now lands under Because you like (above Trending), never both
    expect(s.find((x) => x.key === 'because').items.map((i) => i.id)).toEqual(['b']);
    expect(keys(s)).not.toContain('trending');
  });
  it('omits empty sections and invents none', () => {
    expect(run([])).toEqual([]);
    expect(keys(run([g('x')]))).toEqual([]); // no time window, no attendance, no declared, no friends
  });
  it('Trending needs the shared attendance floor', () => {
    expect(keys(run([g('x', { approvedCount: 4 })]))).not.toContain('trending');
    expect(keys(run([g('x', { approvedCount: 5 })]))).toContain('trending');
  });
  it('Because you like only uses declared interests; picks the one with the most nearby', () => {
    const s = run([g('1', { interest_tag: 'Yoga' }), g('2', { interest_tag: 'Tennis' }), g('3', { interest_tag: 'Tennis' })], { declared: ['Yoga', 'Tennis'] });
    expect(s[0].tag).toBe('Tennis');
    expect(keys(run([g('1')], { declared: [] }))).toEqual([]);
  });
  it('Friends section words a single friend honestly and skips zero counts', () => {
    const one = run([g('1', { interest_tag: 'Jazz' })], { friendInterestByTag: { Jazz: { friend_count: 1, sample_names: ['Sam'] } } });
    expect(one[0].title).toBe('🤝 Sam is into Jazz');
    expect(run([g('1', { interest_tag: 'Jazz' })], { friendInterestByTag: { Jazz: { friend_count: 0 } } })).toEqual([]);
  });
  it('a daytime start keeps the section honest as "Today"', () => {
    const morning = new Date(2026, 8, 25, 9, 0);
    const win = (iso, key) => key === 'today' && new Date(iso) > morning && new Date(iso).toDateString() === morning.toDateString();
    const s = buildDiscoverSections({ gatherings: [g('lunch', { scheduled_at: at(13) }), g('eve', { scheduled_at: at(21) })], now: morning, isInWindow: win });
    expect(s[0].title).toBe('🌅 Today');
  });
  it('caps each section and reports more', () => {
    const many = Array.from({ length: SECTION_CAP + 2 }, (_, i) => g(`t${i}`, { approvedCount: 9 }));
    const t = run(many).find((x) => x.key === 'trending');
    expect(t.items).toHaveLength(SECTION_CAP);
    expect(t.hasMore).toBe(true);
  });
  it('Discover renders search prompt, then Browse, then the sections', () => {
    const src = require('fs').readFileSync(require('path').join(__dirname, '../screens/DiscoverHubScreen.js'), 'utf8');
    expect(src).toContain('What are you looking for?');
    const browse = src.indexOf("{t('ui.discover.browse')}</Text>");
    const sections = src.indexOf('discoverSections.map(');
    expect(browse).toBeGreaterThan(0);
    expect(sections).toBeGreaterThan(browse);
    expect(src).not.toContain('What are you into?</Text>');
  });

  it('a gathering that qualifies for every section lands only in the first (Happening Now)', () => {
    const s = run([g('all', { scheduled_at: at(20), approvedCount: 9, interest_tag: 'Jazz' })],
      { declared: ['Jazz'], friendInterestByTag: { Jazz: { friend_count: 3, sample_names: [] } } });
    expect(keys(s)).toEqual(['now']);
  });
  it('a right-now start that overflows Happening Now is never headed "Tonight"', () => {
    const list = Array.from({ length: 8 }, (_, i) => g(`n${i}`, { scheduled_at: at(21) }));
    const today = run(list).find((x) => x.key === 'tonight');
    expect(today.title).toBe('🌅 Today');
  });
  it('Trending reads the server attendee count, so no hidden identities are needed', () => {
    const s = run([g('x', { approvedCount: 6, attendees: [{ user_id: 'friend' }] })]);
    expect(keys(s)).toEqual(['trending']);
  });
  it('Because you like has no behavior input: an undeclared tag never gets the section', () => {
    const s = run([g('1', { interest_tag: 'Tennis' })], { declared: ['Yoga'], behavior: { Tennis: 10 } });
    expect(keys(s)).toEqual([]);
  });
  it('Friends wording: names where the server gave them, counts otherwise', () => {
    const f = (entry) => run([g('1', { interest_tag: 'Jazz' })], { friendInterestByTag: { Jazz: entry } })[0].title;
    expect(f({ friend_count: 4, sample_names: ['Sam', 'Alex'] })).toBe('🤝 Sam, Alex and 2 more friends are into Jazz');
    expect(f({ friend_count: 3, sample_names: [] })).toBe('🤝 3 friends are into Jazz');
  });
  it('friend signals come only from the accepted-friends server lookup', () => {
    const read = (f) => require('fs').readFileSync(require('path').join(__dirname, '..', f), 'utf8');
    expect(read('services/friendInterests.js')).toMatch(/rpc\('get_friends_interested_in'/);
    const d = read('screens/DiscoverHubScreen.js');
    expect(d).toMatch(/setFriendInterestByTag\(m\)/);
    expect(d).toMatch(/getFriendsInterestedIn\(gatheringTagKey/);
    expect(read('utils/discoverSections.js').replace(/^\s*\/\/.*$/gm, '')).not.toMatch(/supabase|attendees|user_id/);
  });
  it('Discover wiring: declared interests only, repeat-search section first and excluded, Open now respected', () => {
    const d = require('fs').readFileSync(require('path').join(__dirname, '../screens/DiscoverHubScreen.js'), 'utf8');
    expect(d).toMatch(/declared: personalization\.declared,/);
    expect(d).toMatch(/excludeIds: topCategoryIds,/);
    expect(d).toMatch(/gatherings: filteredGatherings,/);
    expect(d).toMatch(/const filteredGatherings = filterGatheringsByEnvironment\(\s*applyOpenNow\(/);
    expect(d.indexOf('{topCategoryGatherings.map(renderGatheringTile)}')).toBeLessThan(d.indexOf('discoverSections.map('));
    expect(d).toMatch(/railGroups\(CATEGORY_GROUPS\)/);
    expect(d).toMatch(/\.\.\.\(showMoreCategories \? rail\.more : \[\]\)/);
  });
  it('the rail keeps seven visible categories with "Activities"', () => {
    const { DISCOVER_RAIL_PRIMARY } = require('../constants/discoverCategoryRail');
    expect(DISCOVER_RAIL_PRIMARY).toHaveLength(7);
    expect(DISCOVER_RAIL_PRIMARY.map((p) => p.label)).toContain('Activities');
    expect(DISCOVER_RAIL_PRIMARY.map((p) => p.label)).not.toContain('Things To Do');
  });
});

describe('inside a section: the one ranking ladder (2026-09-27)', () => {
  const v = (parts) => tierVector(parts);
  const scored = (vectors) => (g0) => ({ ...g0, fit: { score: vectors[g0.id].score, reasons: [], rankVector: vectors[g0.id].v } });
  it('a friend going beats a higher fit score (attendance) inside Tonight', () => {
    const vectors = {
      crowd: { score: 12, v: v([{ tier: SIGNAL_TIERS.popularity, delta: 10 }, { tier: SIGNAL_TIERS.time, delta: 2 }]) },
      friend: { score: 2, v: v([{ tier: SIGNAL_TIERS.planFriend, delta: 4 }, { tier: SIGNAL_TIERS.time, delta: 2 }]) },
    };
    const s = run([g('crowd', { scheduled_at: at(22) }), g('friend', { scheduled_at: at(23) })], { score: scored(vectors) });
    expect(s.find((x) => x.key === 'tonight').items.map((i) => i.id)).toEqual(['friend', 'crowd']);
  });
  it('Happening Now follows the ladder too; nearest only breaks ties', () => {
    const vectors = {
      near: { score: 0, v: v([]) },
      far: { score: 5, v: v([{ tier: SIGNAL_TIERS.interest, delta: 5 }]) },
      near2: { score: 0, v: v([]) },
    };
    const s = run([g('near', { scheduled_at: at(20), distanceMiles: 0.2 }), g('far', { scheduled_at: at(20), distanceMiles: 9 }), g('near2', { scheduled_at: at(20), distanceMiles: 0.1 })], { score: scored(vectors) });
    expect(s[0].items.map((i) => i.id)).toEqual(['far', 'near2', 'near']);
  });
  it('without vectors the old score-then-nearest order is kept', () => {
    const a = { id: 'a', fit: { score: 1 }, distanceMiles: 1 };
    const b = { id: 'b', fit: { score: 3 }, distanceMiles: 5 };
    expect([a, b].sort(compareDiscover).map((x) => x.id)).toEqual(['b', 'a']);
  });
  it('Discover scores every gathering list through the ladder (sections, the repeat-search section, the Gatherings tab, the category view)', () => {
    const src = require('fs').readFileSync(require('path').join(__dirname, '../screens/DiscoverHubScreen.js'), 'utf8');
    expect(src).toMatch(/fit\.rankVector = tierVector\(/);
    expect((src.match(/\.sort\(compareDiscover\)/g) ?? []).length).toBe(2);
    expect(src).toMatch(/byLadder\(contextGatheringsAll\), byLadder\(contextOtherTimeAll\)/);
    expect(src).not.toMatch(/b\.fit\.score - a\.fit\.score/);
  });
});

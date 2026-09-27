import { buildDiscoverSections, SECTION_CAP } from './discoverSections';

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
  it('orders Happening Now, Tonight, Trending, Because you like, Friends, Weekend', () => {
    const s = run([
      g('now', { scheduled_at: at(20) }),
      g('tonight', { scheduled_at: at(23) }),
      g('hot', { approvedCount: 9 }),
      g('yoga', { interest_tag: 'Yoga' }),
      g('jazz', { interest_tag: 'Jazz' }),
      g('sat', { scheduled_at: at(12, 1), interest_tag: 'Hiking' }),
    ], { declared: ['Yoga'], friendInterestByTag: { Jazz: { friend_count: 2, sample_names: ['Sam', 'Alex'] } } });
    expect(keys(s)).toEqual(['now', 'tonight', 'trending', 'because', 'friends', 'weekend']);
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
    expect(s.find((x) => x.key === 'trending').items.map((i) => i.id)).toEqual(['b']);
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
    const browse = src.indexOf('>Browse</Text>');
    const sections = src.indexOf('discoverSections.map(');
    expect(browse).toBeGreaterThan(0);
    expect(sections).toBeGreaterThan(browse);
    expect(src).not.toContain('What are you into?</Text>');
  });
});

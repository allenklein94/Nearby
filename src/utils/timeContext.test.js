// 10/10 roadmap Part 8: technical validation. Unit tests for
// timeContext.js's pure functions.
const {
  formatHeroDateTime,
  getGreeting,
  getTimePeriod,
  getQuickPrompts,
  getPersonalizedQuickPicks,
  getPinnedQuickPicks,
} = require('./timeContext');

describe('formatHeroDateTime', () => {
  it('reads "Today" for a timestamp on today\'s calendar date', () => {
    const now = new Date();
    now.setHours(19, 15, 0, 0);
    expect(formatHeroDateTime(now.toISOString(), new Date(now.getTime() - 5 * 3600000))).toMatch(/^(Today|Tonight) · /);
  });

  it('reads "Tomorrow" for a timestamp exactly one calendar day out', () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(19, 15, 0, 0);
    expect(formatHeroDateTime(tomorrow.toISOString())).toMatch(/^Tomorrow · /);
  });

  it('reads a real weekday/date for anything further out', () => {
    const future = new Date();
    future.setDate(future.getDate() + 10);
    const formatted = formatHeroDateTime(future.toISOString());
    expect(formatted).not.toMatch(/^Today/);
    expect(formatted).not.toMatch(/^Tomorrow/);
    expect(formatted).toContain('·');
  });
});

describe('getGreeting', () => {
  it('returns one of the three real greeting strings', () => {
    expect(['Good morning', 'Good afternoon', 'Good evening']).toContain(getGreeting());
  });
});

describe('getTimePeriod', () => {
  it('returns "weekend" for a Saturday and a Sunday regardless of hour', () => {
    expect(getTimePeriod(new Date('2026-08-15T03:00:00'))).toBe('weekend'); // a Saturday
    expect(getTimePeriod(new Date('2026-08-16T22:00:00'))).toBe('weekend'); // a Sunday
  });

  it('buckets a weekday by hour into morning/afternoon/evening', () => {
    // 2026-08-12 is a Wednesday.
    expect(getTimePeriod(new Date('2026-08-12T09:00:00'))).toBe('morning');
    expect(getTimePeriod(new Date('2026-08-12T14:00:00'))).toBe('afternoon');
    expect(getTimePeriod(new Date('2026-08-12T20:00:00'))).toBe('evening');
  });
});

describe('getQuickPrompts', () => {
  it('returns the real static list for a known period', () => {
    expect(getQuickPrompts('morning').map((p) => p.label)).toEqual(['Coffee', 'Morning Run', 'Breakfast']);
  });

  it('falls back to evening for an unknown period', () => {
    expect(getQuickPrompts('bogus')).toEqual(getQuickPrompts('evening'));
  });

  it('carries a real narrowing searchTerm for a label more specific than its broad category, omitted where label and category already mean the same thing', () => {
    const weekend = getQuickPrompts('weekend');
    expect(weekend.find((p) => p.label === 'Beach Volleyball')).toEqual({ icon: '🏐', label: 'Beach Volleyball', category: 'Sports', searchTerm: 'volleyball' });
    const morning = getQuickPrompts('morning');
    expect(morning.find((p) => p.label === 'Coffee').searchTerm).toBeUndefined();
  });
});

const styleForCategory = (tag) => ({ icon: '🏷️' });

describe('getPersonalizedQuickPicks', () => {
  it('falls back to the static period defaults with no real category history', () => {
    expect(getPersonalizedQuickPicks('morning', [], styleForCategory)).toEqual(getQuickPrompts('morning'));
    expect(getPersonalizedQuickPicks('morning', null, styleForCategory)).toEqual(getQuickPrompts('morning'));
  });

  it('flavors a real top category that has an established period label', () => {
    const picks = getPersonalizedQuickPicks('evening', ['Foodie'], styleForCategory);
    expect(picks[0]).toEqual({ icon: '🍽️', label: 'Dinner', category: 'Foodie', searchTerm: 'dinner' });
  });

  it('falls back to a generic icon/tag-name for a category with no period flavor', () => {
    const picks = getPersonalizedQuickPicks('evening', ['Hiking'], styleForCategory);
    expect(picks[0]).toEqual({ icon: '🏷️', label: 'Hiking', category: 'Hiking' });
  });

  it('backfills remaining slots from the static defaults, capped at 3, no duplicates', () => {
    const picks = getPersonalizedQuickPicks('evening', ['Hiking'], styleForCategory);
    expect(picks).toHaveLength(3);
    const categories = picks.map((p) => p.category);
    expect(new Set(categories).size).toBe(categories.length);
  });
});

describe('getPinnedQuickPicks', () => {
  it('always returns exactly the pinned categories, regardless of period', () => {
    const picks = getPinnedQuickPicks(['Coffee', 'Hiking'], 'evening', styleForCategory);
    expect(picks.map((p) => p.category)).toEqual(['Coffee', 'Hiking']);
  });

  it('uses the period flavor when one exists, otherwise a generic fallback', () => {
    const picks = getPinnedQuickPicks(['Foodie', 'Hiking'], 'evening', styleForCategory);
    expect(picks[0]).toEqual({ icon: '🍽️', label: 'Dinner', category: 'Foodie', searchTerm: 'dinner' });
    expect(picks[1]).toEqual({ icon: '🏷️', label: 'Hiking', category: 'Hiking' });
  });
});

describe('whenLabel (clearest temporal wording)', () => {
  const { whenLabel } = require('./timeContext');
  const now = new Date(2026, 8, 20, 15, 0, 0);
  const at = (dayOffset, h, m = 0) => new Date(2026, 8, 20 + dayOffset, h, m).toISOString();
  it('says Happening now within 30 min after the start', () => {
    expect(whenLabel(new Date(now.getTime() - 10 * 60000).toISOString(), now)).toBe('Happening now');
    expect(whenLabel(now.toISOString(), now)).toBe('Happening now');
  });
  it('does not claim now for something that started long ago (no invented duration)', () => {
    expect(whenLabel(at(0, 13), now)).toBe('Today · 1 PM');
  });
  it('says Starts in N min within the hour', () => {
    expect(whenLabel(new Date(now.getTime() + 45 * 60000).toISOString(), now)).toBe('Starts in 45 min');
    expect(whenLabel(new Date(now.getTime() + 20 * 1000).toISOString(), now)).toBe('Starts in 1 min');
    expect(whenLabel(new Date(now.getTime() + 61 * 60000).toISOString(), now)).toMatch(/^Today · /);
  });
  it('uses Today before 6 PM, Tonight from 6 PM, with the time', () => {
    expect(whenLabel(at(0, 16, 30), now)).toBe('Today · 4:30 PM');
    expect(whenLabel(at(0, 18, 30), now)).toBe('Tonight · 6:30 PM');
  });
  it('tomorrow and later show the day and a clean time', () => {
    expect(whenLabel(at(1, 19), now)).toBe('Tomorrow · 7 PM');
    expect(whenLabel(at(10, 19, 15), now)).toMatch(/· 7:15 PM$/);
  });
  it('invalid input is null, never "Invalid Date"', () => {
    expect(whenLabel('nope', now)).toBeNull();
  });
});

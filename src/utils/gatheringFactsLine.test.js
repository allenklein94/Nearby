// Discover attendee count (owner, 2026-10-25): "N attending" is a fact on Home AND Discover gathering cards, from ONE rule,
// on the facts line (never a reason slot), never gated by Trending, dropped first (never truncated) when a one-line tile runs long.
const fs = require('fs');
const path = require('path');
const {
  attendingCountLabel,
  gatheringFactsLine,
  COMPACT_FACTS_MAX_CHARS,
  NOW_TILE_FACTS_MAX_CHARS,
} = require('./gatheringFullness');
const { TRENDING_ATTENDANCE_MIN } = require('../constants/trending');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
const guests = (n) => Array.from({ length: n }, (_, i) => ({ user_id: `u${i}` }));

describe('attendingCountLabel: confirmed attendees + the host', () => {
  test('host + 2 joined = "3 attending" (below the Trending threshold, still shown)', () => {
    expect(attendingCountLabel({ approvedAttendees: guests(2) })).toBe('3 attending');
    expect(2).toBeLessThan(TRENDING_ATTENDANCE_MIN);
  });
  test("the server's approvedCount wins over the visible rows (blocked people hidden by RLS)", () => {
    expect(attendingCountLabel({ approvedCount: 4, approvedAttendees: guests(3) })).toBe('5 attending');
  });
  test('host alone = "1 attending" (the host is going; same as Home has always shown)', () => {
    expect(attendingCountLabel({ approvedAttendees: [] })).toBe('1 attending');
  });
  test('unknown guest count = nothing, never a guess', () => {
    expect(attendingCountLabel({})).toBeNull();
    expect(attendingCountLabel({ attendeeCount: 3 })).toBeNull();
    expect(attendingCountLabel(null)).toBeNull();
  });
  test('read in the person\'s language', () => {
    expect(attendingCountLabel({ approvedAttendees: guests(2) }, 'es')).toBe('3 asistirán');
  });
});

describe('gatheringFactsLine', () => {
  const g = { approvedAttendees: guests(2) };
  test('count goes LAST on the facts line', () => {
    expect(gatheringFactsLine(['Tonight 6:30 PM', 'About 0.7 mi'], g)).toBe('Tonight 6:30 PM · About 0.7 mi · 3 attending');
  });
  test('never said twice: a shown Trending reason with the same count suppresses it', () => {
    const big = { approvedAttendees: guests(5) };
    expect(gatheringFactsLine(['Tonight'], big, { reasons: ['6 attending'] })).toBe('Tonight');
    expect(gatheringFactsLine(['Tonight'], big, { language: 'es', reasons: ['6 attending'] })).toBe('Tonight');
    expect(gatheringFactsLine(['Tonight'], big, { reasons: ['Because you like Coffee'] })).toBe('Tonight · 6 attending');
  });
  test('compact rows: time, distance and spots left win; over budget the count is omitted, not truncated', () => {
    const long = ['Because you like Coffee', 'Tonight 6:30 PM · About 0.7 mi', '🟢 5 spots left'];
    const line = gatheringFactsLine(long, g, { maxChars: COMPACT_FACTS_MAX_CHARS });
    expect(line).toBe(long.join(' · '));
    expect(line).not.toMatch(/attending/);
    const short = gatheringFactsLine(['Tonight 6:30 PM · About 0.7 mi'], g, { maxChars: COMPACT_FACTS_MAX_CHARS });
    expect(short).toBe('Tonight 6:30 PM · About 0.7 mi · 3 attending');
    expect(short.length).toBeLessThanOrEqual(COMPACT_FACTS_MAX_CHARS);
  });
  test('the budget never drops the caller\'s own parts', () => {
    const parts = ['x'.repeat(NOW_TILE_FACTS_MAX_CHARS + 10)];
    expect(gatheringFactsLine(parts, g, { maxChars: NOW_TILE_FACTS_MAX_CHARS })).toBe(parts[0]);
  });
  test('no parts and no known count = null', () => {
    expect(gatheringFactsLine([null], {})).toBeNull();
    expect(gatheringFactsLine([], g)).toBe('3 attending');
  });
});

describe('Home and Discover read the one rule', () => {
  const home = read('screens/HomeScreen.js');
  const discover = read('screens/DiscoverHubScreen.js');
  test('Home builds its card facts line through gatheringFactsLine (no inline count)', () => {
    expect(home).toMatch(/gatheringFactsLine\(\[card\.meta\], g, \{ language, reasons: card\.reasons \}\)/);
    expect(home).not.toMatch(/'reasons\.attendingCount'/);
  });
  test('every Discover gathering tile (compact, hero, standard, context, keyword list, Happening Now) uses it', () => {
    expect(discover).toMatch(/meta=\{gatheringFactsLine\(\[reasonLine, card\.meta, fullness\]/);
    expect(discover).toMatch(/gatheringFactsLine\(\[reasonLine, card\.meta\], g/);
    expect(discover).toMatch(/gatheringFactsLine\(\[card\.meta\], g, \{ language, maxChars: NOW_TILE_FACTS_MAX_CHARS \}\)/);
    expect((discover.match(/\{tileFactsLine\(g(, reasonLine)?\)\}/g) || []).length).toBe(3);
    expect(discover).not.toMatch(/\[gatheringSignalLine\(g\), gatheringFullnessLabel\(g\)\]\.filter\(Boolean\)\.join/);
  });
  test('Trending stays at five guests: the reason and badge keep their own gate', () => {
    expect(TRENDING_ATTENDANCE_MIN).toBe(5);
    expect(discover).toMatch(/attendeeCount >= TRENDING_ATTENDANCE_MIN \? reasonText\('attendingCount'/);
    expect(discover).toMatch(/attendeeTotal\(g\) >= TRENDING_ATTENDANCE_MIN \? 'TRENDING'/);
  });
});

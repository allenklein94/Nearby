// Item 188 follow-up (owner, 2026-10-04, LOCKED): a gathering's when line shows start–end ("Tonight · 7–10 PM") when the host
// chose a length; the display end = start + that length, presentation only. No length = start alone, nothing invented.
const fs = require('fs');
const path = require('path');
const { whenLabel, clockRange } = require('./timeContext');
const { gatheringWhen, gatheringDisplayEnd, timeWindowState } = require('./timeWindow');
const { localWhen, localWindow } = require('../i18n/format');
const { displayGatheringWhen, displayGatheringDateTime } = require('../i18n/display');
const { practicalFacts } = require('./gatheringPractical');
const { practicalFactsIn } = require('../i18n/gatheringFactsDisplay');
const { recommendationContext, contextItem } = require('./recommendationContext');

const ROOT = path.join(__dirname, '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const NOW = new Date(2026, 9, 4, 12, 0); // Sun Oct 4, noon local
const at = (d, h, m = 0) => new Date(2026, 9, d, h, m).toISOString();
const g = (start, duration) => ({ scheduled_at: start, duration_minutes: duration });

describe('the range', () => {
  it('owner examples: 7 PM + 3 hr, 6:30 PM + 1.5 hr, 7 PM + 30 min', () => {
    expect(gatheringWhen(g(at(4, 19), 180), NOW)).toBe('Tonight · 7–10 PM');
    expect(gatheringWhen(g(at(10, 18, 30), 90), NOW)).toMatch(/^Sat, Oct 10 · 6:30–8 PM$/);
    expect(gatheringWhen(g(at(4, 19), 30), NOW)).toBe('Tonight · 7–7:30 PM');
  });

  it('AM/PM is said once when shared, twice across noon or midnight', () => {
    expect(clockRange(new Date(2026, 9, 4, 11), new Date(2026, 9, 4, 13))).toBe('11 AM–1 PM');
    expect(gatheringWhen(g(at(5, 22), 180), NOW)).toBe('Tomorrow · 10 PM–1 AM');
    expect(gatheringWhen(g(at(4, 14), 120), NOW)).toBe('Today · 2–4 PM');
  });

  it('no length = start time only; nothing is manufactured', () => {
    expect(gatheringWhen(g(at(4, 19), null), NOW)).toBe('Tonight · 7 PM');
    expect(gatheringDisplayEnd(g(at(4, 19), null))).toBeNull();
    expect(whenLabel(at(4, 19), NOW)).toBe('Tonight · 7 PM');
  });

  it('while it runs: Happening now · until 10 PM, from the same calculation', () => {
    expect(gatheringWhen(g(at(4, 19), 180), new Date(2026, 9, 4, 20))).toBe('Happening now · until 10 PM');
    expect(gatheringDisplayEnd(g(at(4, 19), 180))).toBe(at(4, 22));
  });

  it('every surface reads the same line: cards (context object), plan rows, detail page', () => {
    const row = { id: 'x', title: 'Show', scheduled_at: at(4, 19), duration_minutes: 180 };
    const ctx = recommendationContext(contextItem('gathering', row), { now: NOW });
    expect(ctx.context).toContain('Tonight · 7–10 PM');
    expect(displayGatheringWhen(row, 'en', NOW)).toBe('Tonight · 7–10 PM');
    expect(displayGatheringDateTime(row, 'en')).toMatch(/7–10 PM$/);
    expect(displayGatheringDateTime({ scheduled_at: at(4, 19) }, 'en')).not.toMatch(/–/);
  });

  it('other languages word the same range (24-hour and leading day-part languages)', () => {
    const win = { start: at(4, 19), durationMinutes: 180 };
    expect(localWindow(win, NOW, 'event', 'de')).toBe('Heute Abend · 19 Uhr–22 Uhr');
    expect(localWindow(win, NOW, 'event', 'es')).toBe('Esta noche · 7–10 p. m.');
    expect(localWindow(win, NOW, 'event', 'zh')).toBe('今晚 · 下午7点–10点');
    expect(localWhen(at(4, 19), NOW, 'fr')).toBe('Ce soir · 19 h');
    expect(timeWindowState(win, NOW).label).toBe('Tonight · 7–10 PM');
  });
});

describe('"About 3 hr" is not shown beside the range', () => {
  it('a gathering with a start time drops the duration fact in every language', () => {
    expect(practicalFacts(g(at(4, 19), 180)).join(' ')).not.toMatch(/About/);
    expect(practicalFactsIn(g(at(4, 19), 180), 'de').join(' ')).not.toMatch(/⏱️/);
    expect(practicalFacts({ duration_minutes: 180 }).join(' ')).toMatch(/About 3 hr/); // no start: the length is all there is
  });
});

describe('presentation only', () => {
  it('no stored end, no data model change, no scheduling/ranking/notification code reads the display end', () => {
    const migrations = fs.readdirSync(path.join(ROOT, 'supabase/migrations'));
    for (const f of migrations) expect(read(`supabase/migrations/${f}`)).not.toMatch(/gatherings[\s\S]{0,80}add column[^;]*\b(end_time|ends_at|scheduled_end)\b/i);
    const users = [];
    const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).forEach((e) => {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p); else if (p.endsWith('.js') && !/\.test\.js$/.test(p) && /gatheringDisplayEnd/.test(fs.readFileSync(p, 'utf8'))) users.push(path.relative(ROOT, p));
    });
    walk(path.join(ROOT, 'src'));
    expect(users.sort()).toEqual(['src/i18n/display.js', 'src/utils/timeWindow.js']);
  });

  it('gathering time surfaces use the shared range helpers, never the start-only formatter', () => {
    for (const [f, bad] of [
      ['src/screens/HomeScreen.js', /displayHeroWhen\((plan|g)\.scheduled_at/],
      ['src/screens/PlansScreen.js', /displayHeroWhen\(g\.scheduled_at/],
      ['src/screens/GatheringDetailScreen.js', /displayDateTime\(gathering\.scheduled_at/],
      ['src/screens/BusinessProfileScreen.js', /displayDateTime\(g\.scheduled_at/],
      ['src/screens/CommunityDetailScreen.js', /formatDate\(g\.scheduled_at/],
    ]) expect(read(f)).not.toMatch(bad);
  });
});

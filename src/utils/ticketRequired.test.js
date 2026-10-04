// Owner item 188 (2026-10-04, LOCKED, option 1): "Ticket needed, bought separately" is a host-declared FACT only. Nearby sells no
// tickets, collects no money, links to no seller and holds no inventory; nothing about joining, capacity, the waitlist, ranking,
// routing, recommendations or business matching reads it.
const fs = require('fs');
const path = require('path');
const { practicalFacts } = require('./gatheringPractical');
const { practicalFactsIn } = require('../i18n/gatheringFactsDisplay');

const ROOT = path.join(__dirname, '..', '..');
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  const p = path.join(dir, e.name);
  return e.isDirectory() ? walk(p) : [p];
});
const LANGS = ['en', 'es', 'de', 'fr', 'pt', 'ht', 'zh', 'vi', 'tl', 'ru', 'ko'];

describe('item 188: ticket needed is a declared fact only', () => {
  it('shows only when the host turned it on', () => {
    expect(practicalFacts({ ticket_required: true })).toContain('🎟️ Ticket needed, bought separately');
    expect(practicalFacts({ ticket_required: false }).join(' ')).not.toMatch(/ticket/i);
    expect(practicalFacts({}).join(' ')).not.toMatch(/ticket/i);
  });

  it('is worded in all 11 languages', () => {
    for (const l of LANGS) {
      const facts = practicalFactsIn({ ticket_required: true }, l);
      expect(facts.some((f) => f.startsWith('🎟️ ') && f.length > 4 && !f.includes('fact.'))).toBe(true);
    }
  });

  it('only the gathering read/write path and its display touch it in app code', () => {
    const allowed = new Set([
      'src/services/gatherings.js', 'src/utils/gatheringPractical.js', 'src/i18n/gatheringFactsDisplay.js',
      'src/screens/CreateGatheringScreen.js', 'src/screens/EditGatheringScreen.js',
    ]);
    const hits = walk(path.join(ROOT, 'src'))
      .filter((p) => p.endsWith('.js') && !p.endsWith('.test.js') && !p.endsWith('.journey.js') && !p.includes(`${path.sep}i18n${path.sep}ui${path.sep}`))
      .map((p) => path.relative(ROOT, p).split(path.sep).join('/'))
      .filter((rel) => /ticket_required|ticketRequired/.test(fs.readFileSync(path.join(ROOT, rel), 'utf8')));
    expect(hits.filter((h) => !allowed.has(h))).toEqual([]);
  });

  it('no server function, policy, view or edge function reads it', () => {
    const migs = fs.readdirSync(path.join(ROOT, 'supabase/migrations'))
      .filter((f) => /ticket_required/.test(fs.readFileSync(path.join(ROOT, 'supabase/migrations', f), 'utf8')));
    expect(migs).toEqual(['20270282_gathering_ticket_required.sql']);
    const edge = walk(path.join(ROOT, 'supabase/functions')).filter((p) => /ticket_required/.test(fs.readFileSync(p, 'utf8')));
    expect(edge).toEqual([]);
    const sql = fs.readFileSync(path.join(ROOT, 'supabase/migrations/20270282_gathering_ticket_required.sql'), 'utf8');
    expect(sql).toMatch(/add column if not exists ticket_required boolean not null default false/);
    expect(sql).not.toMatch(/create (or replace )?(function|policy|view|trigger)/i);
  });

  it('the wording never sells, prices or links', () => {
    const src = fs.readFileSync(path.join(ROOT, 'src/i18n/ui/gatheringForm.js'), 'utf8') + fs.readFileSync(path.join(ROOT, 'src/i18n/ui/gatheringParts.js'), 'utf8');
    const lines = src.split('\n').filter((l) => /ticket/i.test(l));
    for (const l of lines) expect(l).not.toMatch(/https?:|\$|buy now|stripe/i);
  });
});

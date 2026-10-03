// Item 164 (owner, 2026-10-03, LOCKED): the business opportunity card says the customer's EXPLICIT requested timing, read only
// from the request's own stored day + start time. Flexible / no rush / no day = no line. Never a classification, score or search.
import fs from 'fs';
import path from 'path';
import { requestTimingLabel, buildOpportunityCard } from './businessOpportunityCard';
import { setCurrentLanguage } from '../i18n/translate';

const NOW = new Date(2026, 8, 30, 15, 0, 0); // Wednesday Sep 30, 3 PM local
const label = (r) => requestTimingLabel(r, NOW);

afterEach(() => setCurrentLanguage('en'));

describe('requestTimingLabel: the request\'s own day and time, nothing else', () => {
  it('today (an ASAP / now / today request is stored as today\'s date)', () => {
    expect(label({ date: '2026-09-30' })).toBe('Needs this today');
    expect(label({ date: '2026-09-30', time_window_start: '16:00:00' })).toBe('Needs this today at 4 PM');
  });
  it('tomorrow', () => {
    expect(label({ date: '2026-10-01' })).toBe('Needs this tomorrow');
    expect(label({ date: '2026-10-01', time_window_start: '19:30:00', time_window_end: '21:00:00' })).toBe('Needs this tomorrow at 7:30 PM');
  });
  it('a later explicit day, with or without a clock time', () => {
    expect(label({ date: '2026-10-09' })).toMatch(/^Needs this \S+, Oct 9$/);
    expect(label({ date: '2026-10-09', time_window_start: '18:00:00' })).toMatch(/^Needs this \S+, Oct 9 at 6 PM$/);
  });
  it('no line when the request is flexible / no rush (no day), has only a time, or its day has passed', () => {
    expect(label({ date: null })).toBeNull();
    expect(label({})).toBeNull();
    expect(label({ date: null, time_window_start: '16:00:00' })).toBeNull();
    expect(label({ date: '2026-09-29' })).toBeNull();
    expect(label(null)).toBeNull();
  });
  it('the card carries it beside the unchanged who/when line', () => {
    const card = buildOpportunityCard({ category: 'Coffee', party_size: 4, date: new Date().toISOString().slice(0, 10) }, {});
    expect(card.needsLine === null || /^Needs this /.test(card.needsLine)).toBe(true);
    expect(card.whenLine).toMatch(/^4 people · /);
    expect(buildOpportunityCard({ category: 'Coffee', party_size: 4, date: null }, {}).needsLine).toBeNull();
  });
  it('in the business\'s language', () => {
    setCurrentLanguage('es');
    expect(label({ date: '2026-09-30' })).toBe('Lo necesita hoy');
    expect(label({ date: '2026-10-01', time_window_start: '19:00:00' })).toMatch(/^Lo necesita mañana a las /);
  });
});

describe('boundaries (guards)', () => {
  const src = fs.readFileSync(path.join(__dirname, 'businessOpportunityCard.js'), 'utf8');
  const fn = src.slice(src.indexOf('export function requestTimingLabel'), src.indexOf('export function requestTimingLabel') + 900);
  it('reads only the request\'s date and start time: no classification, urgency level, score, search or learned signal', () => {
    expect(fn).not.toMatch(/ask_kind|askKind|spontaneity|urgency|score|raw_text|historyScore|learned|intent_submissions|submission/i);
    expect(fn).toMatch(/r\.date/);
    expect(fn).toMatch(/r\.time_window_start/);
  });
  it('nothing that routes or decides eligibility reads it', () => {
    const roots = ['services', 'constants', 'utils'].map((d) => path.join(__dirname, '..', d));
    const users = [];
    const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).forEach((e) => {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.js$/.test(e.name) && !/\.test\.js$/.test(e.name) && /requestTimingLabel|needsLine/.test(fs.readFileSync(p, 'utf8'))) users.push(path.basename(p));
    });
    roots.forEach(walk);
    expect(users).toEqual(['businessOpportunityCard.js']);
    const migrations = fs.readdirSync(path.join(__dirname, '../../supabase/migrations'));
    expect(migrations.some((m) => /needs_line|request_timing_label/.test(fs.readFileSync(path.join(__dirname, '../../supabase/migrations', m), 'utf8')))).toBe(false);
  });
});

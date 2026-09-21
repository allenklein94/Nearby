import { timeWindowState, windowEnd, gatheringWhen, ENDING_SOON_MIN } from './timeWindow';
import { validityLabel } from './offerMedia';

const at = (h, m = 0) => new Date(2026, 8, 21, h, m);
const iso = (d) => d.toISOString();

describe('one temporal engine (item 41)', () => {
  it('start + duration: upcoming, live with an end time, ending soon, over', () => {
    const win = { start: iso(at(19)), durationMinutes: 120 };
    expect(timeWindowState(win, at(17)).phase).toBe('upcoming');
    expect(timeWindowState(win, at(20)).label).toBe('Happening now · until 9 PM');
    const soon = timeWindowState(win, at(20, 40));
    expect(soon).toMatchObject({ phase: 'ending_soon', label: 'Ends in 20 min' });
    expect(timeWindowState(win, at(21, 5))).toMatchObject({ phase: 'over', label: 'Ended' });
  });
  it('end only (an offer): valid until, ending soon, expired', () => {
    const win = { end: iso(at(19)) };
    expect(timeWindowState(win, at(15), 'offer').label).toBe('Valid until 7 PM');
    expect(timeWindowState(win, at(18, 45), 'offer').label).toBe('Ends in 15 min');
    expect(timeWindowState(win, at(19, 1), 'offer')).toMatchObject({ phase: 'over', label: 'Expired' });
  });
  it('availability posting uses its own verb', () => {
    expect(timeWindowState({ end: iso(at(21)) }, at(18), 'availability').label).toBe('Available until 9 PM');
  });
  it('start only never claims the event is still going past the just-started rule', () => {
    const win = { start: iso(at(19)) };
    expect(timeWindowState(win, at(19, 20)).label).toBe('Happening now');
    expect(timeWindowState(win, at(21)).phase).toBe('over');
  });
  it('unknown or garbage times give no label, never a made-up one', () => {
    for (const w of [null, {}, { start: 'nope' }, { end: 'x' }]) expect(timeWindowState(w, at(12))).toEqual({ phase: 'unknown', label: null, minutesLeft: null });
    expect(windowEnd({ start: iso(at(19)), durationMinutes: 5 })).toBeNull();
    expect(gatheringWhen({})).toBeNull();
  });
  it('the offer label everyone already uses is this engine, contract unchanged', () => {
    expect(validityLabel(iso(at(19)), at(15))).toBe('Valid until 7 PM');
    expect(validityLabel(iso(at(19)), at(20))).toBe('expired');
    expect(validityLabel(null)).toBeNull();
    expect(ENDING_SOON_MIN).toBe(30);
  });
  it('a gathering with a declared duration reads through the same engine', () => {
    expect(gatheringWhen({ scheduled_at: iso(at(19)), duration_minutes: 120 }, at(20))).toBe('Happening now · until 9 PM');
    expect(gatheringWhen({ scheduled_at: iso(at(19)) }, at(21))).toBeNull();
  });
  it('no surface builds its own "Valid until" / "Ends in" wording', () => {
    const fs = require('fs'), path = require('path');
    const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
    const bad = walk(path.join(__dirname, '..')).filter((f) => /\.js$/.test(f) && !/\.test\.js$/.test(f) && !/timeWindow\.js$/.test(f) && !/i18n/.test(f))
      .filter((f) => /`(Valid|Available) until \$\{|`Ends in \$\{/.test(fs.readFileSync(f, 'utf8')));
    expect(bad).toEqual([]);
  });
});

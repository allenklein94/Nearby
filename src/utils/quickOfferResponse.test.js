import { STANDARD_AVAILABILITY_TEXT, buildAlternativeText, alternativePickerStart } from './quickOfferResponse';

describe('quickOfferResponse', () => {
  it('standard availability text is fixed and non-empty (the server requires a description)', () => {
    expect(STANDARD_AVAILABILITY_TEXT.length).toBeGreaterThan(0);
  });
  it('alternative text is always non-empty and appends an optional note', () => {
    expect(buildAlternativeText('')).toMatch(/instead\.$/);
    expect(buildAlternativeText(null)).toMatch(/instead\.$/);
    expect(buildAlternativeText('  We can seat you at the bar.  ')).toMatch(/instead\. We can seat you at the bar\.$/);
    expect(buildAlternativeText('x'.repeat(2000)).length).toBe(1000);
  });
  it('picker opens on the requested date/time when it is in the future, else now', () => {
    const now = new Date(2026, 8, 20, 10, 0);
    const start = alternativePickerStart({ date: '2026-09-25', time_window_start: '19:30:00' }, now);
    expect(start.getFullYear()).toBe(2026);
    expect(start.getMonth()).toBe(8);
    expect(start.getDate()).toBe(25);
    expect(start.getHours()).toBe(19);
    expect(start.getMinutes()).toBe(30);
    expect(alternativePickerStart({ date: '2026-09-01' }, now)).toBe(now);
    expect(alternativePickerStart(null, now)).toBe(now);
  });
});

import { STANDARD_AVAILABILITY_TEXT, buildAlternativeText, alternativePickerStart, usualTermsLine, standardAvailabilityText } from './quickOfferResponse';

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

  describe('usual terms preset', () => {
    it('is just the fixed line when there is no policy or no sendable terms', () => {
      expect(standardAvailabilityText(null)).toBe(STANDARD_AVAILABILITY_TEXT);
      expect(standardAvailabilityText({})).toBe(STANDARD_AVAILABILITY_TEXT);
      expect(usualTermsLine({ min_spend_per_person: 0, cancellation_window_hours: 0 })).toBeNull();
    });
    it("includes the owner's own minimum spend and cancellation window", () => {
      expect(usualTermsLine({ min_spend_per_person: '40.00', cancellation_window_hours: 24 }))
        .toBe('Our usual terms: $40 per person minimum spend; cancellation window: 24 hours.');
      expect(standardAvailabilityText({ min_spend_per_person: 35.5 }))
        .toBe(`${STANDARD_AVAILABILITY_TEXT} Our usual terms: $35.50 per person minimum spend.`);
      expect(usualTermsLine({ cancellation_window_hours: 1 })).toBe('Our usual terms: cancellation window: 1 hour.');
    });
    it('never sends the deposit (not charged) or the discount ceiling (not an offer)', () => {
      const text = standardAvailabilityText({ deposit_amount: 50, max_discount_pct: 20, min_spend_per_person: 40 });
      expect(text).not.toMatch(/deposit|discount|50|20%/i);
      expect(text).toMatch(/\$40/);
    });
  });
});

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
    it('includes the deposit, worded as arranged directly (Nearby does not collect it)', () => {
      expect(usualTermsLine({ deposit_amount: '50.00' })).toBe('Our usual terms: $50 deposit, arranged directly with us.');
      expect(usualTermsLine({ min_spend_per_person: 40, deposit_amount: 25, cancellation_window_hours: 24 }))
        .toBe('Our usual terms: $40 per person minimum spend; $25 deposit, arranged directly with us; cancellation window: 24 hours.');
      expect(usualTermsLine({ deposit_amount: 0 })).toBeNull();
    });
    it('never sends the discount ceiling (it is not an offer)', () => {
      const text = standardAvailabilityText({ max_discount_pct: 20, min_spend_per_person: 40 });
      expect(text).not.toMatch(/discount|20%/i);
      expect(text).toMatch(/\$40/);
    });
  });
});

describe('requestedWindowDefaults (one-tap Standard availability prefill)', () => {
  const { requestedWindowDefaults } = require('./quickOfferResponse');
  const { availableWindowFromChoice, availableWindowLabel } = require('./offerMedia');
  it('prefills only a complete, ordered requested window', () => {
    const w = requestedWindowDefaults({ time_window_start: '18:00:00', time_window_end: '20:00:00' });
    expect(availableWindowFromChoice(w.from, w.until)).toEqual({ from: '18:00', until: '20:00' });
    expect(availableWindowLabel('18:00', '20:00')).toBe('Available 6–8 PM');
  });
  it('a request with a start only, nothing, or a backwards window gets no window', () => {
    expect(requestedWindowDefaults({ time_window_start: '18:00:00' })).toEqual({ from: null, until: null });
    expect(requestedWindowDefaults({})).toEqual({ from: null, until: null });
    expect(requestedWindowDefaults(null)).toEqual({ from: null, until: null });
    expect(requestedWindowDefaults({ time_window_start: '20:00:00', time_window_end: '18:00:00' })).toEqual({ from: null, until: null });
  });
  it('the sheet sends the window with the fixed text (structured, so the AI-free path is unchanged)', () => {
    const fs = require('fs');
    const src = fs.readFileSync(require('path').join(__dirname, '../screens/BusinessDashboardScreen.js'), 'utf8');
    expect(src).toMatch(/offerType: 'standard', offerDescription: standardAvailabilityText\(fulfillmentPolicy\), availableFrom: win\.from, availableUntil: win\.until/);
  });
});

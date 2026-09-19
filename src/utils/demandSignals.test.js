import { describeDemandSignal, describeDemandSignals, partyBucketLabel } from './demandSignals';

describe('describeDemandSignal', () => {
  it('describes a category signal with party size and budget from real values', () => {
    const d = describeDemandSignal({ kind: 'category', category: 'Foodie', people_count: 14, party_bucket: '5-6', budget_low: 40, budget_high: 60 });
    expect(d.headline).toBe('Foodie for 5–6 people is being searched nearby');
    expect(d.detail).toBe('Budget $40–$60 · 14 people · last 14 days');
    expect(d.action).toEqual({ type: 'availability', category: 'Foodie' });
  });

  it('omits party and budget when the server sent none (never invents them)', () => {
    const d = describeDemandSignal({ kind: 'category', category: 'Coffee', people_count: 5, party_bucket: null, budget_low: null, budget_high: null });
    expect(d.headline).toBe('Coffee is being searched nearby');
    expect(d.detail).toBe('5 people · last 14 days');
  });

  it('maps an occasion signal to the package flow', () => {
    const d = describeDemandSignal({ kind: 'occasion', occasion: 'birthday', people_count: 8 });
    expect(d.headline).toMatch(/plans are being requested nearby/);
    expect(d.action).toEqual({ type: 'package', occasion: 'birthday' });
  });

  it('never renders a signal under the privacy floor, even if the server sent one', () => {
    expect(describeDemandSignal({ kind: 'category', category: 'Foodie', people_count: 2 })).toBeNull();
    expect(describeDemandSignal({ kind: 'category', category: 'Foodie', people_count: 0 })).toBeNull();
    expect(describeDemandSignal({ kind: 'category', category: 'Foodie' })).toBeNull();
  });

  it('honors the server-provided minimum and window', () => {
    const out = describeDemandSignals({ min_people: 10, window_days: 7, signals: [
      { kind: 'category', category: 'Foodie', people_count: 9 },
      { kind: 'category', category: 'Coffee', people_count: 10 },
    ] });
    expect(out).toHaveLength(1);
    expect(out[0].detail).toBe('10 people · last 7 days');
  });

  it('returns an empty list for an empty or missing payload', () => {
    expect(describeDemandSignals({ signals: [] })).toEqual([]);
    expect(describeDemandSignals(null)).toEqual([]);
    expect(partyBucketLabel('nope')).toBeNull();
  });
});

describe('unfulfilled demand on category rows', () => {
  const base = { kind: 'category', category: 'Dinner', people_count: 14, party_bucket: '7+' };
  it('adds the waiting + supply line only when the server returned a floored count', () => {
    const d = describeDemandSignal({ ...base, unfulfilled_count: 12, supply_count: 2 });
    expect(d.detail).toMatch(/12 still waiting for an offer · 2 businesses offer this nearby/);
    expect(describeDemandSignal({ ...base, unfulfilled_count: null, supply_count: null }).detail).not.toMatch(/waiting/);
  });
  it('never shows a sub-floor waiting count or a supply count without one', () => {
    expect(describeDemandSignal({ ...base, unfulfilled_count: 3, supply_count: 2 }).detail).not.toMatch(/waiting|offer this/);
    expect(describeDemandSignal({ ...base, unfulfilled_count: null, supply_count: 2 }).detail).not.toMatch(/offer this/);
  });
  it('says "business offers" for a single one', () => {
    expect(describeDemandSignal({ ...base, unfulfilled_count: 9, supply_count: 1 }).detail).toMatch(/1 business offers this nearby/);
  });
});

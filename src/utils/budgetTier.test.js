import { budgetTier, isValidBudget, partyBudgetTotal, formatBudgetLine, budgetMeetsMinSpend } from './budgetTier';
import { BUDGET_LEVEL_OPTIONS, resolveBudgetMax } from '../services/celebrateSomething';
import { buildOpportunityCard, buildMatchReasons } from './businessOpportunityCard';

describe('budgetTier (budget_max is per person)', () => {
  it.each([
    [null, null], [undefined, null], [-1, null], [0, null],
    [0.01, '$'], [25, '$'], [25.0, '$'], [25.01, '$$'], [26, '$$'], [75, '$$'], [75.01, '$$$'], [76, '$$$'], [500, '$$$'],
  ])('%p -> %p', (input, tier) => expect(budgetTier(input)).toBe(tier));

  it('validates: null ok, positive ok, zero/negative/NaN rejected', () => {
    expect(isValidBudget(null)).toBe(true);
    expect(isValidBudget(0.01)).toBe(true);
    expect(isValidBudget(0)).toBe(false);
    expect(isValidBudget(-1)).toBe(false);
    expect(isValidBudget(NaN)).toBe(false);
  });

  it('the consumer $/$$/$$$ chips map to their own tier (one vocabulary, same result everywhere)', () => {
    BUDGET_LEVEL_OPTIONS.filter((o) => o.max != null).forEach((o) => expect(budgetTier(o.max)).toBe(o.key));
  });
  it('typed override of zero/negative never becomes a budget', () => {
    expect(resolveBudgetMax('any', '0')).toBeNull();
    expect(resolveBudgetMax('any', '-5')).toBeNull();
    expect(resolveBudgetMax('$$', '0')).toBe(60); // falls back to the chip the person picked, never $0
  });
});

describe('party total and display', () => {
  it('is strictly budget_max x party_size, only when both are real', () => {
    expect(partyBudgetTotal(60, 6)).toBe(360);
    expect(partyBudgetTotal(60, null)).toBeNull();
    expect(partyBudgetTotal(null, 6)).toBeNull();
    expect(partyBudgetTotal(60, 0)).toBeNull();
    expect(partyBudgetTotal(25.5, 4)).toBe(102);
  });
  it('formats the unit-explicit line', () => {
    expect(formatBudgetLine(60, 6)).toBe('Up to $60/person · $360 for the party · $$');
    expect(formatBudgetLine(60, null)).toBe('Up to $60/person · $$');
    expect(formatBudgetLine(null, 6)).toBeNull();
    expect(formatBudgetLine(0, 6)).toBeNull();
  });
  it('the tier ignores party size', () => {
    expect(formatBudgetLine(25, 20).endsWith('· $')).toBe(true);
    expect(formatBudgetLine(76, 1).endsWith('· $$$')).toBe(true);
  });
  it('the business card uses it', () => {
    const card = buildOpportunityCard({ budget_max: 60, party_size: 6 }, { experienceLabel: 'Special' });
    expect(card.feelLine).toBe('Special · Up to $60/person · $360 for the party · $$');
    expect(buildOpportunityCard({ budget_max: 0 }, {}).feelLine).toBe('');
  });
});

describe('min spend comparison is per person on both sides', () => {
  it('ignores party size', () => {
    expect(budgetMeetsMinSpend(60, 50)).toBe(true);
    expect(budgetMeetsMinSpend(50, 50)).toBe(true);
    expect(budgetMeetsMinSpend(49, 50)).toBe(false);
    expect(budgetMeetsMinSpend(null, 50)).toBe(false);
    expect(budgetMeetsMinSpend(60, null)).toBe(false);
    expect(budgetMeetsMinSpend(0, 50)).toBe(false);
  });
  it('adds the price-fit line only when it holds', () => {
    expect(buildMatchReasons([{ key: 'cuisine' }], { priceFits: true })).toContain('Their budget fits your price range');
    expect(buildMatchReasons([{ key: 'cuisine' }])).not.toContain('Their budget fits your price range');
  });
});

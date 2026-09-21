import { orderByBudget, budgetFit, askedPriceRank, priceChipLabel } from './experienceBudget';

const g = (id, priceLevel) => ({ id, priceLevel });
describe('experienceBudget', () => {
  it('no stated budget changes nothing', () => {
    const items = [g('a', '$$$'), g('b', '$')];
    expect(orderByBudget(items, {})).toBe(items);
  });
  it('cheap ask sinks known-over-budget items, keeps unknown in place, hides nothing', () => {
    const items = [g('a', '$$$'), g('b', null), g('c', '$'), g('d', 'free')];
    expect(orderByBudget(items, { priceLevel: '$' }).map((i) => i.id)).toEqual(['c', 'd', 'b', 'a']);
  });
  it('budgetMax maps through the per-person tier', () => {
    expect(askedPriceRank({ budgetMax: 20 })).toBe(1);
    expect(budgetFit(g('a', '$$'), { budgetMax: 20 })).toBe(2);
    expect(budgetFit(g('a', '$$'), { budgetMax: 60 })).toBe(0);
  });
  it('chip only for a real price', () => {
    expect(priceChipLabel(g('a', null))).toBeNull();
    expect(priceChipLabel(g('a', 'free'))).toBe('Free');
  });
});

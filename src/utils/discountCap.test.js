import { activeDiscountCap, parseDiscountPct, discountCapProblem } from './discountCap';

describe('activeDiscountCap', () => {
  it('reads the cap from an active policy', () => expect(activeDiscountCap({ active: true, max_discount_pct: '15.00' })).toBe(15));
  it('null cap / no policy / paused policy = no limit', () => {
    expect(activeDiscountCap({ active: true, max_discount_pct: null })).toBeNull();
    expect(activeDiscountCap(null)).toBeNull();
    expect(activeDiscountCap({ active: false, max_discount_pct: 15 })).toBeNull();
  });
});

describe('discountCapProblem', () => {
  it('at the cap -> allowed', () => expect(discountCapProblem({ offerType: 'discount', pctInput: '15', cap: 15 })).toBeNull());
  it('below the cap -> allowed', () => expect(discountCapProblem({ offerType: 'discount', pctInput: '10', cap: 15 })).toBeNull());
  it('above the cap -> refused', () => expect(discountCapProblem({ offerType: 'discount', pctInput: '15.5', cap: 15 })).toMatch(/above your maximum discount of 15%/));
  it('any offer type stating a discount is capped', () => expect(discountCapProblem({ offerType: 'perk', pctInput: '40', cap: 15 })).toMatch(/above/));
  it('discount type with no percentage is refused while a cap is set', () => expect(discountCapProblem({ offerType: 'discount', pctInput: '', cap: 15 })).toMatch(/Enter the discount percentage/));
  it('non-discount type with no percentage is fine', () => expect(discountCapProblem({ offerType: 'standard', pctInput: '', cap: 15 })).toBeNull());
  it('null cap follows existing behavior: no limit, no required percentage', () => {
    expect(discountCapProblem({ offerType: 'discount', pctInput: '90', cap: null })).toBeNull();
    expect(discountCapProblem({ offerType: 'discount', pctInput: '', cap: null })).toBeNull();
  });
  it('rejects out-of-range percentages', () => expect(discountCapProblem({ offerType: 'discount', pctInput: '120', cap: null })).toMatch(/between 0 and 100/));
  it('parseDiscountPct ignores blanks/garbage', () => {
    expect(parseDiscountPct('')).toBeNull();
    expect(parseDiscountPct('abc')).toBeNull();
  });
});

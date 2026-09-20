import { categoryOutcomeLine, categoryRatingLine, memberCountLabel, offerPriceLabel } from './outcomeDisplay';

test('an unknown rate is omitted, not printed as 0%', () => {
  expect(categoryOutcomeLine({ total_opportunities: 4, acceptance_rate: 50, completion_rate: null })).toBe('4 opportunities · 50% accepted');
  expect(categoryOutcomeLine({ total_opportunities: 1, acceptance_rate: null, completion_rate: null })).toBe('1 opportunity');
  expect(categoryOutcomeLine({ total_opportunities: 3, acceptance_rate: 0, completion_rate: 0 })).toBe('3 opportunities · 0% accepted · 0% completed');
  expect(categoryRatingLine({ pct_satisfied: null, pct_would_repeat: null })).toBeNull();
  expect(categoryRatingLine({ pct_satisfied: 80, pct_would_repeat: null })).toBe('⭐ 80% satisfied');
});
test('member count is unknown until loaded, and singular is correct', () => {
  expect(memberCountLabel(undefined)).toBeNull();
  expect(memberCountLabel(null)).toBeNull();
  expect(memberCountLabel(0)).toBe('0 members');
  expect(memberCountLabel(1)).toBe('1 member');
  expect(memberCountLabel(2)).toBe('2 members');
});
test('offer price never renders NaN or an invented zero', () => {
  expect(offerPriceLabel(null)).toBeNull();
  expect(offerPriceLabel(undefined)).toBeNull();
  expect(offerPriceLabel('abc')).toBeNull();
  expect(offerPriceLabel(45, true)).toBe('$45.00/person');
  expect(offerPriceLabel(0)).toBe('$0.00');
});

test('moneyLabel: whole dollars plain, cents to two places, unknown is a dash', () => {
  const { moneyLabel, moneyNumber } = require('./outcomeDisplay');
  expect(moneyLabel(45)).toBe('$45');
  expect(moneyLabel('45')).toBe('$45');
  expect(moneyLabel(12.5)).toBe('$12.50');
  expect(moneyLabel(0.1 + 0.2)).toBe('$0.30');
  expect(moneyLabel(0)).toBe('$0');
  expect(moneyLabel(null)).toBe('—');
  expect(moneyLabel(undefined)).toBe('—');
  expect(moneyLabel('abc')).toBe('—');
  expect(moneyNumber(50)).toBe('50');
});

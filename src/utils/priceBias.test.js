import { applyBusinessPriceToCandidates } from './priceBias';
import { businessPriceFits, businessPriceLine, typicalSpendProblem, BUSINESS_PRICE_LEVELS } from '../constants/businessPrice';
import { priceLevelFromText } from './askResolver';

const c = (partnerId, score = 1) => ({ partnerId, score });
const price = new Map([
  ['cheap', { level: '$', spend: 12 }],
  ['mid', { level: '$$', spend: null }],
  ['fancy', { level: '$$$$', spend: 90 }],
  ['spendOnly', { level: null, spend: 28 }],
]);

describe('business price (items 40 + 82)', () => {
  it('Cheap / Moderate / Special occasion are the words; special occasion fits $$$ and $$$$', () => {
    expect(priceLevelFromText('somewhere cheap tonight')).toBe('$');
    expect(priceLevelFromText('a moderate dinner')).toBe('$$');
    expect(priceLevelFromText('dinner for a special occasion')).toBe('$$$');
    expect(priceLevelFromText('something not too expensive')).toBe(null);
    expect(priceLevelFromText('nothing fancy')).toBe(null);
    expect(businessPriceFits('$$$', '$$$$')).toBe(true);
    expect(businessPriceFits('$$$', '$$$')).toBe(true);
    expect(businessPriceFits('$', '$$')).toBe(false);
    expect(businessPriceFits('free', '$')).toBe(false);
  });
  it('a fitting tier ranks up; everything stays', () => {
    const out = applyBusinessPriceToCandidates([c('cheap'), c('mid'), c('fancy'), c('z')], price, { priceLevel: '$$$' }, 2);
    expect(out.map((x) => x.score)).toEqual([1, 1, 3, 1]);
  });
  it('typical spend vs a stated budget: fits up, clearly over down, a little over neutral, unknown untouched', () => {
    const out = applyBusinessPriceToCandidates([c('cheap'), c('spendOnly'), c('fancy'), c('mid')], price, { budgetMax: 25 }, 2);
    expect(out.map((x) => x.score)).toEqual([3, 1, -1, 1]); // 12 fits, 28 within 25%, 90 over, no spend
  });
  it('"not too expensive" sinks $$$/$$$$ only', () => {
    const out = applyBusinessPriceToCandidates([c('fancy'), c('mid')], price, { pricey: true }, 2);
    expect(out.map((x) => x.score)).toEqual([-1, 1]);
  });
  it('no price ask, or no data, changes nothing', () => {
    const list = [c('cheap')];
    expect(applyBusinessPriceToCandidates(list, price, {}, 2)).toBe(list);
    expect(applyBusinessPriceToCandidates(list, null, { priceLevel: '$' }, 2)).toBe(list);
  });
  it('profile line shows only what the owner said; spend is validated as whole dollars', () => {
    expect(businessPriceLine('$$', 25)).toBe('$$ · Typically about $25 per person');
    expect(businessPriceLine('$$$$', null)).toBe('$$$$');
    expect(businessPriceLine(null, 40)).toBe('Typically about $40 per person');
    expect(businessPriceLine(null, null)).toBe(null);
    expect(typicalSpendProblem('')).toBe(null);
    expect(typicalSpendProblem('25')).toBe(null);
    expect(typicalSpendProblem('0')).toMatch(/between/);
    expect(typicalSpendProblem('1001')).toMatch(/between/);
  });
  it('wiring: one business vocabulary in the migration, the resolver nudges on a tier, a budget or "not too expensive"', () => {
    const fs = require('fs'), path = require('path');
    const sql = fs.readFileSync(path.join(__dirname, '../../supabase/migrations/20270218_business_price_tier_typical_spend.sql'), 'utf8');
    expect(sql).toMatch(/price_level in \('\$', '\$\$', '\$\$\$', '\$\$\$\$'\)/);
    expect(BUSINESS_PRICE_LEVELS).toEqual(['$', '$$', '$$$', '$$$$']);
    const r = fs.readFileSync(path.join(__dirname, '../services/intentResolver.js'), 'utf8');
    expect(r).toMatch(/if \(priceLevel \|\| budgetMax \|\| askPricey\) \{[\s\S]*applyBusinessPriceToCandidates/);
    // gatherings keep their own list (no $$$$ there)
    const { EXPERIENCE_PRICE_OPTIONS } = require('../constants/businessAttributes');
    expect(EXPERIENCE_PRICE_OPTIONS.map((o) => o.key).filter(Boolean)).toEqual(['free', '$', '$$', '$$$']);
    const { BUDGET_LEVEL_OPTIONS } = require('../services/celebrateSomething');
    expect(BUDGET_LEVEL_OPTIONS.map((o) => o.label)).toEqual(['No preference', 'Cheap · $', 'Moderate · $$', 'Special occasion · $$$']);
  });
});

import { applyBusinessPriceToCandidates } from './priceBias';

const c = (partnerId, score = 1) => ({ partnerId, score });
const levels = new Map([['a', 'free'], ['b', '$$']]);

describe('business price level ranking (item 40)', () => {
  it('lifts a business that declared the asked tier, never hides the rest', () => {
    const out = applyBusinessPriceToCandidates([c('a'), c('b'), c('z')], levels, 'free', 2);
    expect(out.map((x) => x.score)).toEqual([3, 1, 1]);
    expect(out).toHaveLength(3);
  });
  it('no price in the ask, or no declared level, changes nothing', () => {
    const list = [c('a'), c('z')];
    expect(applyBusinessPriceToCandidates(list, levels, null, 2)).toBe(list);
    expect(applyBusinessPriceToCandidates(list, null, 'free', 2)).toBe(list);
    expect(applyBusinessPriceToCandidates([c('z')], levels, 'free', 2)[0].score).toBe(1);
  });
  it('wiring: owner setter is a fixed vocabulary, resolver nudges only when priceLevel is asked', () => {
    const fs = require('fs'), path = require('path');
    const sql = fs.readFileSync(path.join(__dirname, '../../supabase/migrations/20270192_business_price_level.sql'), 'utf8');
    expect(sql).toMatch(/'free', '\$', '\$\$', '\$\$\$'/);
    const r = fs.readFileSync(path.join(__dirname, '../services/intentResolver.js'), 'utf8');
    expect(r).toMatch(/if \(priceLevel\) \{[\s\S]*applyBusinessPriceToCandidates/);
    const { EXPERIENCE_PRICE_OPTIONS } = require('../constants/businessAttributes');
    expect(EXPERIENCE_PRICE_OPTIONS.map((o) => o.key).filter(Boolean)).toEqual(['free', '$', '$$', '$$$']);
  });
});

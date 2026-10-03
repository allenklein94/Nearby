// The canonical ranking framework (constants/signalPriority.js). One ladder, one comparator; each surface keeps its own
// eligibility and presentation. See PRODUCT_AUDIT/UNIFIED_RANKING_FRAMEWORK_2026-09-27.md for the migration plan.
import fs from 'fs';
import path from 'path';
import {
  SIGNAL_TIERS, TIER_COUNT, tierVector, compareTierVectors, compareRanked, TYPED_ASK_SIGNAL_TIER, typedAskRankVector,
} from './signalPriority';
import { SIGNAL_CODES, UNRECORDED_PASSES } from '../utils/typedAskAudit';

const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

describe('tier vectors', () => {
  it('ten tiers in the owner order', () => {
    expect(Object.entries(SIGNAL_TIERS).sort((a, b) => a[1] - b[1]).map(([k]) => k)).toEqual(
      ['intent', 'constraint', 'planFriend', 'availability', 'time', 'interest', 'business', 'weather', 'popularity', 'discovery']);
    expect(TIER_COUNT).toBe(10);
  });
  it('sums points per tier; unknown tier counts as discovery; zero and junk ignored', () => {
    expect(tierVector([{ tier: 1, delta: 2 }, { tier: 1, delta: 1 }, { tier: 6, delta: 5 }, { tier: 99, delta: 1 }, { tier: 3, delta: 0 }, { tier: 2, delta: 'x' }]))
      .toEqual([3, 0, 0, 0, 0, 5, 0, 0, 0, 1]);
  });
  it('a stronger tier beats any amount of weaker ones; negatives in a tier count', () => {
    expect(compareTierVectors(tierVector([{ tier: 2, delta: 1 }]), tierVector([{ tier: 3, delta: 100 }, { tier: 4, delta: 100 }]))).toBeLessThan(0);
    expect(compareTierVectors(tierVector([{ tier: 1, delta: -1 }]), tierVector([]))).toBeGreaterThan(0);
    expect(compareTierVectors(tierVector([]), tierVector([]))).toBe(0);
  });
  it('compareRanked uses vectors when both have one, else plain score', () => {
    const a = { score: 1, rankVector: tierVector([{ tier: 1, delta: 1 }]) };
    const b = { score: 50, rankVector: tierVector([{ tier: 6, delta: 50 }]) };
    expect([b, a].sort(compareRanked)).toEqual([a, b]);
    expect([{ score: 1 }, { score: 3 }].sort(compareRanked).map((x) => x.score)).toEqual([3, 1]);
  });
});

describe('typed search signals each have exactly one tier', () => {
  it('every code the resolver can score with (audit codes + unrecorded passes) is placed', () => {
    for (const code of [...Object.keys(SIGNAL_CODES), ...UNRECORDED_PASSES]) expect(TYPED_ASK_SIGNAL_TIER[code]).toBeDefined();
  });
  it('the owner-stated anchors', () => {
    expect(TYPED_ASK_SIGNAL_TIER.base_category_match).toBe(SIGNAL_TIERS.intent);
    expect(TYPED_ASK_SIGNAL_TIER.dietary).toBe(SIGNAL_TIERS.constraint);
    expect(TYPED_ASK_SIGNAL_TIER.base_own_network).toBe(SIGNAL_TIERS.planFriend);
    expect(TYPED_ASK_SIGNAL_TIER.base_availability).toBe(SIGNAL_TIERS.availability);
    expect(TYPED_ASK_SIGNAL_TIER.base_today).toBe(SIGNAL_TIERS.time);
    expect(TYPED_ASK_SIGNAL_TIER.base_interest_match).toBe(SIGNAL_TIERS.interest);
    expect(TYPED_ASK_SIGNAL_TIER.base_occasion_offering).toBe(SIGNAL_TIERS.business);
    expect(TYPED_ASK_SIGNAL_TIER.weather).toBe(SIGNAL_TIERS.weather);
    expect(TYPED_ASK_SIGNAL_TIER.base_close_distance).toBe(SIGNAL_TIERS.discovery);
  });
  it('typedAskRankVector maps codes through the table', () => {
    expect(typedAskRankVector([{ code: 'genre', delta: 2 }, { code: 'weather', delta: -2 }, { code: 'mystery', delta: 1 }]))
      .toEqual([2, 0, 0, 0, 0, 0, 0, -2, 0, 1]);
  });
});

describe('typed search has one ordering, not several', () => {
  it('the resolver and every place that re-orders its results use compareRanked, never a bare score sort', () => {
    for (const f of ['services/intentResolver.js', 'services/surpriseMeLogic.js', 'services/experienceAssembly.js', 'services/celebrateSomething.js']) {
      const src = read(f);
      expect(src).toMatch(/compareRanked/);
      expect(src).not.toMatch(/\.sort\(\(a, b\) => \(?b\.score/);
    }
  });
  it('the ranking ledger is separate from the audit trace (the audit can never change an order)', () => {
    const src = read('services/intentResolver.js');
    expect(src).toMatch(/ledger = createRankLedger\(deduped\)/);
    expect(src).toMatch(/deduped\.sort\(\(a, b\) => compareRanked\(a, b\) \|\| compareLearnedTieBreak\(a, b\)\)/);
  });
});

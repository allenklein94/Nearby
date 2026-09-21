import { ENERGY_LEVELS, TAG_ENERGY, energiesFromText, energyFit, applyEnergyToCandidates } from './energyLevel';
import { groupForTag } from './gatheringCategories';
import { openEndedAskGroups } from '../utils/openEndedAsk';

describe('energy level (item 44)', () => {
  it('every mapped tag is a real canonical tag and every energy key is known', () => {
    const keys = ENERGY_LEVELS.map((e) => e.key);
    for (const [tag, es] of Object.entries(TAG_ENERGY)) {
      expect(groupForTag(tag)).toBeTruthy();
      es.forEach((k) => expect(keys).toContain(k));
    }
  });
  it('reads energy from the ask deterministically', () => {
    expect(energiesFromText('I want something low-key tonight')).toEqual(['low_key']);
    expect(energiesFromText('somewhere lively')).toEqual(['high_energy']);
    expect(energiesFromText('a romantic dinner')).toEqual(['romantic']);
    expect(energiesFromText('coffee tonight')).toEqual([]);
    expect(energiesFromText(null)).toEqual([]);
  });
  it('lifts a fit, sinks a clear opposite, leaves unknown tags alone', () => {
    expect(energyFit('Coffee', ['low_key']).delta).toBe(2);
    expect(energyFit('Coffee', ['low_key']).reason).toBe('Fits a low-key plan');
    expect(energyFit('Nightclubs', ['low_key']).delta).toBe(-1);
    expect(energyFit('Music', ['low_key'])).toEqual({ delta: 0, reason: null });
    expect(energyFit(null, ['low_key']).delta).toBe(0);
  });
  it('ranks only: never removes, no ask = same array', () => {
    const list = [{ category: 'Nightclubs', score: 3 }, { category: 'Coffee', score: 1 }, { category: null, score: 1 }];
    expect(applyEnergyToCandidates(list, [])).toBe(list);
    const out = applyEnergyToCandidates(list, ['low_key']);
    expect(out).toHaveLength(3);
    expect(out.map((c) => c.score)).toEqual([2, 3, 1]);
  });
  it('an energy-only ask counts as open-ended (no category named)', () => {
    expect(Array.isArray(openEndedAskGroups({ rawText: 'something chill tonight' }))).toBe(true);
    expect(openEndedAskGroups({ category: 'Coffee', rawText: 'chill coffee' })).toBeNull();
  });
});

import { buildMatchReasons } from './businessOpportunityCard';
import { scoreBusinessOpportunity } from '../services/businessOpportunityScoring';

describe('buildMatchReasons', () => {
  it('builds trust lines from real scoring reasons plus the area line', () => {
    const { reasons } = scoreBusinessOpportunity({
      requestOccasion: 'anniversary',
      businessOfferedOccasions: ['anniversary'],
      requestCuisine: 'italian',
      businessCuisine: 'italian',
    });
    const lines = buildMatchReasons(reasons, { occasionPhrase: 'anniversary experiences' });
    expect(lines).toEqual([
      'You offer anniversary experiences',
      'It matches your cuisine',
      'You are within the area they asked for',
    ]);
  });
  it('never claims price or availability', () => {
    const { reasons } = scoreBusinessOpportunity({ requestBudgetMax: 200, requestOccasion: 'birthday', businessOfferedOccasions: ['birthday'] });
    const text = buildMatchReasons(reasons).join(' ').toLowerCase();
    expect(text).not.toMatch(/price|budget|availab/);
  });
  it('returns nothing when no real signal fired (card falls back to New opportunity)', () => {
    const { reasons } = scoreBusinessOpportunity({ requestOccasion: 'birthday' });
    expect(buildMatchReasons(reasons)).toEqual([]);
  });
});

import { buildMatchReasons, availabilityCoversRequest } from './businessOpportunityCard';
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
  it('never claims price, and availability only when told a posting covers it', () => {
    const { reasons } = scoreBusinessOpportunity({ requestBudgetMax: 200, requestOccasion: 'birthday', businessOfferedOccasions: ['birthday'] });
    const text = buildMatchReasons(reasons).join(' ').toLowerCase();
    expect(text).not.toMatch(/price|budget|availab/);
  });
  it('returns nothing when no real signal fired (card falls back to New opportunity)', () => {
    const { reasons } = scoreBusinessOpportunity({ requestOccasion: 'birthday' });
    expect(buildMatchReasons(reasons)).toEqual([]);
  });

  describe('availabilityCoversRequest', () => {
    const now = new Date(2026, 8, 19, 9, 0);
    const slot = (over = {}) => ({ status: 'active', category: 'Foodie', starts_at: new Date(2026, 8, 25, 17, 0).toISOString(), ends_at: new Date(2026, 8, 25, 22, 0).toISOString(), ...over });
    const req = { date: '2026-09-25', category: 'Foodie', time_window_start: '19:00:00' };
    it('is true when an active posting contains the requested time', () => {
      expect(availabilityCoversRequest(req, [slot()], now)).toBe(true);
    });
    it('is false for the wrong day, time, category, status, or an ended posting', () => {
      expect(availabilityCoversRequest({ ...req, date: '2026-09-26' }, [slot()], now)).toBe(false);
      expect(availabilityCoversRequest({ ...req, time_window_start: '23:00:00' }, [slot()], now)).toBe(false);
      expect(availabilityCoversRequest(req, [slot({ category: 'Coffee' })], now)).toBe(false);
      expect(availabilityCoversRequest(req, [slot({ status: 'cancelled' })], now)).toBe(false);
      expect(availabilityCoversRequest(req, [slot()], new Date(2026, 8, 26))).toBe(false);
      expect(availabilityCoversRequest({ category: 'Foodie' }, [slot()], now)).toBe(false);
      expect(availabilityCoversRequest(req, [], now)).toBe(false);
    });
    it('with no requested time, any overlap with that day counts', () => {
      expect(availabilityCoversRequest({ date: '2026-09-25', category: 'Foodie' }, [slot()], now)).toBe(true);
    });
    it('adds the availability line only when covered', () => {
      expect(buildMatchReasons([{ key: 'cuisine' }], { hasAvailability: true })).toContain('You have space posted for that time');
      expect(buildMatchReasons([{ key: 'cuisine' }])).not.toContain('You have space posted for that time');
    });
  });
});

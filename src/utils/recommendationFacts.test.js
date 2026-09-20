import { recommendationFacts, formatDistance } from './recommendationFacts';
import { becauseYouLikeReason, categorizeReasonText, REASON_CATEGORIES } from '../constants/recommendationReasonVocabulary';

describe('recommendationFacts (why / how far / when)', () => {
  const soon = new Date(Date.now() + 3600e3).toISOString();

  test('names the matched interest, distance and time', () => {
    const f = recommendationFacts({ matchesYourInterests: true, interest_tag: 'Coffee', distanceMiles: 1.34, scheduled_at: soon });
    expect(f.why).toBe('Because you like Coffee');
    expect(f.distance).toBe('1.3 mi');
    expect(f.meta).toMatch(/^1\.3 mi · /);
  });

  test('onboarding matchScore also counts as an interest match', () => {
    expect(recommendationFacts({ matchScore: 1, interest_tag: 'Yoga', scheduled_at: soon }).why).toBe('Because you like Yoga');
  });

  test('no invented distance or reason', () => {
    const f = recommendationFacts({ scheduled_at: soon });
    expect(f.distance).toBeNull();
    expect(f.why).toBeNull();
    expect(f.meta).toBe(f.when);
    expect(recommendationFacts(null).meta).toBeNull();
  });

  test('a non-interest first reason is used as the why', () => {
    expect(recommendationFacts({ reasons: ['3 people attending'], scheduled_at: soon }).why).toBe('3 people attending');
  });

  test('distance formatting', () => {
    expect(formatDistance(0.04)).toBe('Very close');
    expect(formatDistance(null)).toBeNull();
    expect(formatDistance(-1)).toBeNull();
  });

  test('generic text only when there is no interest to name; new reason is classified as interest', () => {
    expect(becauseYouLikeReason('')).toBe('Matches your interests');
    expect(categorizeReasonText(becauseYouLikeReason('Coffee'))).toBe(REASON_CATEGORIES.INTEREST);
  });
});

describe('the wizard and Home cards use the why / how far / when rule', () => {
  const fs = require('fs');
  const path = require('path');
  const read = (p) => fs.readFileSync(path.join(__dirname, p), 'utf8');
  test('onboarding wizard no longer shows the bare generic line', () => {
    const wizard = read('../screens/OnboardingRecommendationsScreen.js');
    expect(wizard).toMatch(/recommendationFacts\(r\)/);
    expect(wizard).not.toMatch(/⭐ Matches your interests/);
  });
  test('fit-reason scorers name the interest instead of the generic text', () => {
    for (const f of ['../services/gatherings.js', '../services/homeRecommendations.js']) {
      expect(read(f)).toMatch(/becauseYouLikeReason\(/);
      expect(read(f)).not.toMatch(/reasons\.push\(REASON_TEXT\.MATCHES_INTERESTS\.text\)/);
    }
  });
});

describe('Discover and Gatherings cards use the same rule', () => {
  const fs = require('fs');
  const path = require('path');
  const read = (p) => fs.readFileSync(path.join(__dirname, p), 'utf8');
  const { factsMeta } = require('./recommendationFacts');
  test('factsMeta puts distance first and honours a surface\'s own time wording', () => {
    expect(factsMeta({ distanceMiles: 1.3 }, 'Tonight · 6:30 PM')).toBe('1.3 mi · Tonight · 6:30 PM');
    expect(factsMeta({}, 'Tonight · 6:30 PM')).toBe('Tonight · 6:30 PM');
    expect(factsMeta({}, null)).toBeNull();
  });
  test('Discover names the interest and no longer prints the raw distance label', () => {
    const src = read('../screens/DiscoverHubScreen.js');
    expect(src).not.toMatch(/Matches your \$\{/);
    expect(src).not.toMatch(/timeLine, g\.distanceLabel/);
    expect(src).toMatch(/factsMeta\(g, timeLine\)/);
  });
  test('Gatherings feed badge names the interest; every locale has the key', () => {
    expect(read('../screens/GatheringsScreen.js')).toMatch(/gatherings\.becauseYouLike/);
    const tr = read('../i18n/translations.js');
    expect((tr.match(/becauseYouLike:/g) ?? []).length).toBe((tr.match(/matchesInterests:/g) ?? []).length);
  });
});

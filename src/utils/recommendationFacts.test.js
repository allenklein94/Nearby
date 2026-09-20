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
    expect(formatDistance(0.04)).toBe('200 ft');
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

describe('recommendationRow (Nearby Right Now)', () => {
  const { recommendationRow } = require('./recommendationFacts');
  const at = new Date(Date.now() + 3600e3).toISOString();

  test('distance/time reasons become the measured meta line, not a second reason', () => {
    const r = recommendationRow({
      type: 'gathering',
      reasons: ['Because you like Coffee', 'Close by', 'Happening today'],
      data: { distanceMiles: 1.3, scheduled_at: at },
    });
    expect(r.why).toBe('Because you like Coffee');
    expect(r.meta).toMatch(/^1\.3 mi · (Today|Tonight|Tomorrow|Starts in|Happening now)/);
  });

  test('only distance/time reasons: the meta line carries them, nothing is said twice', () => {
    const r = recommendationRow({ type: 'gathering', reasons: ['Close by', 'Happening today'], data: { distanceMiles: 0.6, scheduled_at: at } });
    expect(r.why).toBeNull();
    expect(r.meta).toMatch(/^0\.6 mi · (Today|Tonight|Tomorrow|Starts in|Happening now)/);
  });

  test('a perk shows distance only, never an invented time', () => {
    const r = recommendationRow({ type: 'perk', reasons: ['Because you like Coffee', 'At Coastal Coffee'], data: { distanceMiles: 2.1 } });
    expect(r.why).toBe('Because you like Coffee · At Coastal Coffee');
    expect(r.meta).toBe('2.1 mi');
  });

  test('nothing measured: the reasons are shown as they are', () => {
    const r = recommendationRow({ type: 'perk', reasons: ['At Coastal Coffee'], data: {} });
    expect(r).toEqual({ why: 'At Coastal Coffee', meta: null });
  });

  test('Home renders the rows through it', () => {
    const fs = require('fs');
    const home = fs.readFileSync(require('path').join(__dirname, '../screens/HomeScreen.js'), 'utf8');
    expect(home).toMatch(/recommendationRow\(item\)/);
    expect(home).not.toMatch(/item\.reasons\.join/);
  });
});

describe('friendGoingReason', () => {
  const { friendGoingReason } = require('./recommendationFacts');
  const att = (id, name) => ({ user_id: id, profiles: { display_name: name } });
  const friends = new Set(['f1', 'f2', 'f3', 'f4']);
  it('names one friend', () => expect(friendGoingReason({ approvedAttendees: [att('x', 'Stranger'), att('f1', 'Sam')] }, friends)).toBe('Sam is going'));
  it('names two, then counts the rest', () => {
    expect(friendGoingReason({ approvedAttendees: [att('f1', 'Sam'), att('f2', 'Alex')] }, friends)).toBe('Sam and Alex are going');
    expect(friendGoingReason({ approvedAttendees: [att('f1', 'Sam'), att('f2', 'Alex'), att('f3', 'Jo'), att('f4', 'Lee')] }, friends)).toBe('Sam, Alex and 2 more friends are going');
  });
  it('is null with no friend going, no friends, or only yourself', () => {
    expect(friendGoingReason({ approvedAttendees: [att('x', 'Stranger')] }, friends)).toBeNull();
    expect(friendGoingReason({ approvedAttendees: [att('f1', 'Sam')] }, new Set())).toBeNull();
    expect(friendGoingReason({ approvedAttendees: [att('f1', 'Sam')] }, friends, 'f1')).toBeNull();
    expect(friendGoingReason(null, friends)).toBeNull();
  });
});

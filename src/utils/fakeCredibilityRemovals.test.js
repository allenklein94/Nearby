// Fake-credibility removals (owner, 2026-11-09; migration 20270407, journey `fakeCredibilityRemovals`). Static guard, no database.
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');
const LANGS = ['en', 'es', 'de', 'fr', 'pt', 'ht', 'zh', 'vi', 'tl', 'ru', 'ko'];

describe('public host reputation line', () => {
  it.each(['screens/GatheringDetailScreen.js', 'screens/ViewProfileScreen.js', 'screens/BusinessProfileScreen.js', 'services/gatherings.js'])(
    '%s has no reputation line or read', (file) => {
      expect(read(file)).not.toMatch(/getHostReputation|getBusinessReputation|hostReputation|reputationLine|welcoming_pct|\.reputation'/);
    });

  it('its strings are gone in every language', () => {
    ['i18n/ui/gatheringDetail.js', 'i18n/ui/viewProfile.js', 'i18n/ui/businessProfile.js'].forEach((f) => {
      expect(read(f)).not.toMatch(/\breputation(Line)?:/);
    });
  });

  it('the feedback prompts stay: their answers still rank things privately', () => {
    expect(read('screens/GatheringDetailScreen.js')).toMatch(/<GatheringFeedbackPrompt/);
    expect(read('services/gatherings.js')).toMatch(/export async function submitGatheringFeedback/);
  });
});

describe('referral reward', () => {
  it('nothing in the app calls it, spends it or counts it', () => {
    expect(fs.existsSync(path.join(SRC, 'services/referrals.js'))).toBe(false);
    ['services/noticeLimits.js', 'screens/InviteFriendsScreen.js'].forEach((f) => {
      expect(read(f)).not.toMatch(/spend_bonus_notice|grant_referral_bonus|referral_redemptions|referral_code|usedBonus|[Bb]onus/);
    });
  });

  it('no language promises a code or a reward on the invite surfaces', () => {
    const { default: invite } = require('../i18n/ui/inviteFriends');
    LANGS.forEach((l) => {
      expect(Object.keys(invite[l])).toEqual(['joinMeOnNearbyUse']);
      expect(invite[l].joinMeOnNearbyUse).toContain('{url}');
      expect(invite[l].joinMeOnNearbyUse).not.toContain('{code}');
    });
    const { translations } = require('../i18n/translations');
    LANGS.forEach((l) => expect(Object.keys(translations[l].inviteFriends)).toEqual(['title', 'subtitle', 'shareInvite']));
    expect(read('i18n/ui/features.js')).not.toMatch(/referral|bonus/i);
  });
});

describe('Trending says popularity, never trust', () => {
  it('its English wording makes no claim about trust, safety or verification', () => {
    const { en } = require('../i18n/translations').translations;
    const reasons = JSON.stringify(en).match(/"[^"]*[Tt]rending[^"]*"/g) || [];
    const discover = read('i18n/ui/discover.js').split('\n').filter((l) => /trending/i.test(l)).slice(0, 2).join(' ');
    expect(reasons.length).toBeGreaterThan(0);
    expect(reasons.join(' ')).not.toMatch(/trust|verif|safe|reliab|vetted|proven|recommended by/i);
    expect(discover.match(/[Tt]rending[^']*'[^']*'/g).join(' ')).not.toMatch(/trust|verif|safe|reliab|vetted|proven/i);
  });

  it('the rule is still a count of confirmed attendance, and the threshold has not moved', () => {
    expect(require('../constants/trending').TRENDING_ATTENDANCE_MIN).toBe(5);
  });
});

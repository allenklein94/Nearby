// Business dashboard audit fixes (owner, 2026-11-14). Source-level guards; the exported website's behaviour is checked
// by scripts/web-check/business-website-headless.py (Bookings empty state + a mocked booking).
const fs = require('fs');
const path = require('path');
const { emptyCopy } = require('../constants/emptyStates');
const bizHelp = require('../i18n/ui/bizHelp');
const bizDash2 = require('../i18n/ui/bizDash2');

const src = fs.readFileSync(path.join(__dirname, 'BusinessDashboardScreen.js'), 'utf8');
const langsOf = (mod) => Object.values(mod).find((v) => v && typeof v === 'object' && v.en) || mod.default || mod;

describe('Bookings tab', () => {
  test('confirmed visits come before hosted gatherings and communities', () => {
    const visits = src.indexOf("t('ui.bizDash2.upcomingNearbyVisits')");
    const gatherings = src.indexOf('<EmptyCopy id="business_gatherings"');
    expect(visits).toBeGreaterThan(0);
    expect(visits).toBeLessThan(gatherings);
  });
  test('"No bookings yet" only once the bookings really loaded, never while loading or after a failure', () => {
    expect(src).toMatch(/opportunitiesLoaded === true && opportunities\.filter\(\(o\) => isPipelineWon\(o, noShowIds\)\)\.length === 0 && \(\s*<EmptyCopy id="business_bookings"/);
    expect(emptyCopy('business_bookings').title).toBe('No bookings yet');
  });
  test('a visit\'s party size is the localized string, never hard-coded English', () => {
    expect(src).not.toMatch(/=== 1 \? 'person' : 'people'/);
    expect(src).toMatch(/t\('ui\.bizHelp\.opportunity\.people', \{ count: o\.business_requests\.party_size \}\)/);
  });
  test('business_bookings is translated in every language bizHelp has', () => {
    const all = langsOf(bizHelp);
    const langs = Object.keys(all);
    expect(langs.length).toBe(11);
    for (const l of langs) {
      const e = all[l]?.ui?.bizHelp?.empty?.business_bookings || all[l]?.bizHelp?.empty?.business_bookings || all[l]?.empty?.business_bookings;
      expect(e && e.title && e.body).toBeTruthy();
    }
  });
});

describe('copy that contradicted the screen or a locked rule', () => {
  test('availability never claims to reach people who did not ask (item 114)', () => {
    expect(src).not.toMatch(/haveOpenSeatsOrA/);
    expect(JSON.stringify(bizDash2)).not.toMatch(/no need to wait for someone to ask/);
  });
  test('the occasion-demand note no longer points to a signal "below" (it renders above)', () => {
    expect(JSON.stringify(bizDash2)).not.toMatch(/same real signal below/);
  });
});

describe('Match Radar trimmed (owner 2026-11-14, option 1)', () => {
  const start = src.indexOf("{tool('demand') && (");
  const radar = src.slice(start, src.indexOf("{on('opportunities') && (", start));
  test('rows come only from matchRadarRows (own categories left to Opportunities)', () => {
    expect(radar).toMatch(/matchRadarRows\(aggregatedDemand\)\.length === 0/);
    expect(radar).toMatch(/matchRadarRows\(aggregatedDemand\)\.map/);
    expect(radar).not.toMatch(/peopleLookingForCategory/); // Home's best-opportunity preview keeps it, Radar never
  });
  test('premium functionality kept: locked-feature prompt, 🟡 unmet searches, 🆕 gap line', () => {
    expect(radar).toMatch(/hasEntitlement\(entitlements, 'advanced_match_radar'\)/);
    expect(radar).toMatch(/recentSearchesFoundNothing/);
    expect(radar).toMatch(/alsoMoreSearchesFoundNothing/);
    expect(radar).toMatch(/isUnofferedGap\(d\) &&/); // 🆕 only when the server says the category isn't offered (audit 2026-11-14)
  });
  test('the empty state no longer says demand for what you offer appears here', () => {
    expect(emptyCopy('business_demand').title).toBe('Nothing outside your categories yet');
    expect(emptyCopy('business_demand').body).toMatch(/at least 5 people/);
  });
  test('Radar headline and description exist in every language', () => {
    const all = JSON.stringify(bizDash2);
    expect((all.match(/peopleLookingOutsideYourCategories/g) || []).length).toBe(11);
    expect(all).not.toMatch(/Real open requests within reach of your business right now, grouped by category/);
  });
});

describe('cross-platform business audit (owner 2026-11-14)', () => {
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, 'BusinessDashboardScreen.js'), 'utf8');
  test('"What You Can Accommodate" shows the group size routing reads (max_group_size), never the auto-reply range', () => {
    const start = src.indexOf("t('ui.bizDash2.whatYouCanAccommodate')");
    const end = src.indexOf("t('ui.bizDash2.experiencesUses')", start);
    const block = src.slice(start, end);
    expect(block).toMatch(/largestGroupYouCanHost/);
    expect(block).toMatch(/max_group_size/);
    expect(block).not.toMatch(/party_size_min|party_size_max|groupsOf/);
    expect(src.match(/t\('ui\.bizDash2\.largestGroupYouCanHost'\)/g)).toHaveLength(1); // one field, never two
  });
  test('Home never tells a business it does not offer a category it declared (is_demand_gap = never served)', () => {
    expect(src).toMatch(/const bestGap = bestUnofferedGap\(aggregatedDemand\)/);
    expect(src).not.toMatch(/d\.is_demand_gap &&/);
  });
});

describe('Profile folded into groups (owner audit 2026-11-14)', () => {
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, 'BusinessDashboardScreen.js'), 'utf8');
  const groupBody = (key) => {
    const start = src.indexOf(`{profileGroup === '${key}' && (`);
    expect(start).toBeGreaterThan(-1);
    const end = src.indexOf('\n</>\n)}\n', start);
    return src.slice(start, end);
  };
  test('every former Profile section lives inside exactly one group (nothing dropped, nothing duplicated)', () => {
    const where = {
      basics: ['editBusinessProfileA11y', '<CreativeLibrarySection', 'weThinkMightBe'],
      accommodate: ["t('ui.bizDash2.largestGroupYouCanHost')", 'experiencesUses', 'occasionsWeOffer', 'isYourExperienceAffectedBy', 'howDoCustomersComeIn', 'whatDoesItUsuallyCost', 'weCreatedExperiences'],
      who: ['whatAgesIsItSuited', 'whatDontYouAccommodate', 'whatDietaryOptionsDoYou'],
      grow: ['tellNearbyOnceAndIt', 'temporaryBoostOptional', 'howsBusinessRightNow'],
      teach: ['anythingElseWeShouldKnow', 'recentAiSuggestions'],
    };
    for (const [key, needles] of Object.entries(where)) {
      const body = groupBody(key);
      for (const n of needles) {
        expect([key, n, body.includes(n)]).toEqual([key, n, true]);
        expect([n, src.split(n).length - 1]).toEqual([n, 1]);
      }
    }
    expect(src).toMatch(/\{profileGroup === 'settings' && \(/);
  });
  test('Tell Nearby stays above the groups, always visible; one open at a time via the shared rule', () => {
    expect(src.indexOf('<TellNearbyBusinessCard')).toBeLessThan(src.indexOf("renderProfileGroupHeader('basics'"));
    expect(src).not.toMatch(/profileSettingsOpen/);
    expect(src.match(/toggleProfileGroup\(g, /g).length).toBeGreaterThanOrEqual(2);
    expect(src).toMatch(/accessibilityState=\{\{ expanded: profileGroup === key \}\}/);
  });
});

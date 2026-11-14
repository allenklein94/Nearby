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
    expect(radar).toMatch(/d\.is_demand_gap &&/);
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

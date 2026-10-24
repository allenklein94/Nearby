// Your Progress folded into Profile (owner 2026-10-24): the separate Momentum / "Your Activity" screen is gone; Profile's
// "Your Progress" row expands in place to the same streak, weekly chart, month changes, lifetime stats and achievements.
const fs = require('fs');
const path = require('path');
const routers = require('@react-navigation/routers');
const { SCREEN_REGISTRY, RULE14_DECISIONS } = require('../constants/screenRegistry');

const SRC = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(SRC, f), 'utf8');
const profile = read('screens/ProfileScreen.js');
const details = read('components/YourProgressDetails.js');
const walk = (d, out = []) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p, out); else if (/\.js$/.test(e.name) && !/\.test\.js$/.test(e.name)) out.push(p);
  }
  return out;
};

describe('the separate screen is gone', () => {
  test('no file, no route, no registry entry; recorded as folded into Profile', () => {
    expect(fs.existsSync(path.join(SRC, 'screens/MomentumScreen.js'))).toBe(false);
    expect(read('navigation/RootNavigator.js')).not.toMatch(/name="Momentum"|MomentumScreen/);
    expect(SCREEN_REGISTRY.Momentum).toBeUndefined();
    expect(RULE14_DECISIONS.folded.Momentum).toMatch(/Profile/);
    expect(RULE14_DECISIONS.borderlineKeep).not.toContain('Momentum');
  });

  test('nothing navigates to the old route', () => {
    const offenders = walk(SRC).filter((f) => /navigate\(\s*'Momentum'|to\('Momentum'|screen: 'Momentum'/.test(fs.readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });

  test('the retired streak push still lands on Your Progress, now Profile with the section open', () => {
    expect(read('navigation/notificationDestinations.js')).toMatch(/case 'momentum_streak_nudge':\s*\n\s*\/\/[^\n]*\n\s*return to\('MainTabs', \{ screen: 'Profile', params: \{ expandProgress: true \} \}\);/);
    expect(profile).toMatch(/if \(!route\?\.params\?\.expandProgress\) return undefined;\s*\n\s*setProgressExpanded\(true\);/);
  });
});

describe('Profile: Your Progress expands in place', () => {
  test('the row toggles in place (no navigation), tells screen readers whether it is expanded', () => {
    const start = profile.indexOf("t('ui.profile.viewYourProgressA11y')");
    const row = profile.slice(profile.lastIndexOf('<TouchableOpacity', start), profile.indexOf('</TouchableOpacity>', start));
    expect(row).toMatch(/onPress=\{\(\) => setProgressExpanded\(!progressOpen\)\}/);
    expect(row).toMatch(/accessibilityState=\{\{ expanded: progressOpen \}\}/);
    expect(row).not.toMatch(/navigate/);
  });

  test('the same reads as before (getMomentumStats + getInsightsStats), only once it is open, refreshed on focus while open', () => {
    expect(profile).toMatch(/Promise\.all\(\[getMomentumStats\(\), getInsightsStats\(\)\]\)/);
    expect(profile).toMatch(/if \(open\) \{[\s\S]*?loadProgress\(\);/);
    expect(profile).toMatch(/addListener\?\.\('focus', \(\) => \{ load\(\); if \(progressOpenRef\.current\) loadProgress\(\); \}\)/);
    // loading / error (Try Again) / signed out, as the screen had them
    expect(profile).toMatch(/<LoadErrorState message=\{t\('ui\.momentum\.couldntLoadYourProgress'\)\} onRetry=\{loadProgress\} \/>/);
  });

  test('every detail the screen had is in the expanded section', () => {
    for (const piece of ['momentum.currentStreak', 'momentum.weeks.map', 'momentum.thisMonth', 'momentum.lastMonth', "ui.momentum.lifetimeStats",
      'insights.hostedCount', 'insights.communitiesCreated', 'insights.vibeBreakdown', 'insights.achievements.map', 'notYetEarnedA11y',
      "navigateKeepingTrail(navigation, 'Discover', gatheringsTabParams())"]) {
      expect(details).toContain(piece);
    }
    expect(profile).toMatch(/<YourProgressDetails[\s\S]*?momentum=\{progress\.momentum\}[\s\S]*?insights=\{progress\.insights\}/);
  });

  test('nothing twice: the vibe/active row stays Profile\'s, the earned-only badges give way to the full grid when open', () => {
    expect(details).not.toMatch(/favoriteVibe|usuallyActive|memberSince/);
    expect(profile).toMatch(/\{!progressOpen && achievements\.some\(\(a\) => a\.earned\) && \(/);
  });

  test('one inline expansion at a time: opening Your Progress closes Your communities and vice versa', () => {
    expect(profile).toMatch(/if \(open\) \{\s*\n\s*setShowCommunities\(false\);/);
    expect(profile).toMatch(/onPress=\{\(\) => \{ if \(!showCommunities && progressOpenRef\.current\) setProgressExpanded\(false\); setShowCommunities\(\(v\) => !v\); \}\}/);
  });

  test('collapsing keeps the person at the section (scroll position preserved), no animation added', () => {
    expect(profile).toMatch(/onScroll=\{\(e\) => \{ scrollYRef\.current = e\.nativeEvent\.contentOffset\.y; \}\}/);
    expect(profile).toMatch(/onLayout=\{\(e\) => \{ progressYRef\.current = e\.nativeEvent\.layout\.y; \}\}/);
    expect(profile).toMatch(/else if \(scrollYRef\.current > progressYRef\.current\) \{[\s\S]*?scrollTo\(\{ y: progressYRef\.current, animated: false \}\)/);
    const fn = profile.slice(profile.indexOf('function setProgressExpanded'), profile.indexOf('async function load()'));
    expect(fn).not.toMatch(/animateLayout|Animated|LayoutAnimation/);
  });

  test('usage signals kept without personal detail', () => {
    expect(profile).toMatch(/posthog\?\.capture\('momentum_viewed', \{ source:/);
    expect(profile).toMatch(/posthog\?\.capture\('momentum_cta_tapped', \{ source: 'profile' \}\)/);
  });
});

describe('Back from Profile behaves as any tab (no extra screen on the stack)', () => {
  test('through the real routers, the retired push opens the Profile tab with expandProgress and pushes nothing', () => {
    const opts = (names) => ({ routeNames: names, routeParamList: {}, routeGetIdList: {} });
    const tabs = routers.TabRouter({});
    let state = tabs.getInitialState(opts(['Home', 'Discover', 'Create', 'Activity', 'Profile']));
    state = tabs.getStateForAction(state, routers.CommonActions.navigate('Profile', { expandProgress: true }), opts(['Home', 'Discover', 'Create', 'Activity', 'Profile']));
    expect(state.routes[state.index]).toMatchObject({ name: 'Profile', params: { expandProgress: true } });
    expect(state.routes).toHaveLength(5);
  });
});

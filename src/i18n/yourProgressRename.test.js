// "Your Activity" -> "Your Progress" (owner 2026-10-24): the Momentum stats screen is never named like the Activity tab.
// Wording only: route, navigation and the screen's contents are unchanged.
const fs = require('fs');
const path = require('path');
import { UI_NAMESPACES, UI_LANGUAGES } from './ui';

const read = (f) => fs.readFileSync(path.join(__dirname, f), 'utf8');
const KEYS = [['nav', 'title.momentum'], ['profile', 'yourProgress'], ['profile', 'viewYourProgressA11y'],
  ['momentum', 'loadingYourProgress'], ['momentum', 'couldntLoadYourProgress'], ['momentum', 'signInToSeeYourProgress']];
const get = (obj, dotted) => dotted.split('.').reduce((o, k) => o?.[k], obj);

describe('Your Progress rename', () => {
  test('English reads "Your Progress" on the header and the Profile row', () => {
    expect(get(UI_NAMESPACES.nav.en, 'title.momentum')).toBe('Your Progress');
    expect(UI_NAMESPACES.profile.en.yourProgress).toBe('🔥 Your Progress');
    expect(UI_NAMESPACES.profile.en.viewYourProgressA11y).toBe('View your progress, stats, and streak');
  });

  test('every language has every renamed key, and none still names the screen like the Activity tab', () => {
    for (const lang of UI_LANGUAGES) {
      for (const [ns, key] of KEYS) {
        expect(typeof get(UI_NAMESPACES[ns][lang], key)).toBe('string');
      }
      // the Profile row and the header never equal the Activity tab's own label
      const tab = get(UI_NAMESPACES.nav[lang], 'tab.activity');
      expect(typeof tab).toBe('string');
      expect(get(UI_NAMESPACES.nav[lang], 'title.momentum')).not.toBe(tab);
      expect(UI_NAMESPACES.profile[lang].yourProgress.replace('🔥 ', '')).not.toBe(tab);
    }
    expect(UI_NAMESPACES.profile.en.yourActivity).toBeUndefined();
    expect(UI_NAMESPACES.profile.en.viewYourActivityStatsAndA11y).toBeUndefined();
  });

  test('the screens read the new keys; route and destination unchanged', () => {
    const profile = read('../screens/ProfileScreen.js');
    const momentum = read('../screens/MomentumScreen.js');
    expect(profile).toMatch(/t\('ui\.profile\.yourProgress'\)/);
    expect(profile).toMatch(/t\('ui\.profile\.viewYourProgressA11y'\)/);
    expect(profile).toMatch(/navigation\.navigate\('Momentum', \{ source: 'profile' \}\)/);
    for (const k of ['loadingYourProgress', 'couldntLoadYourProgress', 'signInToSeeYourProgress']) expect(momentum).toMatch(new RegExp(`ui\\.momentum\\.${k}`));
    expect(read('../navigation/RootNavigator.js')).toMatch(/name="Momentum" component=\{MomentumScreen\}[^\n]*t\('ui\.nav\.title\.momentum'\)/);
  });
});

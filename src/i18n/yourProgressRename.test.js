// "Your Activity" -> "Your Progress" (owner 2026-10-24): never named like the Activity tab. The same day it was folded into
// Profile as a section that expands in place (screens/yourProgressInProfile.test.js); the screen title string went with the route.
const fs = require('fs');
const path = require('path');
import { UI_NAMESPACES, UI_LANGUAGES } from './ui';

const read = (f) => fs.readFileSync(path.join(__dirname, f), 'utf8');
const KEYS = [['profile', 'yourProgress'], ['profile', 'viewYourProgressA11y'],
  ['momentum', 'loadingYourProgress'], ['momentum', 'couldntLoadYourProgress'], ['momentum', 'signInToSeeYourProgress']];
const get = (obj, dotted) => dotted.split('.').reduce((o, k) => o?.[k], obj);

describe('Your Progress rename', () => {
  test('English reads "Your Progress" on the header and the Profile row', () => {
    expect(get(UI_NAMESPACES.nav.en, 'title.momentum')).toBeUndefined(); // no screen, no title
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
      expect(UI_NAMESPACES.profile[lang].yourProgress.replace('🔥 ', '')).not.toBe(tab);
    }
    expect(UI_NAMESPACES.profile.en.yourActivity).toBeUndefined();
    expect(UI_NAMESPACES.profile.en.viewYourActivityStatsAndA11y).toBeUndefined();
  });

  test('Profile reads the new keys', () => {
    const profile = read('../screens/ProfileScreen.js');
    expect(profile).toMatch(/t\('ui\.profile\.yourProgress'\)/);
    expect(profile).toMatch(/t\('ui\.profile\.viewYourProgressA11y'\)/);
    for (const k of ['loadingYourProgress', 'couldntLoadYourProgress', 'signInToSeeYourProgress']) expect(profile).toMatch(new RegExp(`ui\\.momentum\\.${k}`));
  });
});

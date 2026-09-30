// Onboarding shows goals, looking-for choices, quick interests and notification kinds through ui.onboarding.*, while the
// values it SAVES stay the constants' own English (goal labels and looking-for tokens are stored in onboarding_motivations).
// These keys must be exactly the source lists in every language, and English word for word, so nothing shows a raw key
// and the English app reads as before.
import o from './ui/onboarding';
import { UI_LANGUAGES } from './ui';
import { ONBOARDING_GOALS, LOOKING_FOR_OPTIONS } from '../constants/onboardingGoals';
import { QUICK_INTERESTS } from '../constants/onboardingInterests';
import { NOTIFICATION_CATEGORIES } from '../constants/notificationCategories';

const keys = (list, k = 'key') => list.map((x) => x[k]).sort();

describe('Onboarding option labels', () => {
  for (const lang of UI_LANGUAGES) {
    test(lang, () => {
      expect(Object.keys(o[lang].goal).sort()).toEqual(keys(ONBOARDING_GOALS));
      expect(Object.keys(o[lang].lookingFor).sort()).toEqual(keys(LOOKING_FOR_OPTIONS));
      expect(Object.keys(o[lang].quick).sort()).toEqual(keys(QUICK_INTERESTS));
      expect(Object.keys(o[lang].notify).sort()).toEqual(keys(NOTIFICATION_CATEGORIES, 'column'));
    });
  }
  test('English matches the source lists word for word', () => {
    for (const g of ONBOARDING_GOALS) expect(o.en.goal[g.key]).toBe(g.label);
    for (const l of LOOKING_FOR_OPTIONS) expect(o.en.lookingFor[l.key]).toBe(l.label);
    for (const q of QUICK_INTERESTS) expect(o.en.quick[q.key]).toBe(q.label);
    for (const c of NOTIFICATION_CATEGORIES) {
      expect(o.en.notify[c.column].label).toBe(c.label);
      expect(o.en.notify[c.column].hint).toBe(c.hint);
    }
  });
  test('goals are still saved by their English label, never the translated one', () => {
    const src = require('fs').readFileSync(require('path').join(__dirname, '../screens/OnboardingQuestionsScreen.js'), 'utf8');
    expect(src).toContain('toggleGoal(g.label)');
    expect(src).not.toMatch(/toggleGoal\(t\(/);
  });
});

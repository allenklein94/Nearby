// Display labels for shared option lists in the person's language (localization pass 5). Stored/compared values never
// change: every function takes the canonical key and returns only the text shown. English returns the app's own label.
import { translate, hasOwnTranslation } from './translate';
import { categoryName } from './categoryNames';

const isEnglish = (language) => !language || language === 'en';
const BUDGET_SLUG = { any: 'any', $: 'cheap', $$: 'moderate', $$$: 'special' };

export function budgetOptionLabel(option, language) {
  if (!option) return null;
  return isEnglish(language) || !BUDGET_SLUG[option.key] ? option.label : translate(language, `ui.optionVocab.budget.${BUDGET_SLUG[option.key]}`);
}
export function experienceOptionLabel(option, language) {
  if (!option) return null;
  return isEnglish(language) ? option.label : translate(language, `ui.optionVocab.experience.${option.key}`);
}
// today / tonight / tomorrow / weekend / flexible
export function dateOptionLabel(key, fallback, language) {
  return isEnglish(language) && fallback ? fallback : translate(language, `ui.optionVocab.date.${key}`);
}
// business attributes and dietary needs reuse the vocab the reasons already translate
export function attributeLabel(key, fallback, language) {
  if (isEnglish(language) || !key) return fallback;
  return hasOwnTranslation(language, `vocab.attributes.${key}`) ? translate(language, `vocab.attributes.${key}`) : fallback;
}
export function dietaryOptionLabel(key, fallback, language) {
  if (isEnglish(language) || !key) return fallback;
  return hasOwnTranslation(language, `vocab.dietary.${key}`) ? translate(language, `vocab.dietary.${key}`) : fallback;
}

// A quick-start option's label (Home quick picks, the Start Something sheet): its own key under ui.startSomething.option,
// else a time-flavored Home pick (ui.homeParts.quickPick), else the category's translated name. The item is unchanged
// (its English label is still what code compares and looks up).
const START_OPTION_KEYS = { Games: 'games', Volunteer: 'volunteer', 'Something Else': 'somethingElse', Pizza: 'pizza', Mexican: 'mexican', Sushi: 'sushi', Burgers: 'burgers', Healthy: 'healthy', Italian: 'italian', "Doesn't matter": 'doesntMatter' };
const QUICK_PICK_KEYS = { 'Morning Run': 'morningRun', Breakfast: 'breakfast', Lunch: 'lunch', Dinner: 'dinner', Concert: 'concert', Walk: 'walk', 'Beach Volleyball': 'beachVolleyball', 'Beach Cleanup': 'beachCleanup', 'Wine Tasting': 'wineTasting' };
export function quickOptionLabel(item, language) {
  if (!item) return null;
  if (START_OPTION_KEYS[item.label]) return translate(language, `ui.startSomething.option.${START_OPTION_KEYS[item.label]}`);
  if (QUICK_PICK_KEYS[item.label]) return translate(language, `ui.homeParts.quickPick.${QUICK_PICK_KEYS[item.label]}`);
  return categoryName(item.label, language);
}

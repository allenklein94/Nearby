// Display labels for shared option lists in the person's language (localization pass 5). Stored/compared values never
// change: every function takes the canonical key and returns only the text shown. English returns the app's own label.
import { translate, hasOwnTranslation } from './translate';

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

// Profile "basics" (constants/basicsFields.js) in the person's language: the field label, its example placeholder and each
// select option, keyed by the field key and the option's slug. Display only: the stored answer stays the English option
// value; a value with no translation (legacy data, free text) is shown as stored.
import { translate, hasOwnTranslation } from './translate';

export const optionSlug = (value) => String(value).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
const isEnglish = (language) => !language || language === 'en';

export function basicsLabel(field, language) {
  if (!field) return '';
  return isEnglish(language) ? field.label : translate(language, `ui.basicsVocab.label.${field.key}`);
}
export function basicsPlaceholder(field, language) {
  if (!field?.placeholder) return field?.placeholder;
  return isEnglish(language) ? field.placeholder : translate(language, `ui.basicsVocab.placeholder.${field.key}`);
}
export function basicsOption(fieldKey, value, language) {
  if (value == null || isEnglish(language)) return value;
  const key = `ui.basicsVocab.option.${fieldKey}.${optionSlug(value)}`;
  return hasOwnTranslation(language, key) ? translate(language, key) : value;
}

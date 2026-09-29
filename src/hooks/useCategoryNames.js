// Category, group and occasion names in the person's language for chips and pickers (i18n/categoryNames.js). Display only:
// every picker still stores and compares the canonical value (the English tag, the group key, the occasion key).
import { useMemo } from 'react';
import { useLanguage } from '../context/LanguageContext';
import { categoryName, groupName, occasionName, railName } from '../i18n/categoryNames';
import { translate } from '../i18n/translate';

export default function useCategoryNames() {
  const { language } = useLanguage();
  return useMemo(() => ({
    language,
    tag: (value) => categoryName(value, language),
    group: (key, fallback) => groupName(key, language, fallback),
    occasion: (key, fallback) => occasionName(key, language, fallback),
    rail: (key, fallback) => railName(key, language, fallback),
    label: (key) => translate(language, `vocab.labels.${key}`),
    // a declared cuisine chip (vocab.cuisines, already translated for reasons); English keeps its own label
    cuisine: (key, fallback) => (!language || language === 'en' || !key ? fallback : translate(language, `vocab.cuisines.${key}`)),
  }), [language]);
}

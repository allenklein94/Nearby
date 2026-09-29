// Category, category-group and occasion names in the person's language (localization pass 4, 2026-09-29). The ONE lookup for
// names Nearby composes into its own text: recommendation reasons ("Because you like {category}"), result titles ("offers
// {occasion} experiences") and the Surprise Me line. Translations live in translations.<lang>.vocab.categories and are keyed
// by the PERMANENT key, never the display name: a tag's `category_tag_groups.key` (item 97; from the synced taxonomy, else
// derived by the same rule the database used to create it), a group's key, an occasion's key. So an admin rename keeps its
// translation, and a tag added after this release (no entry yet) is shown as stored, never as a key path.
// English is returned exactly as given (stored names stay stored names).
import { translate, DEFAULT_LANGUAGE } from './translate';
import { translations } from './translations';
import { TAG_KEYS, currentTagName } from '../constants/categoryRegistry';
import { CATEGORY_GROUPS } from '../constants/gatheringCategories';
import { OCCASION_OPTIONS } from '../constants/businessAttributes';

// Same rule as the database's _category_key_from_name: lowercase, & -> and, every other run of non-alphanumerics -> _.
export function deriveCategoryKey(name) {
  return String(name).toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

export function tagKey(name) {
  if (typeof name !== 'string' || !name) return null;
  const current = currentTagName(name);
  return TAG_KEYS.get(current) ?? deriveCategoryKey(current);
}

const has = (language, path) => typeof path.split('.').reduce((v, p) => v?.[p], translations[language]?.vocab) === 'string';

export function categoryName(value, language = DEFAULT_LANGUAGE) {
  if (typeof value !== 'string' || !value || !language || language === DEFAULT_LANGUAGE) return value;
  const k = tagKey(value);
  if (k && has(DEFAULT_LANGUAGE, `categories.tags.${k}`)) return translate(language, `vocab.categories.tags.${k}`);
  const group = CATEGORY_GROUPS.find((g) => g.label === value || g.key === value);
  if (group && has(DEFAULT_LANGUAGE, `categories.groups.${group.key}`)) return translate(language, `vocab.categories.groups.${group.key}`);
  const occasion = OCCASION_OPTIONS.find((o) => o.label === value || o.key === value);
  if (occasion && has(DEFAULT_LANGUAGE, `categories.occasions.${occasion.key}`)) return translate(language, `vocab.categories.occasions.${occasion.key}`);
  return value;
}

// "Coffee + Movies" style lists (Surprise Me's scope line): each name localized, the joiner kept.
export const categoryNames = (values, language = DEFAULT_LANGUAGE, sep = ' + ') => values.map((v) => categoryName(v, language)).join(sep);

// By key, for pickers that already hold the key (a group chip, an occasion chip whose own label may differ, e.g. an
// "offered occasion" shown as "Group/Family"). `fallback` = what English shows; unknown keys return it unchanged.
export function groupName(key, language = DEFAULT_LANGUAGE, fallback = null) {
  const english = fallback ?? CATEGORY_GROUPS.find((g) => g.key === key)?.label ?? key;
  if (!language || language === DEFAULT_LANGUAGE || !has(DEFAULT_LANGUAGE, `categories.groups.${key}`)) return english;
  return translate(language, `vocab.categories.groups.${key}`);
}
export function occasionName(key, language = DEFAULT_LANGUAGE, fallback = null) {
  const english = fallback ?? OCCASION_OPTIONS.find((o) => o.key === key)?.label ?? key;
  if (!language || language === DEFAULT_LANGUAGE || !has(DEFAULT_LANGUAGE, `categories.occasions.${key}`)) return english;
  return translate(language, `vocab.categories.occasions.${key}`);
}
// Discover's Browse row uses short names for its seven leading groups ("Activities"); the rest use the group name.
export function railName(key, language = DEFAULT_LANGUAGE, fallback = null) {
  if (!language || language === DEFAULT_LANGUAGE) return fallback ?? groupName(key, language);
  if (has(DEFAULT_LANGUAGE, `categories.rail.${key}`)) return translate(language, `vocab.categories.rail.${key}`);
  return groupName(key, language, fallback);
}

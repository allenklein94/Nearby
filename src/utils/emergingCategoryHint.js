import { CATEGORY_GROUPS } from '../constants/gatheringCategories';
import { searchBusinessTypes } from './businessTypeSearch';

// Item 129: when several businesses describe themselves in words no category covers ("Recovery lounge"), the admin
// decides where it belongs, which may be an EXISTING category (Wellness & Beauty -> Recovery) rather than a new one.
// The server already maps a cluster to an existing tag when given its exact name (admin_resolve_emerging_category),
// so this only makes that choice visible: the same canonical search the signup form uses (tags + synonyms, rule-based,
// never AI) proposes existing categories, and the wording of the confirm/result says whether a category will be
// CREATED or the applications FILED under one that exists. The admin still decides; nothing is applied automatically.

export function existingCategoryMatches(phrase, limit = 3) {
  return searchBusinessTypes(phrase, 12).filter((r) => r.subcategory).slice(0, limit);
}

// The live tag with this name (any case), with its group, or null.
export function findExistingTag(name) {
  const n = String(name ?? '').trim().toLowerCase();
  if (!n) return null;
  for (const g of CATEGORY_GROUPS) {
    for (const tag of [...g.tags, ...(g.businessOnlyTags ?? [])]) {
      if (tag.toLowerCase() === n) return { tag, group: g.key, groupLabel: g.label };
    }
  }
  return null;
}

// What resolving this flag with (name, group) will do, worded for the confirm and the result.
export function emergingResolveCopy({ name, group, groupLabel, applicants }) {
  const existing = findExistingTag(name);
  const n = applicants === 1 ? '1 application' : `${applicants} applications`;
  if (existing && existing.group !== group) {
    return { blocked: true, title: 'Different group', body: `${existing.tag} already exists under ${existing.groupLabel}. Pick that group to file these applications under it.` };
  }
  if (existing) {
    return {
      existing: true,
      title: `File under ${existing.groupLabel} → ${existing.tag}?`,
      body: `No new category is created. The ${n} that used these words are mapped to ${existing.tag}, and their wording is remembered so future businesses get the suggestion.`,
      action: 'File here',
      done: (mapped) => `Filed under ${existing.tag}. ${mapped} application${mapped === 1 ? '' : 's'} mapped.`,
      tag: existing.tag,
    };
  }
  return {
    existing: false,
    title: `Add "${name}" under ${groupLabel}?`,
    body: `It becomes a permanent category, and the ${n} that used these words are mapped to it. It cannot be renamed or removed here.`,
    action: 'Add and map',
    done: (mapped) => `${name} is now a category. ${mapped} application${mapped === 1 ? '' : 's'} mapped.`,
    tag: name,
  };
}

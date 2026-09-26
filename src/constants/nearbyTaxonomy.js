// NEARBY_CANONICAL_TAXONOMY (owner 2026-09-21): the ONE front door to everything Nearby knows about what things ARE.
// It owns no data of its own -- each layer has exactly one source, listed below -- it only lets a system ask "what does
// this tag mean everywhere?" without knowing where each layer lives. Teach a new concept ONCE (an admin adds the tag and its
// synonyms; the business signup, search, Discover, Create, recommendations, requests and the resolver all read the same
// tables) instead of teaching each system separately.
//
//   Layer                     Source of truth (client)                      Source of truth (database)
//   major categories          gatheringCategories.CATEGORY_GROUPS           category_major_keys() (a migration)
//   subcategories / tags      CATEGORY_GROUPS[].tags (+ registry merge)     category_tag_groups (admin_add_category_tag)
//   business-only tags        CATEGORY_GROUPS[].businessOnlyTags            category_tag_groups.business_only
//   synonyms / search aliases categorySynonyms                              category_synonyms (admin_add_category_synonym)
//   remembered business words services/businessCategorySuggestion           category_aliases
//   semantic tags (attributes) businessAttributes.BUSINESS_ATTRIBUTE_OPTIONS the attribute CHECKs (a migration)
//   occasions                 businessAttributes.OCCASION_OPTIONS           the occasion CHECKs (a migration)
//   user-interest mappings    hobbyRelations (related tags, hobby->attrs)   (client-side ranking only, by rule)
//   related activities        activityDictionary (sibling, never a synonym)  (client-side ranking only, by rule)
//   intent mappings           intentRoutes.INTENT_ROUTES                    (client-side, deterministic)
//   activity types / formats  the leaf tags themselves (no second list)     --
import { CATEGORY_GROUPS } from './gatheringCategories';
import { canonicalGroupForTag, tagsForGroup } from './categoryMapping';
import { tagsForPhrase, expandSearchTerms, SYNONYM_GROUPS } from './categorySynonyms';
import { HOBBY_RELATIONS, HOBBY_ATTRIBUTES } from './hobbyRelations';
import { BUSINESS_ATTRIBUTE_OPTIONS, OCCASION_OPTIONS } from './businessAttributes';
import { INTENT_ROUTES } from './intentRoutes';
import { relatedActivities } from './activityDictionary';

export { CATEGORY_GROUPS, canonicalGroupForTag, tagsForGroup, tagsForPhrase, expandSearchTerms, INTENT_ROUTES, OCCASION_OPTIONS, BUSINESS_ATTRIBUTE_OPTIONS };

// Everything the taxonomy knows about one canonical tag, or null for a name that is not a tag.
export function describeTag(tag) {
  const groupDef = CATEGORY_GROUPS.find((g) => g.tags.includes(tag) || (g.businessOnlyTags ?? []).includes(tag));
  if (!groupDef) return null;
  const group = groupDef.key;
  const synonyms = SYNONYM_GROUPS.filter((g) => g.tags.includes(tag)).flatMap((g) => g.phrases);
  const relatedTags = HOBBY_RELATIONS[tag] ?? [];
  const relatedFrom = Object.keys(HOBBY_RELATIONS).filter((h) => HOBBY_RELATIONS[h].includes(tag));
  return {
    tag,
    group,
    groupLabel: groupDef.label,
    businessOnly: (groupDef?.businessOnlyTags ?? []).includes(tag),
    synonyms,
    relatedTags,
    relatedFromHobbies: relatedFrom,
    relatedActivities: relatedActivities(tag),
    suitedAttributes: HOBBY_ATTRIBUTES[tag] ?? [],
  };
}

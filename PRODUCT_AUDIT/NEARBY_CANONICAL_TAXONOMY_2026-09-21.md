# NEARBY_CANONICAL_TAXONOMY (2026-09-21)

One taxonomy, taught once. `src/constants/nearbyTaxonomy.js` is the front door (`describeTag(tag)` joins every layer);
each layer has exactly ONE source of truth below. Add "Padel" = an admin adds the tag (`admin_add_category_tag`) and its
wordings (`admin_add_category_synonym`, or by resolving an emerging category, which registers the wordings itself). No
per-feature list is edited.

| Layer | Client source | Database source | How it is taught |
|---|---|---|---|
| Major categories (19) | `gatheringCategories.CATEGORY_GROUPS` | `category_major_keys()` | a migration (deliberate) |
| Subcategories / tags | `CATEGORY_GROUPS[].tags` + `categoryRegistry` | `category_tag_groups` | admin, no release (hydrated on sign-in) |
| Business-only tags | `businessOnlyTags` | `category_tag_groups.business_only` | admin |
| Synonyms / search aliases | `categorySynonyms` | `category_synonyms` | admin, no release (hydrated on sign-in) |
| Remembered business wording | `businessCategorySuggestion` | `category_aliases` | admin mapping |
| Semantic tags (attributes, 20) | `businessAttributes` | attribute CHECKs | a migration |
| Occasions (24) | `OCCASION_OPTIONS` | occasion CHECKs | a migration |
| User-interest mappings | `hobbyRelations` (related tags, hobby -> attributes) | none (client ranking only, by rule) | code |
| Intent mappings | `intentRoutes.INTENT_ROUTES` | none (deterministic, client) | code |
| Activity types | the leaf tags themselves | -- | no second list |

## Who consumes it

| System | How it reads the taxonomy | Enforced by |
|---|---|---|
| Discover | `CATEGORY_GROUPS` rail (`discoverCategoryRail`), category gateway view, tag lists | `surfaceJobs.test.js`, `discoverCategoryRail.test.js` |
| Home recommendations | `canonicalizeInterests`, `categoryMapping`, `blendedRanking`, hobby relations | `categoryMapping.test.js`, `hobbyRelations.test.js` |
| Create | category picker from `INTEREST_OPTIONS` (registry-merged), intent routes | `gatheringStructure.test.js`, `intentRoutes.test.js` |
| Gatherings | `interest_tag` (client-limited, see gaps) | -- |
| Business profiles | `subcategory` FK + `categories` trigger against `category_tag_groups` | DB constraint |
| Business requests / availability / priority | `category` FK | DB constraint |
| Business offers | `target_interest_tag` validated against the caller's interests | server function |
| Search | `tagsForPhrase` / `expandSearchTerms` (gatherings, communities, offers, signup) | `categorySynonyms.test.js` |
| Intent resolver | edge functions read `category_tag_groups` (`_shared/categoryTags.ts`); client routes via `intentRoutes` | `categoryRegistry.test.js` |
| Emerging categories | flags repeated unmatched wording; excludes tags, aliases, synonyms | lifecycle scripts |

## Honest gaps
- `gatherings.interest_tag` and `brand_offers.target_interest_tag` have no database foreign key to `category_tag_groups`
  (gatherings are client-limited, as before); a rename/removal policy is not needed because tags are never renamed or deleted.
- The AI extractor's vocabulary is tags only; synonyms are not sent to it (it maps to canonical tags itself).
- Google Places search does not use synonyms.
- A new synonym is understood after the next sign-in hydrate on a device (cached list applies immediately at start-up).
- Majors, attributes and occasions still need a migration to grow (many CHECKs), by decision.

import { CATEGORY_GROUPS } from '../constants/gatheringCategories';
import { businessAttributeLabel, cuisineLabel, occasionLabel, experiencePartyTypeLabel, OFFERED_OCCASION_KEYS, ACCOMMODATE_PARTY_TYPE_OPTIONS } from '../constants/businessAttributes';

// "Tell Nearby about your business" (existing owners): turns the extractor's answer into (a) the chips shown back for the
// owner's "Looks right?" and (b) the ADDITIVE patch that would be saved. Additive by design: nothing the owner already set
// is removed or overwritten -- the primary category, subcategory and cuisine are only filled when empty; the list fields
// (attributes, secondary categories, occasions we offer, party types) only gain entries. Pure, so it is testable.
const uniq = (a) => Array.from(new Set(a));
const PARTY_KEYS = ACCOMMODATE_PARTY_TYPE_OPTIONS.map((o) => o.key);

function categoryLabel(key) {
  const g = CATEGORY_GROUPS.find((x) => x.key === key);
  return g ? `${g.icon} ${g.label}` : null;
}

export function buildSetupPlan(partner, result) {
  const p = partner ?? {};
  const r = result ?? {};
  const has = (v) => v !== null && v !== undefined && v !== '';

  const category = has(p.category) ? p.category : (has(r.category) ? r.category : null);
  const categoryIsNew = !has(p.category) && has(r.category);
  // The server only returns a subcategory that belongs to ITS category, so it is only usable when that is the final category.
  const subcategory = has(p.subcategory) ? p.subcategory : (r.category && category === r.category && has(r.subcategory) ? r.subcategory : null);
  const cuisine = has(p.cuisine) ? p.cuisine : (category === 'food_drink' && has(r.cuisine) ? r.cuisine : null);

  const attributes = uniq([...(p.attributes ?? []), ...(r.attributes ?? [])]);
  const categories = uniq([...(p.categories ?? []), ...(r.categories ?? [])]).filter((c) => c !== subcategory);
  const offeredOccasions = uniq([...(p.offered_occasions ?? []), ...(r.offeredOccasions ?? [])]).filter((o) => OFFERED_OCCASION_KEYS.includes(o));
  const partyTypes = uniq([...(p.accommodates_party_types ?? []), ...(r.partyTypes ?? [])]).filter((t) => PARTY_KEYS.includes(t));

  const gained = {
    attributes: attributes.filter((a) => !(p.attributes ?? []).includes(a)),
    categories: categories.filter((c) => !(p.categories ?? []).includes(c)),
    offeredOccasions: offeredOccasions.filter((o) => !(p.offered_occasions ?? []).includes(o)),
    partyTypes: partyTypes.filter((t) => !(p.accommodates_party_types ?? []).includes(t)),
  };
  const subcategoryIsNew = has(subcategory) && !has(p.subcategory);
  const cuisineIsNew = has(cuisine) && !has(p.cuisine);

  // What the owner reads back: only what the extractor actually understood from THEIR text (not their whole profile).
  const chips = [];
  if (has(r.category) && categoryLabel(r.category)) chips.push({ key: `cat:${r.category}`, label: categoryLabel(r.category), isNew: categoryIsNew });
  if (has(r.subcategory) && r.category === category) chips.push({ key: `sub:${r.subcategory}`, label: r.subcategory, isNew: subcategoryIsNew });
  if (has(r.cuisine) && category === 'food_drink') chips.push({ key: `cuisine:${r.cuisine}`, label: cuisineLabel(r.cuisine), isNew: cuisineIsNew && cuisine === r.cuisine });
  for (const o of r.offeredOccasions ?? []) if (OFFERED_OCCASION_KEYS.includes(o)) chips.push({ key: `occ:${o}`, label: occasionLabel(o), isNew: gained.offeredOccasions.includes(o) });
  for (const t of r.partyTypes ?? []) if (PARTY_KEYS.includes(t)) chips.push({ key: `party:${t}`, label: experiencePartyTypeLabel(t), isNew: gained.partyTypes.includes(t) });
  for (const a of r.attributes ?? []) chips.push({ key: `attr:${a}`, label: businessAttributeLabel(a), isNew: gained.attributes.includes(a) });
  for (const c of r.categories ?? []) if (c !== subcategory) chips.push({ key: `also:${c}`, label: c, isNew: gained.categories.includes(c) });

  const profileChanged = categoryIsNew || subcategoryIsNew || cuisineIsNew || gained.attributes.length > 0 || gained.categories.length > 0;
  const patch = {
    profile: profileChanged ? { category, subcategory, cuisine, attributes, categories } : null,
    offeredOccasions: gained.offeredOccasions.length ? offeredOccasions : null,
    partyTypes: gained.partyTypes.length ? partyTypes : null,
  };
  return {
    chips,
    summary: chips.map((c) => c.label).join(' · '),
    patch,
    hasChanges: Boolean(patch.profile || patch.offeredOccasions || patch.partyTypes),
    understood: chips.length > 0,
  };
}

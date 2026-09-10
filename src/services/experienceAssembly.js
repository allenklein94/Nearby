// Intent engine vision -- cross-category "Experiences" assembly, first
// increment (2026-09-10), per direct user design.
//
// This is a PURE, client-side regrouping of resolveIntent()'s own already-
// fetched, already-scored, already-deduped business_availability candidates
// -- the exact same "never fetch or compute anything new, just regroup what
// resolveIntent() already found" shape HomeScreen.js's own
// groupIntentResultsByType() already uses for its cross-type tier grouping.
// No new network call, no new scoring formula, no fabricated combination:
// each candidate's own real category/subcategory/categories (now carried
// on the candidate object itself by resolveBusinessAvailability in
// intentResolver.js, specifically so this function can read them without a
// second fetch) decides which template component, if any, it belongs to. A
// component with no genuine match among the already-fetched candidates is
// silently dropped -- never padded with an unrelated result to fill a slot
// -- which is what makes a template a "recommendation recipe," not a rigid
// itinerary (see experienceTemplates.js's own header comment).
//
// Extended 2026-09-10 (same day, direct "keep going") to also include
// `gathering` candidates -- exactly the small, additive, mechanical follow-
// up this file's own header originally called out: resolveGatherings() in
// intentResolver.js now also carries `category` (the gathering's own real
// interest_tag) on its returned candidate object, same reasoning
// resolveBusinessAvailability's own category/subcategory/categories fields
// were added for. `community`/`perk`/etc. still don't carry a matching
// field and are still excluded -- extending to either of those remains a
// real, not-yet-done, separate follow-up, not implied by this one.
//
// Business-side Experience Bundles (2026-09-10, direct user request, same
// day): a business can now optionally self-declare, on its own live
// business_availability posting, that this ONE posting covers MULTIPLE
// components of a specific occasion's template by itself (e.g. a
// restaurant's own "Date Night Package" that includes dinner AND live
// music AND dessert) -- resolveBusinessAvailability carries the real
// bundle_occasion/bundle_components columns the business explicitly set
// (post_business_availability validates both) as bundleOccasion/
// bundleComponents on the candidate. This is still never a fabricated
// signal: the business itself typed and confirmed which components its one
// posting covers, the same "AI suggests, business confirms" (or here,
// business types directly, no AI involved at all) discipline as every
// other business-declared field in this schema. A bundle candidate is
// pulled out and claimed BEFORE the normal per-component loop below, so it
// never also shows up competing for a single component under its own
// row.category -- it's presented as its own distinct "one business has
// your whole night covered" unit instead. Only counts as a genuine bundle
// when it covers at least 2 of the current template's own real component
// keys (a posting that only ticked one box is just a normal candidate for
// that one component -- no special casing needed, the per-component loop
// already handles it via its own category/subcategory/categories match).
import { experienceTemplateForOccasion } from '../constants/experienceTemplates';

const EXPERIENCE_ELIGIBLE_TYPES = ['business_availability', 'gathering'];

// candidates: resolveIntent()'s own full, already-scored, already-deduped
// candidate pool (before the RESULT_CAP slice -- a real match further down
// the flat ranking should still get a real chance to fill a component,
// never limited to just the flat list's own top few).
//
// Returns null whenever there's no real occasion, no template for that
// occasion, or not a single component found genuine matching inventory --
// callers should only ever render an Experience section when this is
// truthy, so an absent Experience never becomes an empty UI shell.
export function assembleExperience(occasion, candidates) {
  const template = experienceTemplateForOccasion(occasion);
  if (!template || !Array.isArray(candidates) || candidates.length === 0) return null;

  const componentKeys = template.components.map((c) => c.key);
  const claimed = new Set();
  const bundles = [];

  // Business-side Experience Bundles: pulled out first, before the normal
  // per-component matching below, so a genuine bundle is claimed as one
  // whole unit and never also independently competes for a single
  // component under its own row.category.
  for (const c of candidates) {
    if (c.type !== 'business_availability' || claimed.has(c.id)) continue;
    if (c.bundleOccasion !== occasion) continue;
    const coveredKeys = (Array.isArray(c.bundleComponents) ? c.bundleComponents : []).filter((k) => componentKeys.includes(k));
    if (coveredKeys.length < 2) continue;
    claimed.add(c.id);
    bundles.push({
      ...c,
      componentLabels: coveredKeys.map((key) => template.components.find((comp) => comp.key === key)?.label).filter(Boolean),
    });
  }
  bundles.sort((a, b) => b.score - a.score);

  const components = [];
  for (const component of template.components) {
    const matches = candidates.filter((c) => {
      if (!EXPERIENCE_ELIGIBLE_TYPES.includes(c.type) || claimed.has(c.id)) return false;
      const rowCategories = [c.category, c.subcategory, ...(Array.isArray(c.categories) ? c.categories : [])].filter(Boolean);
      return rowCategories.some((tag) => component.categories.includes(tag));
    });
    if (matches.length === 0) continue;
    matches.forEach((m) => claimed.add(m.id));
    // Reuses each candidate's own score exactly as resolveBusinessAvailability
    // already computed it for the flat list -- a real, already-computed
    // relevance ranking, never a second invented scoring pass just for this
    // grouping.
    components.push({
      key: component.key,
      label: component.label,
      items: matches.sort((a, b) => b.score - a.score).slice(0, 3),
    });
  }

  if (components.length === 0 && bundles.length === 0) return null;
  return { title: template.title, occasion, bundles, components, claimedIds: Array.from(claimed) };
}

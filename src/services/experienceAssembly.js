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
// Deliberately business_availability-only this pass -- no other
// resolveIntent() candidate type (gathering, community, perk, ...) yet
// carries the category/subcategory/categories fields this needs to bucket
// it. Adding one is a small, additive, mechanical follow-up (that type's
// own resolver branch starts including those fields on its own candidates,
// same as resolveBusinessAvailability's now do) -- not a rework of this
// function or of experienceTemplates.js's own shape.
import { experienceTemplateForOccasion } from '../constants/experienceTemplates';

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

  const claimed = new Set();
  const components = [];
  for (const component of template.components) {
    const matches = candidates.filter((c) => {
      if (c.type !== 'business_availability' || claimed.has(c.id)) return false;
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

  if (components.length === 0) return null;
  return { title: template.title, occasion, components, claimedIds: Array.from(claimed) };
}

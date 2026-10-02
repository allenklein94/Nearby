// Typed-ask Stage 1: ELIGIBILITY (owner item 118, 2026-09-27). "Can this option satisfy the request?" answered once, before any
// ranking: Ask -> eligibility -> eligible candidates -> ranking -> displayed results. Ranking (services/intentResolver.js) runs
// only on what passes here, so a candidate that will be removed can never influence another's score (the stated-distance and
// travel-mode passes compare results with each other).
//
// This file adds NO rule. Each rule below is the existing typed-ask hard constraint, in the order the resolver always applied
// them, with its existing audit code as the canonical removal reason:
//   compatibility   a business the server's one rule says declined what the words state (kids, pets, party size, outside,
//                   walk in; item 86). A failed lookup keeps everyone.
//   open_ended      an open-ended ask keeps only its groups (supply/service businesses out; utils/openEndedAsk.js)
//   category_narrow a Browse category tapped on the ask keeps only results confirmed in that group (item 108)
//   ask_facets      a firm "outside"/"indoors" removes KNOWN opposites; "no alcohol" / "nothing crowded" remove KNOWN conflicts
//   open_now        "what's open" / the Open-now chip keeps only confirmed-usable results (item 71)
// Unknown stays eligible everywhere (an unknown category, environment or opening status is never a failure).
// Not considered here, for their own existing reasons: what each source never returned (the server's radius, category and
// posting-capacity filters, the gathering date window and asked category applied while fetching), and the weaker duplicate of
// a business already shown at a stronger tier (`dedupe`, counted separately).
import { applyRestrictionsToCandidates, askRaisesRestriction } from '../constants/businessRestrictions';
import { openEndedEligible } from './openEndedAsk';
import { narrowToGroup } from './categoryNarrow';
import { askFacetsEligible } from '../constants/askFacets';
import { filterOpenNow } from './operatingStatus';

export const ELIGIBILITY_RULES = ['compatibility', 'open_ended', 'category_narrow', 'ask_facets', 'open_now'];

// ctx: { restrictionFacts, declinedLookup(ids, facts) -> Map, isPartnerResult(c), isBusiness(c), openEndedGroups,
//        narrowGroup, facets, openNowOnly, toEntity(c), envOf(c) (a candidate's declared side, constants/environmentMatch.js) }
// Returns { items, removed: { rule: count }, compatibilityCaption, removedOpposite, removedUnknown }.
export async function runAskEligibility(candidates, ctx = {}) {
  let items = Array.isArray(candidates) ? candidates : [];
  const removed = {};
  const apply = (rule, next) => {
    const n = items.length - next.length;
    if (n > 0) removed[rule] = (removed[rule] ?? 0) + n;
    items = next;
  };

  let compatibilityCaption = null;
  if (askRaisesRestriction(ctx.restrictionFacts) && typeof ctx.declinedLookup === 'function') {
    try {
      const isPartnerResult = ctx.isPartnerResult ?? (() => false);
      const declined = await ctx.declinedLookup(items.filter(isPartnerResult).map((c) => c.partnerId), ctx.restrictionFacts);
      const out = applyRestrictionsToCandidates(items, declined, { partnerIdOf: (c) => (isPartnerResult(c) ? c.partnerId : null), isBusiness: ctx.isBusiness ?? (() => true) });
      compatibilityCaption = out.caption;
      apply('compatibility', out.items);
    } catch (e) {
      console.error('restriction check skipped', e);
    }
  }

  // A result whose DECLARED side is the one the words asked for ("something outside" + a patio restaurant) answers the ask
  // even outside the routed groups; the open-ended group limit is about category, not about overruling a declared match.
  const askedEnv = ctx.facets?.environment ?? null;
  const declaredMatch = (c) => !!(askedEnv && ctx.envOf && ctx.envOf(c) === askedEnv);
  const openEndedKept = new Set(openEndedEligible(items, ctx.openEndedGroups ?? null));
  apply('open_ended', items.filter((c) => openEndedKept.has(c) || declaredMatch(c)));
  apply('category_narrow', narrowToGroup(items, ctx.narrowGroup ?? null));

  const facets = askFacetsEligible(items, ctx.facets ?? null, ...(ctx.envOf ? [ctx.envOf] : []));
  apply('ask_facets', facets.items);

  if (ctx.openNowOnly && typeof ctx.toEntity === 'function') apply('open_now', filterOpenNow(items, ctx.toEntity));

  return { items, removed, compatibilityCaption, removedOpposite: facets.removedOpposite, removedUnknown: facets.removedUnknown };
}

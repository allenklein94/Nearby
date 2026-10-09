// Screen-reduction audit B2 (owner, 2026-10-08): PlanDetail is kept ONLY for plans that combine several objects (a night
// out with stops, an occasion and what was planned for it). A plan that IS one gathering, one business request or one match
// already has its own screen, so it opens there instead of on a second summary of the same thing.
//   multi-object plan types : experience, occasion, group_occasion, and the older occasion kinds birthday / anniversary
//   single-object plan types: gathering, friend_hangout (a gathering), business_request, dating_match / friend_match (the
//                             match's chat), dating_date (the date proposal)
const MULTI_OBJECT_PLAN_TYPES = new Set(['experience', 'occasion', 'group_occasion', 'birthday', 'anniversary']);

export function isMultiObjectPlanType(planType) {
  return MULTI_OBJECT_PLAN_TYPES.has(planType);
}

// The canonical screen for a single-object plan, from its overview (services/plans.js normalizePlanOverview);
// null = render it on PlanDetail (a multi-object plan, or a single-object plan whose object is not readable/linked).
export function canonicalPlanDestination(overview) {
  const type = overview?.plan?.plan_type;
  if (!type || isMultiObjectPlanType(type)) return null;
  if ((type === 'gathering' || type === 'friend_hangout') && overview.activity?.kind === 'gathering' && overview.activity.id) {
    return { name: 'GatheringDetail', params: { gatheringId: overview.activity.id } };
  }
  if (type === 'business_request' && overview.businessRequest?.id) {
    return { name: 'BusinessRequestDetail', params: { requestId: overview.businessRequest.id } };
  }
  if ((type === 'dating_match' || type === 'friend_match') && overview.match?.id) {
    return { name: 'Chat', params: { matchId: overview.match.id } };
  }
  if (type === 'dating_date' && overview.match?.id) {
    return { name: 'DateProposal', params: { matchId: overview.match.id, matchName: overview.match.other_display_name ?? null } };
  }
  return null;
}

// "Part of: {title}" from a gathering or request up to the plan that combines it with other things (a night out, an
// occasion). A match's plan is not shown as a parent: the match is its chat, where the person already came from.
export function multiObjectParent(overview) {
  const parent = overview?.parent;
  return parent?.id && isMultiObjectPlanType(parent.plan_type) ? parent : null;
}

// The universal recommendation context object (owner item 135, 2026-09-28). Every recommended thing carries five answers, built
// ONLY by composing the existing single sources, never a second copy of their rules:
//   entity       What is being recommended?   { kind, id, title }            (the canonical object by id, item 134)
//   reason       Why?                          "Good for grabbing a coffee"   (the real signal that ranked it, rule 2)
//   context      Why now?                      "1.1 mi · Tonight · 6:30 PM"   (formatDistance + the one time engine)
//   destination  Where does tapping go?        { kind: 'navigate', screen, params } | { kind: 'url', url }
//   action       What can I do?                { kind, label }                (primaryAction.js / businessAction.js)
// A part is null when there is no real data for it (rule 7); `fields` lists the parts present. Pure (no React Native), so every
// surface follows the same object and the mapping is tested once. navigateToIntentResultItem taps through `destination`.
import { formatDistance } from './formatDistance';
import { timeWindowState, windowPhrase } from './timeWindow';
import { gatheringPrimaryAction } from './primaryAction';
import { BUSINESS_RESULT_TYPES, businessActionForItem, intentResultBusinessRoute } from './businessAction';

export const CONTEXT_FIELDS = ['entity', 'reason', 'context', 'destination', 'action'];

// Reasons that only restate distance or time are the CONTEXT line, never the reason.
const RESTATES_CONTEXT = /^(\d[\d.,]*\s*(mi|ft)\b|under 100 ft|close by|very close|happening (now|today)|starting soon|starts in|today|tonight|tomorrow)/i;

function firstReason(item) {
  const list = Array.isArray(item?.reasons) ? item.reasons : [];
  return list.find((r) => r && !RESTATES_CONTEXT.test(String(r).trim())) ?? null;
}

function whenFor(item, now) {
  if (item?.type === 'gathering' && item.startsAt) {
    return timeWindowState({ start: item.startsAt, durationMinutes: item.durationMinutes }, now, 'event').label ?? null;
  }
  if (item?.type === 'business_availability' && (item.postingStartsAt || item.postingEndsAt)) {
    return windowPhrase(item.postingStartsAt, item.postingEndsAt, 'availability', now);
  }
  return null;
}

// Where a typed-ask result goes when tapped (the ONE mapping; side effects such as view logging stay with the caller).
export function intentResultDestination(item, { typedText, classifyResult, submissionId, at = new Date() } = {}) {
  if (!item) return null;
  switch (item.type) {
    case 'gathering': return { kind: 'navigate', screen: 'GatheringDetail', params: { gatheringId: item.id } };
    case 'perk': return { kind: 'navigate', screen: 'BrandOffers', params: { highlightOfferId: item.id } };
    case 'friend_request': return { kind: 'navigate', screen: 'ViewProfile', params: { userId: item.userId } };
    case 'community': return { kind: 'navigate', screen: 'CommunityDetail', params: { communityId: item.id } };
    case 'friend_discovery': return { kind: 'navigate', screen: 'FriendDiscovery', params: undefined };
    default:
      return BUSINESS_RESULT_TYPES.includes(item.type) ? intentResultBusinessRoute(item, { typedText, classifyResult, submissionId, at }) : null;
  }
}

// The action a result offers. A business with a declared booking mode says Go now / Reserve / Book / Request; one without opens
// the request form, which returns an offer ("Get an offer", the global rule 4 wording). A gathering's action comes from its real
// viewer state (an unknown state = View, never a wrong Join). Everything else navigates without a separate action.
function actionFor(item, { myUserId = null, now = new Date() } = {}) {
  if (!item) return null;
  if (item.type === 'gathering') {
    return gatheringPrimaryAction({ ...item, scheduled_at: item.startsAt ?? item.scheduled_at }, myUserId, now.getTime ? now.getTime() : now);
  }
  if (BUSINESS_RESULT_TYPES.includes(item.type)) {
    const booked = businessActionForItem(item, now);
    return booked ?? { kind: 'request', label: 'Get an offer' };
  }
  return null;
}

export function recommendationContext(item, opts = {}) {
  const now = opts.now instanceof Date ? opts.now : new Date(opts.now ?? Date.now());
  if (!item || !item.type) return { entity: null, reason: null, context: null, destination: null, action: null, fields: [] };
  const context = [formatDistance(item.distanceMiles), whenFor(item, now)].filter(Boolean).join(' · ') || null;
  const model = {
    entity: { kind: item.type, id: item.id ?? null, title: item.title ?? null },
    reason: firstReason(item),
    context,
    destination: intentResultDestination(item, { ...opts, at: now }),
    action: actionFor(item, { myUserId: opts.myUserId ?? null, now }),
  };
  return { ...model, fields: CONTEXT_FIELDS.filter((f) => model[f]) };
}

// The action label a typed-ask result ROW shows beside its chevron (Home, Discover). Business results only, as before item 135,
// now including "Get an offer" for a business with no declared booking mode; gathering rows keep their plain chevron (the
// gathering screen carries its Join / View Plan).
export function resultRowAction(item, opts = {}) {
  if (!item || !BUSINESS_RESULT_TYPES.includes(item.type)) return null;
  return recommendationContext(item, opts).action;
}

// The universal recommendation context object (owner item 135, 2026-09-28). Every recommended thing carries five answers, built
// ONLY by composing the existing single sources, never a second copy of their rules:
//   entity       What is being recommended?   { kind, id, title }            (the canonical object by id, item 134)
//   reason       Why?                          "Good for grabbing a coffee"   (the real signal that ranked it, rule 2)
//   context      Why now?                      "1.1 mi · Tonight · 6:30 PM"   (formatDistance + the one time engine)
//   destination  Where does tapping go?        { kind: 'navigate', screen, params } | { kind: 'url', url }
//   action       What can I do?                { kind, label }                (primaryAction.js / businessAction.js)
// A part is null when there is no real data for it (rule 7); `fields` lists the parts present. Pure (no React Native), so every
// surface follows the same object and the mapping is tested once. Taps go through services/openDestination.js.
//
// Shared context layer (owner, 2026-09-28): EVERY consumer recommendation surface reads this object -- typed-ask and Surprise Me
// rows (resultRowView), Home's Picked For You cards and Best Pick hero (gatheringCardModel, perk rows), Discover's browse cards.
// A surface that starts from a raw row (a gathering, perk, community, business, request or offer) passes it through
// contextItem(kind, row, { reasons }) first, so the reason / context / destination / action rules exist once. Surfaces may look
// different; they never decide these four things themselves.
import { formatDistance } from './formatDistance';
import { timeWindowState, windowPhrase } from './timeWindow';
import { gatheringPrimaryAction, offerPrimaryAction } from './primaryAction';
import { isContextRestatement } from '../constants/recommendationReasonVocabulary';
import { localizeReasons, localizeNote, localizeTitle } from './reasonLocalization';
import { localDistance, localWindow } from '../i18n/format';
import { translate, DEFAULT_LANGUAGE } from '../i18n/translate';
import { BUSINESS_RESULT_TYPES, businessActionForItem, intentResultBusinessRoute } from './businessAction';
import { buildDirectionsUrl } from './planLogisticsActions';

export const CONTEXT_FIELDS = ['entity', 'reason', 'context', 'destination', 'action'];

// Reasons that only restate distance or time are the CONTEXT line, never the reason (isContextRestatement decides which).

// Every real explanation the item carries, in its ranked order, minus distance/time restatements and duplicates.
export function validReasons(item) {
  const list = Array.isArray(item?.reasons) ? item.reasons : [];
  const out = [];
  for (const r of list) {
    const text = typeof r === 'string' ? r.trim() : '';
    if (!text || isContextRestatement(text) || out.includes(text)) continue;
    out.push(text);
  }
  return out;
}

// The when half of the context line. English reads the time engine's own label; another language words the SAME decision
// (i18n/format.js localWindow reads timeWindowParts), so the two can never disagree on phase.
function whenFor(item, now, language = DEFAULT_LANGUAGE) {
  const english = !language || language === DEFAULT_LANGUAGE;
  if (item?.type === 'gathering' && item.startsAt) {
    // a finished gathering (a friend's past plan) says so plainly instead of dropping its time
    const win = { start: item.startsAt, durationMinutes: item.durationMinutes };
    const st = timeWindowState(win, now, 'event');
    if (st.phase === 'over') return english ? 'Already happened' : translate(language, 'vocab.when.alreadyHappened');
    return english ? st.label ?? null : localWindow(win, now, 'event', language);
  }
  if (item?.type === 'business_availability' && (item.postingStartsAt || item.postingEndsAt)) {
    return english
      ? windowPhrase(item.postingStartsAt, item.postingEndsAt, 'availability', now)
      : localWindow({ start: item.postingStartsAt, end: item.postingEndsAt }, now, 'availability', language);
  }
  return null;
}

// "1.2 mi" in English; the same figure in the person's words otherwise (miles stay miles, i18n/format.js).
const distanceFor = (miles, language) => (!language || language === DEFAULT_LANGUAGE ? formatDistance(miles) : localDistance(miles, language));

// Where a typed-ask result goes when tapped (the ONE mapping; side effects such as view logging stay with the caller).
export function intentResultDestination(item, { typedText, classifyResult, submissionId, at = new Date() } = {}) {
  if (!item) return null;
  switch (item.type) {
    case 'gathering': return item.id ? { kind: 'navigate', screen: 'GatheringDetail', params: { gatheringId: item.id } } : null;
    case 'perk': return item.id ? { kind: 'navigate', screen: 'BrandOffers', params: { highlightOfferId: item.id } } : null;
    case 'friend_request': return item.userId ? { kind: 'navigate', screen: 'ViewProfile', params: { userId: item.userId } } : null;
    case 'community': return item.id ? { kind: 'navigate', screen: 'CommunityDetail', params: { communityId: item.id, ...(item.title ? { communityName: item.title } : {}) } } : null;
    case 'business': return item.id ? { kind: 'navigate', screen: 'BusinessProfile', params: { partnerId: item.id } } : null;
    case 'business_request': return item.id ? { kind: 'navigate', screen: 'BusinessRequestDetail', params: { requestId: item.id } } : null;
    case 'business_offer': return item.requestId ? { kind: 'navigate', screen: 'BusinessRequestDetail', params: { requestId: item.requestId } } : null;
    // A Google place: directions only (from its own coordinates, else its address); nothing known = no destination.
    case 'place': {
      const url = buildDirectionsUrl({ latitude: item.latitude, longitude: item.longitude, address: item.address, placeId: item.placeId });
      return url ? { kind: 'url', url } : null;
    }
    // A sponsored placement opens the thing it promotes; it shares the destination rule, never ranking or reasons.
    case 'sponsored':
      if (item.itemKind === 'offer') return item.itemId ? { kind: 'navigate', screen: 'BrandOffers', params: { highlightOfferId: item.itemId } } : null;
      return item.partnerId ? { kind: 'navigate', screen: 'BusinessProfile', params: { partnerId: item.partnerId } } : null;
    case 'friend_discovery': return { kind: 'navigate', screen: 'FriendDiscovery', params: undefined };
    default:
      return BUSINESS_RESULT_TYPES.includes(item.type) ? intentResultBusinessRoute(item, { typedText, classifyResult, submissionId, at }) : null;
  }
}

// The action a result offers. A business with a declared booking mode says Go now / Reserve / Book / Request; one without opens
// the request form, which returns an offer ("Get an offer", the global rule 4 wording). A gathering's action comes from its real
// viewer state (an unknown state = View, never a wrong Join). Everything else navigates without a separate action.
function actionFor(item, { myUserId = null, now = new Date(), actionOpts = {} } = {}) {
  if (!item) return null;
  if (item.type === 'gathering') {
    if (!item.id) return null;
    return gatheringPrimaryAction({ ...item, scheduled_at: item.startsAt ?? item.scheduled_at }, myUserId, now.getTime ? now.getTime() : now, actionOpts);
  }
  // a perk card that knows the viewer's redemption state: Redeem, or the Redeemed status (a typed-ask row does not know it: none)
  if (item.type === 'perk') {
    if (item.redeemed === true) return { kind: 'status', label: 'Redeemed ✓', status: 'Redeemed ✓' };
    return item.redeemed === false && item.id ? { kind: 'redeem', label: 'Redeem' } : null;
  }
  // an offer in a feed: View Offer only while it can still be taken (the lifecycle table decides; expired = none)
  if (item.type === 'business_offer') return item.requestId ? offerPrimaryAction(item.offer ?? item) : null;
  if (BUSINESS_RESULT_TYPES.includes(item.type)) {
    const booked = businessActionForItem(item, now);
    return booked ?? { kind: 'request', label: 'Get an offer' };
  }
  return null;
}

export function recommendationContext(item, opts = {}) {
  const now = opts.now instanceof Date ? opts.now : new Date(opts.now ?? Date.now());
  if (!item || !item.type) return { entity: null, reason: null, context: null, destination: null, action: null, reasons: [], canonicalReasons: [], fields: [] };
  const context = [distanceFor(item.distanceMiles, opts.language), whenFor(item, now, opts.language)].filter(Boolean).join(' · ') || null;
  // selection happens on the canonical English reasons; only the shown text is put in the person's language (opts.language)
  const canonical = validReasons(item);
  const reasons = localizeReasons(canonical, opts.language);
  const model = {
    entity: { kind: item.type, id: item.id ?? null, title: item.title ?? null },
    reason: reasons[0] ?? null,
    context,
    destination: intentResultDestination(item, { ...opts, at: now }),
    action: actionFor(item, { myUserId: opts.myUserId ?? null, now, actionOpts: opts.actionOpts ?? {} }),
  };
  // `reasons` = every valid reason (a card with room may show several; `reason` is always the first of them)
  return { ...model, reasons, canonicalReasons: canonical, fields: CONTEXT_FIELDS.filter((f) => model[f]) };
}

// The action label a typed-ask result ROW shows beside its chevron (Home, Discover). Business results only, as before item 135,
// now including "Get an offer" for a business with no declared booking mode; gathering rows keep their plain chevron (the
// gathering screen carries its Join / View Plan).
export function resultRowAction(item, opts = {}) {
  if (!item || !BUSINESS_RESULT_TYPES.includes(item.type)) return null;
  return recommendationContext(item, opts).action;
}

// ---------------------------------------------------------------------------------------------------------------------------
// Raw rows -> the one item shape. A surface that holds a database row (not a typed-ask result) converts it here; `reasons` are
// the real explanations the surface already earned for it (built by constants/recommendationReasonVocabulary.js), in order.
export const CONTEXT_KINDS = ['gathering', 'perk', 'community', 'business', 'business_request', 'business_offer', 'place', 'sponsored'];
// Kinds that never carry a recommendation reason: a Google place (no Nearby signal), a sponsored placement (paid, its own
// disclosure), a request or an offer (transactional: the row says what happened, not why it was shown).
export const REASONLESS_KINDS = ['place', 'sponsored', 'business_request', 'business_offer'];

export function contextItem(kind, row, { reasons = [], ...extra } = {}) {
  if (!row || !CONTEXT_KINDS.includes(kind)) return null;
  const list = REASONLESS_KINDS.includes(kind) ? [] : (Array.isArray(reasons) ? reasons : [reasons]).filter(Boolean);
  const distanceMiles = row.distanceMiles ?? row.distance_miles ?? null;
  switch (kind) {
    case 'gathering':
      // the raw row rides along so the gathering's real viewer state (host, attendees, capacity, approval) drives the action
      return { ...row, type: 'gathering', id: row.id ?? null, title: row.title ?? null, startsAt: row.scheduled_at ?? row.startsAt ?? null,
        durationMinutes: row.duration_minutes ?? row.durationMinutes ?? null, distanceMiles, reasons: list };
    case 'perk':
      return { type: 'perk', id: row.id ?? null, title: row.title ?? null, partnerId: row.partner_id ?? row.partnerId ?? null, distanceMiles, reasons: list,
        ...(typeof extra.redeemed === 'boolean' ? { redeemed: extra.redeemed } : {}) };
    case 'community':
      return { type: 'community', id: row.id ?? null, title: row.name ?? row.title ?? null, distanceMiles, reasons: list };
    case 'business':
      return { type: 'business', id: row.id ?? null, title: row.name ?? row.title ?? null, distanceMiles, reasons: list };
    case 'business_request':
      return { type: 'business_request', id: row.id ?? null, title: row.title ?? null, reasons: list };
    case 'place':
      // no booking mode and no reason are ever invented for a Google result; rating / price / open now stay the card's own facts
      return { type: 'place', id: row.placeId ?? row.id ?? null, placeId: row.placeId ?? null, title: row.name ?? row.title ?? null,
        latitude: row.latitude ?? null, longitude: row.longitude ?? null, address: row.address ?? null, distanceMiles, reasons: list };
    case 'sponsored':
      return { type: 'sponsored', id: row.placement_id ?? null, title: row.title ?? null, itemKind: row.item_kind ?? null,
        itemId: row.item_id ?? null, partnerId: row.partner_id ?? null, reasons: list };
    case 'business_offer':
      return { type: 'business_offer', id: row.id ?? null, title: row.title ?? row.offer_title ?? null, requestId: row.request_id ?? row.requestId ?? null,
        offer: row, reasons: list };
    default: return null;
  }
}

const COMPOSED_TITLE_TYPES = ['business_availability', 'business_policy_match', 'friend_request'];

// The row a typed-ask or Surprise Me result renders (Home and Discover): the context's reason, its when/where line, the item's
// own status note (price, "business confirmation required", a full gathering's waitlist line) only when it is NOT an explanation
// already shown, and the action. The resolver's `subtitle` is a detail line, never a second explanation system.
export function resultRowView(item, opts = {}) {
  const c = recommendationContext(item, opts);
  let note = typeof item?.subtitle === 'string' && item.subtitle.trim() ? item.subtitle.trim() : null;
  if (note) {
    const parts = note.split(' · ').filter((p) => !c.canonicalReasons.includes(p.trim()));
    note = parts.length ? localizeNote(parts.join(' · '), opts.language) : null;
  }
  return {
    // only the kinds whose title Nearby composes; everyone else's title is their own words, never re-read
    title: COMPOSED_TITLE_TYPES.includes(item?.type) ? localizeTitle(item?.title ?? null, opts.language) : item?.title ?? null,
    reason: c.reason,
    meta: [c.context, note].filter(Boolean).join(' · ') || null,
    warn: Boolean(item?.isFull),
    action: BUSINESS_RESULT_TYPES.includes(item?.type) ? c.action : null,
    destination: c.destination,
  };
}

// A Home recommendation row ({ type: 'gathering' | 'perk', id, title, reasons, data }, buildHomeRecommendations) -> the one item.
export function contextItemFromRecommendation(item) {
  if (!item) return null;
  return contextItem(item.type, { ...(item.data ?? {}), id: item.id, title: item.title }, { reasons: item.reasons ?? [] });
}

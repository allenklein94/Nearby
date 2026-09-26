// One business action everywhere (owner item 72 correction, 2026-09-26). The action comes from businessPrimaryAction
// (utils/primaryAction.js: booking_mode -> Go now / Get Directions / Reserve / Book / Request); this file turns it into the ONE
// route every surface follows -- the business profile, typed-ask results on Home and Discover (navigateToIntentResultItem) and
// Surprise Me. Pure (no React Native), so the mapping is tested once and no surface builds its own.
import { businessPrimaryAction } from './primaryAction';
import { bookingModeOf } from '../constants/bookingMode';
import { buildDirectionsUrl } from './planLogisticsActions';

export const BUSINESS_RESULT_TYPES = ['business_availability', 'business_policy_match', 'business_occasion_package'];

// A live posting on a typed-ask result, in the shape the open-now resolver reads.
function postingOf(item) {
  if (item?.type !== 'business_availability') return null;
  return { startsAt: item.postingStartsAt ?? null, endsAt: item.postingEndsAt ?? null, remainingCapacity: item.matchedAvailability?.remainingCapacity ?? null };
}

// The action a typed-ask business result carries, or null (no declared mode, no partner snapshot, not a business). The resolver
// attaches `businessPartner` (the brand_partners row) to every business result; perks never get one (they stay independent).
export function businessActionForItem(item, at = new Date()) {
  if (!item || !BUSINESS_RESULT_TYPES.includes(item.type) || !item.businessPartner) return null;
  return businessPrimaryAction(item.businessPartner, { posting: postingOf(item), at });
}

// action -> { kind: 'url', url } | { kind: 'navigate', screen, params }. Reserve / Book / Request open the EXISTING request form:
// addressed to this one business (targetPartner), or, when the result is that business's own live posting, bound to the posting
// (matchedAvailability), which already reaches only that business. `prefill` = the AskBusiness prefill params of the surface.
export function businessActionRoute(action, { partner, partnerId, prefill = {}, matchedAvailability = null } = {}) {
  if (!action || !partner) return null;
  if (action.kind === 'go_now' || action.kind === 'directions') {
    return { kind: 'url', url: buildDirectionsUrl({ latitude: partner.latitude, longitude: partner.longitude, address: partner.address }) };
  }
  if (!['reserve', 'book', 'request'].includes(action.kind)) return null;
  const id = partnerId ?? partner.id;
  const params = { ...prefill, bookingMode: bookingModeOf(partner) };
  if (matchedAvailability) return { kind: 'navigate', screen: 'AskBusiness', params: { ...params, matchedAvailability } };
  return { kind: 'navigate', screen: 'AskBusiness', params: { ...params, targetPartner: { id, name: partner.name }, matchedAvailability: null } };
}

// The route for a typed-ask business result: the booking-mode route when the business declared one, else the pre-item-72 default
// (the general request form, with the posting bound when the result is a posting).
export function intentResultBusinessRoute(item, { typedText, classifyResult, at = new Date() } = {}) {
  const prefill = {
    prefillText: typedText ?? '',
    prefillCategory: classifyResult?.category ?? item?.category ?? null,
    prefillPartySize: classifyResult?.partySize ?? null,
    prefillBudgetMax: classifyResult?.budgetMax ?? null,
    prefillDateWindow: classifyResult?.dateWindow ?? null,
    prefillOccasion: classifyResult?.occasion ?? null,
  };
  const matchedAvailability = item?.type === 'business_availability' ? item.matchedAvailability ?? null : null;
  const booked = businessActionRoute(businessActionForItem(item, at), {
    partner: item?.businessPartner, partnerId: item?.partnerId, prefill, matchedAvailability,
  });
  if (booked) return booked;
  return { kind: 'navigate', screen: 'AskBusiness', params: { ...prefill, matchedAvailability } };
}

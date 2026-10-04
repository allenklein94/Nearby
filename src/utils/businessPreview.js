// The business sheet's content (owner item 17, 2026-10-04, LOCKED): a lightweight contextual PREVIEW of a business on Discover's
// browsing surfaces (business result rows, map pins), never a mini Business Profile and never a screen. Pure, so it is tested
// once. Every line is shown only when it is real: the measured distance, the open status from the owner's declared hours, up to
// two qualities the business itself declared. The action is the SAME one the business profile shows (businessPrimaryAction,
// items 72/73: Go now / Get Directions / Reserve / Book / Request), else "Get an offer" (a request addressed to this one
// business), never a hardcoded label. No business data is fetched or derived here beyond what the row already carries.
import { businessPrimaryAction } from './primaryAction';
import { businessActionRoute } from './businessAction';
import { formatDistance } from './formatDistance';
import { localDistance } from '../i18n/format';
import { hoursLine, businessAttributeName } from '../i18n/businessProfileDisplay';
import { translate, DEFAULT_LANGUAGE } from '../i18n/translate';

export const PREVIEW_MAX_QUALITIES = 2;
// Stored for older data but never shown as a quality (item 72: superseded by the booking mode).
const HIDDEN_QUALITIES = new Set(['reservation_required']);

export function businessPreview(partner, { language = DEFAULT_LANGUAGE, at = new Date() } = {}) {
  if (!partner?.id) return null;
  const miles = partner.distanceMiles ?? null;
  const distance = !language || language === DEFAULT_LANGUAGE ? formatDistance(miles) : localDistance(miles, language);
  const qualities = (Array.isArray(partner.attributes) ? partner.attributes : [])
    .filter((k) => k && !HIDDEN_QUALITIES.has(k))
    .slice(0, PREVIEW_MAX_QUALITIES)
    .map((k) => businessAttributeName(k, language))
    .filter(Boolean);
  const booked = businessPrimaryAction(partner, { at });
  const action = booked
    ? { kind: booked.kind, label: booked.label }
    : { kind: 'get_offer', label: translate(language, 'ui.businessProfile.getAnOffer') };
  return {
    id: partner.id,
    title: partner.name ?? null,
    distance: distance || null,
    hours: hoursLine(partner, language, at) || null,
    qualities,
    action,
  };
}

// Where the sheet's action goes: the booking-mode route the profile uses, else the request form addressed to this one business
// (the profile's "Get an offer"). Same prefill as the profile (the business's own type).
export function businessPreviewRoute(partner, action) {
  if (!partner?.id || !action) return null;
  const prefill = { prefillCategory: partner.subcategory ?? null };
  if (action.kind === 'get_offer') {
    return { kind: 'navigate', screen: 'AskBusiness', params: { ...prefill, targetPartner: { id: partner.id, name: partner.name } } };
  }
  return businessActionRoute(action, { partner, partnerId: partner.id, prefill });
}

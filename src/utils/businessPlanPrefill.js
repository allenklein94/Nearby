// "Make a plan" at a business (owner, 2026-10-08, screen-reduction audit B4): every entry that used to open the separate
// MakeAPlan screen (a Home perk row, the occasion recall "Return to X", a business profile, the business_recall_outreach
// push) now opens the ONE gathering-creation flow, CreateGathering, with `fromBusiness: { offerId?, partnerId?, title? }`.
// CreateGathering loads the offer / business and fills the form from this function; every value stays editable and the
// normal steps (required category, visibility, approval, capacity...) apply. Nothing here is guessed:
//   title       = the perk's title "at" the business, else a title the caller already had (an occasion's own name), else empty
//   category    = the perk's target tag, else the business's own declared primary type, else its declared secondary types;
//                 only a real consumer tag (a business-only tag such as Dental never becomes a gathering's activity);
//                 none = empty, and the What step asks for it (the old MakeAPlan created gatherings with no category)
//   description = the perk's own description, else empty
//   place       = the perk's own coordinates, else the business's, named after the business; none = no place
import { groupForTag, isBusinessOnlyTag } from '../constants/gatheringCategories';

function consumerTag(tag) {
  return typeof tag === 'string' && !!groupForTag(tag) && !isBusinessOnlyTag(tag) ? tag : null;
}

function coord(v) {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

export function businessPlanPrefill({ offer = null, partner = null, title = null } = {}) {
  const business = offer?.brand_partners ?? partner ?? null;
  const name = typeof business?.name === 'string' && business.name.trim() ? business.name.trim() : null;

  let planTitle = '';
  if (offer?.title) planTitle = name ? `${offer.title} at ${name}` : offer.title;
  else if (typeof title === 'string' && title.trim()) planTitle = title.trim();

  const candidates = [offer?.target_interest_tag, business?.subcategory, ...(Array.isArray(business?.categories) ? business.categories : [])];
  const category = candidates.map(consumerTag).find(Boolean) ?? null;

  const lat = coord(offer?.latitude) ?? coord(business?.latitude);
  const lng = coord(offer?.latitude) != null ? coord(offer?.longitude) : coord(business?.longitude);
  const place = lat != null && lng != null ? { latitude: lat, longitude: lng, name } : null;

  const description = typeof offer?.description === 'string' && offer.description.trim() ? offer.description.trim() : null;

  return { title: planTitle, category, description, place, businessName: name };
}

// The route params every "Make a plan" entry passes to CreateGathering (one shape, so callers never drift).
export function createFromBusinessParams({ offerId = null, partnerId = null, title = null } = {}) {
  if (!offerId && !partnerId) return null;
  return { fromBusiness: { offerId: offerId ?? null, partnerId: partnerId ?? null, title: title ?? null } };
}

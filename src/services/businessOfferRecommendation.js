// Business Intelligence & Opportunity Engine, Phase 3 (see CLAUDE.md's own
// plan) -- a real, deterministic, non-LLM offer-recommendation ranking.
// Pure functions, no I/O, same "fully testable" shape as
// businessOpportunityScoring.js/homeRecommendations.js -- reuses the same
// shared SCORE_* weights rather than inventing a new scale.
//
// Ranks the business's own real, active Signature Experiences
// (business_experiences) against one open opportunity (business_requests),
// by real attribute/party-type/price-level fit plus a real fulfillment-
// policy fit -- and separately, ranks the business's own five real offer
// types (standard/discount/perk/upgrade/alt_time) by their own real
// historical acceptance rate for this one partner, computed entirely from
// data BusinessDashboardScreen already has loaded (this partner's own
// full business_request_offers history) -- no new query, no new schema,
// matching Phase 2's own "computed at read time" precedent.
//
// Deliberately never invents a dollar price: an experience's own
// price_level ('$', '$$', ...) is a real, owner-set signal used only for
// matching, never converted into a fabricated numeric offer price --
// matches this schema's own established "price_level is never guessed"
// rule from the Signature Experiences design itself. The business always
// types their own real offer_price, same as every other offer.
import { SCORE_INTEREST_MATCH, SCORE_CLOSE_DISTANCE, SCORE_HAPPENING_NOW } from './intentResolverScoring';
import { occasionLabel } from '../constants/businessAttributes';

export const MAX_OFFER_SUGGESTIONS = 3;

// A rate computed from fewer than this many real responded offers of a
// given type reads as noise, not a signal (a lone 1-of-1 100% is not a
// real pattern) -- matches formatPartnerReliabilityLine's own 3+ minimum
// sample for a comparably narrow slice of history (its rated_count >= 3
// rule, businessFulfillment.js).
const MIN_OFFER_TYPE_SAMPLE = 3;

const OFFER_TYPES = ['standard', 'discount', 'perk', 'upgrade', 'alt_time'];

// Real, per-offer-type acceptance rate for this one partner, from their
// own full opportunity history (business_request_offers rows already
// fetched by getBusinessOpportunities) -- never a marketplace-wide
// number, always this business's own real track record. Silent (no key
// in the returned object) for any type with too few real responses to
// say anything honest.
export function computeOfferTypeAcceptanceRates(allOffers = []) {
  const rates = {};
  for (const type of OFFER_TYPES) {
    const responded = allOffers.filter((o) => o.offer_type === type && o.responded_at);
    if (responded.length < MIN_OFFER_TYPE_SAMPLE) continue;
    const accepted = responded.filter((o) => o.status === 'accepted' || o.status === 'completed').length;
    rates[type] = { rate: Math.round((accepted / responded.length) * 100), sampleSize: responded.length };
  }
  return rates;
}

// The single best-performing real offer type for this partner, or null
// when no type has enough real history yet to say anything honest.
export function bestAcceptedOfferType(offerTypeAcceptance = {}) {
  const entries = Object.entries(offerTypeAcceptance);
  if (entries.length === 0) return null;
  const [offerType, stats] = entries.reduce((best, entry) => (entry[1].rate > best[1].rate ? entry : best));
  return { offerType, rate: stats.rate, sampleSize: stats.sampleSize };
}

function scoreExperience({
  experience,
  requestAttributes,
  requestPartyType,
  requestPriceLevel,
  requestPartySize,
  fulfillmentPolicy,
}) {
  const reasons = [];
  let score = 0;

  const attrs = experience.attributes ?? [];
  if (attrs.some((a) => requestAttributes.includes(a))) {
    score += SCORE_INTEREST_MATCH;
    reasons.push({ label: 'Matches what this request is looking for', points: SCORE_INTEREST_MATCH });
  }

  if (requestPartyType && experience.party_type && experience.party_type === requestPartyType) {
    score += SCORE_INTEREST_MATCH;
    reasons.push({ label: 'Matches who this is for', points: SCORE_INTEREST_MATCH });
  }

  if (requestPriceLevel && experience.price_level && experience.price_level === requestPriceLevel) {
    score += SCORE_HAPPENING_NOW;
    reasons.push({ label: 'Matches the price range they mentioned', points: SCORE_HAPPENING_NOW });
  }

  if (
    requestPartySize != null &&
    fulfillmentPolicy?.party_size_min != null &&
    fulfillmentPolicy?.party_size_max != null &&
    requestPartySize >= fulfillmentPolicy.party_size_min &&
    requestPartySize <= fulfillmentPolicy.party_size_max
  ) {
    score += SCORE_CLOSE_DISTANCE;
    reasons.push({ label: 'Within your usual party size range', points: SCORE_CLOSE_DISTANCE });
  }

  return { score, reasons };
}

// Ranks the business's own real, active Signature Experiences against one
// real open opportunity. Only ever returns an experience that genuinely
// scored above zero -- a business with no matching experience gets an
// honest empty list, never a padded "here are all your experiences again"
// fallback.
export function rankExperiencesForOpportunity({
  requestAttributes = [],
  requestPartyType = null,
  requestPriceLevel = null,
  requestPartySize = null,
  experiences = [],
  fulfillmentPolicy = null,
} = {}) {
  const active = experiences.filter((e) => e.active);
  const scored = active
    .map((experience) => {
      const { score, reasons } = scoreExperience({
        experience,
        requestAttributes,
        requestPartyType,
        requestPriceLevel,
        requestPartySize,
        fulfillmentPolicy,
      });
      return {
        experienceId: experience.id,
        title: experience.title,
        description: experience.description,
        score,
        reasons,
      };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, MAX_OFFER_SUGGESTIONS);
}

// "Intelligent demand inbox" plan (CLAUDE.md, Sep 3 2026), Phase 4(e) --
// closes Phase 3's own item-3 gap: when no existing Signature Experience
// matches an opportunity well, this is the real one-tap fallback -- a
// genuine offer-title scaffold built ONLY from two real, already-
// collected signals (the request's own occasion + category), never
// fabricated when either is missing. This is a TITLE only, never a
// price -- matches every other rule in this module and this schema's
// own "price is never guessed" convention: the owner always types their
// own real offer_price/description themselves; this just gives them
// something honest to start from instead of a blank field.
export function buildOfferTitleScaffold({ occasion = null, category = null } = {}) {
  if (!occasion || !category) return null;
  return `${occasionLabel(occasion)} ${category}`;
}

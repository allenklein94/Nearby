// An open business reply's card assembles itself (owner, 2026-10-09; replaces the two-beat OfferReveal). Pure decisions,
// kept here so they can be tested without rendering; components/OfferAssembly.js draws them.
//
// Order (only the steps the reply really carries; a missing one is skipped, never a gap or a placeholder):
//   business  "Coastal Coffee" (+ Our pick / its record)
//   heard     "Heard your request"           (true for every kind of reply)
//   status    what they actually said: "Made you an offer" / "Can take you" / "Suggested another time", from the ONE
//             item-121 rule (utils/offerCopy.js businessReplyKind), never re-decided here
//   order     the offer's title, description, included items, photo/video
//   price     the business's own price
//   when      proposed time, available window, valid until
import { offerPriceLabel } from './outcomeDisplay';
import { isOfferExpired } from './objectState';
import { SEQUENCES } from '../motion/motionBudget';

export const ASSEMBLY_STEPS = ['business', 'heard', 'status', 'order', 'price', 'when'];

const hasItems = (o) => (Array.isArray(o.included_items) ? o.included_items.length > 0 : Boolean(o.included_items));
const filled = (v) => v != null && String(v).trim() !== '';

export function assemblySteps(offer) {
  if (!offer) return [];
  const o = offer;
  const present = {
    business: true,
    heard: true,
    status: true,
    order: filled(o.offer_title) || filled(o.offer_description) || hasItems(o) || filled(o.media_path),
    price: offerPriceLabel(o.offer_price, o.price_is_per_person) != null,
    when: filled(o.proposed_time) || (filled(o.available_from) && filled(o.available_until)) || filled(o.valid_until),
  };
  return ASSEMBLY_STEPS.filter((k) => present[k]);
}

// When each step starts (ms after the assembly begins). A step the reply does not have = null (shown as is, never waited for).
export function stepDelay(steps, key, timing = SEQUENCES.offerAssembly) {
  const i = steps.indexOf(key);
  return i < 0 ? null : i * timing.staggerMs;
}

export function assemblyDurationMs(steps, timing = SEQUENCES.offerAssembly) {
  return steps.length === 0 ? 0 : (steps.length - 1) * timing.staggerMs + timing.stepMs;
}

// Assemble only a NEWLY received open reply, once: status offered, not expired, not yet seen by the person (viewed_at is
// the person's own read receipt, set the first time this screen shows it, so a revisit -- today or next week -- never
// replays), not already played in this session, and Reduce Motion off. Decided once when the card mounts.
const played = new Set();

export function shouldAssemble(offer, { reduceMotion = false, now = new Date(), playedIds = played } = {}) {
  if (!offer?.id || reduceMotion) return false;
  if (offer.status !== 'offered' || offer.viewed_at) return false;
  if (isOfferExpired(offer, now)) return false;
  return !playedIds.has(offer.id);
}

export function markAssembled(offerId, playedIds = played) {
  if (offerId) playedIds.add(offerId);
}

export function resetAssembledForTests() { played.clear(); }

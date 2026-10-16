// Owner item 63 (2026-10-12, LOCKED rules): the ONE rule for how a customer's open replies are ordered and which one is
// "Our pick". Hard constraints first, track record only as the tie-breaker (the ranking ladder's order), never price.
//
// A reply QUALIFIES when every hard constraint the customer explicitly stated is verified as met:
//   - time: the request's date and/or start time (business_requests.date / time_window_start; Ask a business stores a
//     single start, never an end).
//       * an alternate-time reply ('alt_time') meets it only when its own proposed_time IS that date (and that minute,
//         when a time was stated), on the device's local clock like every date in the app; a reply with two times
//         (item 119) meets it when either time does, and only that time carries "Fits" (fittingTime);
//       * a reply with an available window meets a stated time when the start is inside it (from <= start < until);
//       * any other reply the business itself sent ("Yes, you can host them as requested.") confirms the requested time;
//       * an automatic reply never checked a single stated time against the business's availability: unknown. That is a
//         reply made from a posted availability or a package (availability_id / package_id), or by a standing auto-accept
//         policy or AI auto-respond (auto_reply 'policy' | 'ai', migration 20270304). It stays listed; it cannot qualify
//         on time (and so cannot be "Our pick" on that basis).
//   - budget (only when the customer gave one): budget_max is per person (utils/budgetTier.js). A per-person price must be
//     <= it; a total price must be <= budget x party size, only when the party size is known; no price = unknown.
// Unknown never counts as met. Nothing stated = nothing to meet (every reply qualifies, as before item 63).
//
// Order: qualifying replies before the rest; inside each group an established record first, then the higher completion
// rate, then the list's existing order (getBusinessRequestWithOffers: created_at ascending, i.e. when the business's row was
// created -- for a fanned-out request, when it was ASKED, not when it replied; rows created together keep the order the
// database returned them in). No tie-breaker of its own. "Our pick" = the first reply, only when it qualifies, its business has an established record and
// at least two replies are open. Its reasons are only the stated constraints it met (time, then budget); none when nothing
// was stated. Nothing here changes how a card looks (item 17); a reply that does not qualify stays in the list.
import { hasEstablishedRecord } from './reliabilityRecord';
import { partyBudgetTotal } from './budgetTier';
import { offerTimes } from './offerTimes';

export const FIT = { FITS: 'fits', FAILS: 'fails', UNKNOWN: 'unknown' };

const minutesOf = (t) => {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(t ?? ''));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};
const localDayKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const validDate = (s) => (typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null);

// What the customer stated about WHEN: { date: 'YYYY-MM-DD' | null, startMin: minutes | null }, or null when nothing.
export function statedTime(request) {
  const date = validDate(request?.date);
  const startMin = minutesOf(request?.time_window_start);
  if (!date && startMin == null) return null;
  return { date, startMin };
}

// The stated budget per person, or null when none was given.
export function statedBudget(request) {
  const n = Number(request?.budget_max);
  return request?.budget_max != null && Number.isFinite(n) && n > 0 ? n : null;
}

// Whether one offered time IS the stated time: that local day (when a day was stated) and that minute (when a time was).
function timeIsStated(stated, iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return false;
  if (stated.date && localDayKey(d) !== stated.date) return false;
  if (stated.startMin != null && d.getHours() * 60 + d.getMinutes() !== stated.startMin) return false;
  return true;
}

// Item 119: on a two-time reply, the one time that matches what the customer stated (null when none does, when nothing
// was stated, or on a one-time reply). "Fits 7 PM" is shown only beside this time.
export function fittingTime(request, offer) {
  const stated = statedTime(request);
  if (!stated || offer?.offer_type !== 'alt_time') return null;
  const times = offerTimes(offer);
  if (times.length < 2) return null;
  return times.find((iso) => timeIsStated(stated, iso)) ?? null;
}

// fits | fails | unknown, or null when the customer stated no time.
export function replyTimeFit(request, offer) {
  const stated = statedTime(request);
  if (!stated) return null;
  if (offer?.availability_id || offer?.package_id || offer?.auto_reply) return FIT.UNKNOWN;
  if (offer?.offer_type === 'alt_time') {
    // Item 119: a reply with two times fits when either of them is the stated time.
    const times = offerTimes(offer);
    if (times.length === 0) return FIT.UNKNOWN;
    return times.some((iso) => timeIsStated(stated, iso)) ? FIT.FITS : FIT.FAILS;
  }
  const from = minutesOf(offer?.available_from);
  const until = minutesOf(offer?.available_until);
  if (from != null && until != null && stated.startMin != null) {
    return from <= stated.startMin && stated.startMin < until ? FIT.FITS : FIT.FAILS;
  }
  return FIT.FITS; // the business's own reply to this request, with no other time: "as requested"
}

// fits | fails | unknown, or null when the customer gave no budget.
export function replyBudgetFit(request, offer) {
  const budget = statedBudget(request);
  if (budget == null) return null;
  if (offer?.offer_price == null || offer?.offer_price === '') return FIT.UNKNOWN;
  const price = Number(offer.offer_price);
  if (!Number.isFinite(price) || price < 0) return FIT.UNKNOWN;
  if (offer.price_is_per_person) return price <= budget ? FIT.FITS : FIT.FAILS;
  const total = partyBudgetTotal(budget, request?.party_size);
  if (total == null) return FIT.UNKNOWN;
  return price <= total ? FIT.FITS : FIT.FAILS;
}

// { qualifies, reasons }: reasons are the stated constraints met, in order (time, budget), only when it qualifies.
// A time reason carries what was stated so the screen can say "Fits 7 PM" (or the day when only a day was stated).
export function replyMeetsRequest(request, offer) {
  const time = replyTimeFit(request, offer);
  const budget = replyBudgetFit(request, offer);
  const qualifies = (time == null || time === FIT.FITS) && (budget == null || budget === FIT.FITS);
  const reasons = [];
  if (qualifies && time === FIT.FITS) reasons.push({ kind: 'time', ...statedTime(request) });
  if (qualifies && budget === FIT.FITS) reasons.push({ kind: 'budget' });
  return { qualifies, time, budget, reasons };
}

// The customer's replies in display order + the pick. Only open ('offered') replies move, inside the slots they already
// hold, so every other row (waiting, accepted, declined...) keeps its place exactly as before.
export function rankReplies(offers, request, statsByPartner = {}) {
  const list = Array.isArray(offers) ? offers : [];
  const openIdx = [];
  list.forEach((o, i) => { if (o?.status === 'offered') openIdx.push(i); });
  const fitById = {};
  list.forEach((o) => { if (o?.status === 'offered') fitById[o.id] = replyMeetsRequest(request, o); });
  if (openIdx.length < 2) return { offers: list, pickOfferId: null, pickReasons: [], fitById };

  const record = (o) => {
    const rep = statsByPartner?.[o.partner_id]?.reputation;
    const established = hasEstablishedRecord(rep);
    return { established, rate: established ? Number(rep.completion_rate ?? -1) : null };
  };
  const ranked = openIdx
    .map((i, arrival) => ({ o: list[i], arrival }))
    .sort((a, b) => {
      const qa = fitById[a.o.id].qualifies;
      const qb = fitById[b.o.id].qualifies;
      if (qa !== qb) return qa ? -1 : 1;
      const ra = record(a.o);
      const rb = record(b.o);
      if (ra.established !== rb.established) return ra.established ? -1 : 1;
      if (ra.established && rb.rate !== ra.rate) return rb.rate - ra.rate;
      return a.arrival - b.arrival;
    })
    .map((x) => x.o);
  const result = [...list];
  openIdx.forEach((slot, k) => { result[slot] = ranked[k]; });

  const first = ranked[0];
  const isPick = fitById[first.id].qualifies && record(first).established;
  return { offers: result, pickOfferId: isPick ? first.id : null, pickReasons: isPick ? fitById[first.id].reasons : [], fitById };
}

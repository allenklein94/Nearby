// Item 119 (owner, 2026-10-16): the ONE client rule for the times a business reply offers. A reply has one time
// (proposed_time) or two (+ proposed_time_alt), both for the request's full party; the customer (or, in a group plan,
// every participant) picks one and accepting books exactly that time. The server's _offer_chosen_time is the authority
// (two times = a choice is required, it must be one of them and still ahead); this mirrors it so the card never offers
// a tap the server would refuse. After acceptance the offer carries one time again (proposed_time), so nothing past the
// accept needs this file.

const validIso = (v) => {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : v;
};
const sameInstant = (a, b) => !!a && !!b && new Date(a).getTime() === new Date(b).getTime();

// Every time the reply offers, in the business's order: [] | [first] | [first, second].
export function offerTimes(offer) {
  const first = validIso(offer?.proposed_time);
  if (!first) return [];
  const alt = validIso(offer?.proposed_time_alt);
  return alt && !sameInstant(alt, first) ? [first, alt] : [first];
}

export function hasTwoTimes(offer) {
  return offerTimes(offer).length === 2;
}

// The offered times that can still be booked (a passed time can't be picked).
export function choosableTimes(offer, now = new Date()) {
  const times = offerTimes(offer);
  if (times.length < 2) return times;
  return times.filter((iso) => new Date(iso).getTime() > now.getTime());
}

// Whether the person still has to pick between two times before "I'll take this one" can book.
export function needsTimePick(offer, now = new Date()) {
  return hasTwoTimes(offer) && choosableTimes(offer, now).length === 2;
}

// The time an accept sends (chosen_time_param): null for a one-time reply (nothing to choose; the server books its
// time), the picked time for a two-time reply, the only one left when the other has passed, or null when the person
// has not picked yet (the button waits). A pick that isn't one of the bookable times counts as no pick.
export function timeToBook(offer, picked, now = new Date()) {
  if (!hasTwoTimes(offer)) return null;
  const open = choosableTimes(offer, now);
  if (open.length === 1) return open[0];
  const match = open.find((iso) => sameInstant(iso, picked));
  return match ?? null;
}

// Whether accepting can go ahead with this pick.
export function canBookWith(offer, picked, now = new Date()) {
  if (!hasTwoTimes(offer)) return true;
  return timeToBook(offer, picked, now) != null;
}

// Group plans: what each participant confirmed on this offer. A two-time reply counts per time (it books only when
// everyone chose the same one); a one-time reply counts every confirmation, as before. `mine` = my chosen time (or true
// on a one-time reply when I confirmed), null when I haven't.
export function groupTimeConfirmations(offer, confirmations, myId) {
  const rows = (confirmations ?? []).filter((c) => c.offer_id === offer?.id);
  const mineRow = rows.find((c) => c.user_id === myId) ?? null;
  if (!hasTwoTimes(offer)) {
    return { total: rows.length, byTime: {}, mine: mineRow ? true : null };
  }
  const byTime = {};
  for (const iso of offerTimes(offer)) {
    byTime[iso] = rows.filter((c) => sameInstant(c.chosen_time, iso)).length;
  }
  const mine = mineRow ? offerTimes(offer).find((iso) => sameInstant(iso, mineRow.chosen_time)) ?? null : null;
  return { total: rows.length, byTime, mine };
}

// Item 119b (owner reopened the partial-party lock, 2026-10-16): the SECOND time may be for fewer people than the request
// (proposed_party_size_alt; null = the whole party). The first time is always the whole party, so a smaller time is never
// the only choice. Accepting the smaller time books that many (the server writes proposed_party_size).

const wholeNumber = (v) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null; };

// The headcount a time is offered for: a number only for the smaller second time, null = the request's whole party.
export function timePartySize(offer, iso) {
  const alt = validIso(offer?.proposed_time_alt);
  return alt && sameInstant(alt, iso) ? wholeNumber(offer?.proposed_party_size_alt) : null;
}

// Group plans never see the smaller time (owner LOCKED: Nearby never picks who stays home): the offer as a group reads it,
// the whole-party first time only. Every other reply is returned unchanged.
export function wholePartyView(offer) {
  if (!offer || wholeNumber(offer.proposed_party_size_alt) == null || !validIso(offer.proposed_time_alt)) return offer;
  return { ...offer, proposed_time_alt: null, proposed_party_size_alt: null };
}

export { sameInstant };

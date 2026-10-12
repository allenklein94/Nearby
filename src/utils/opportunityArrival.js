// Owner item 48 (2026-10-11): "signal received", the business's mirror of marketplace moment 1 (request sent). When an
// opportunity this business can still answer is on its dashboard for the first time (opened after it arrived, or arriving
// live while the dashboard is open), its card arrives with the same soft pulse the customer saw when sending it.
// The ONE rule for which cards play. Truth: only a real, stored, still-answerable opportunity row (canRespondToOpportunity),
// never a count, a guess or a push's wording; once per opportunity per device (persisted), never replayed by a reopen, a
// refresh, a duplicate realtime event or a later state change. Calm by design: at most ARRIVAL_MAX_PLAYS cards play per
// load, in the order shown, one after another; the rest are simply there. No sound, haptic, counter or streak.
import { canRespondToOpportunity } from './objectLifecycle';

export const ARRIVAL_MAX_PLAYS = 3;
export const arrivalKey = (o) => `arrived:${o.id}`;

// The opportunities on this load that have never arrived on this device (all of them are then remembered at once).
export function newArrivals(opportunities, shown = new Set(), now = new Date()) {
  return (opportunities ?? []).filter((o) => o?.id && canRespondToOpportunity(o, now) && !shown.has(arrivalKey(o)));
}

// Which displayed cards play, and their slot (0 = first): the first ARRIVAL_MAX_PLAYS arriving ones in display order.
export function arrivalSlots(displayed, arrivingIds, max = ARRIVAL_MAX_PLAYS) {
  const slots = new Map();
  for (const o of displayed ?? []) {
    if (slots.size >= max) break;
    if (o?.id && arrivingIds?.has(o.id)) slots.set(o.id, slots.size);
  }
  return slots;
}

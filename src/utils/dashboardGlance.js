import { canRespondToOpportunity } from './objectLifecycle';
import { isOfferExpired } from './objectState';
import { countLabel } from './plural';
import { offerPriceLabel } from './outcomeDisplay';

// Business Home "what can I act on right now" strip (owner items 41 + 41b). Every figure is a count of the owner's own
// real rows, and each block means what its label says:
//  * Today    -> new opportunities (open and still respondable right now) and CONFIRMED TODAY.
//  * Upcoming -> confirmed visits on a later day (or with no date recorded) and offers awaiting the customer's reply.
//  * This month -> the server's own billing estimate (the platform fee, itemized elsewhere).
// CONFIRMED = an accepted offer (status 'accepted': not completed, cancelled or declined). It counts as "today" only
// when its actual visit day is today, with the SAME precedence the Upcoming Visits list uses: the accepted alternative
// time (proposed_time), else the gathering's own start, else the request's calendar date. There is no business
// timezone in the data model (request dates are plain calendar dates, timestamps show in the viewer's local time), so
// "today" is the LOCAL calendar date of the device -- the same one every date label on this screen already uses.
// A visit whose day has passed but was never marked complete is in neither Today nor Upcoming. Zero is shown as a real
// zero under Today; Upcoming and This month appear only when they have something real to say (an unknown/failed
// billing lookup or a custom contract shows no amount, never $0).
export function localDayKey(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value; // plain calendar date
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function visitDayKey(o) {
  return localDayKey(o?.proposed_time) ?? localDayKey(o?.business_requests?.gatherings?.scheduled_at) ?? localDayKey(o?.business_requests?.date);
}

export function dashboardGlance(opportunities, owed, now = new Date()) {
  const list = opportunities ?? [];
  const todayKey = localDayKey(now);
  const newCount = list.filter((o) => canRespondToOpportunity(o)).length;
  const accepted = list.filter((o) => o.status === 'accepted');
  const confirmedToday = accepted.filter((o) => visitDayKey(o) === todayKey).length;
  const confirmedLater = accepted.filter((o) => { const k = visitDayKey(o); return k == null || k > todayKey; }).length;
  const awaiting = list.filter((o) => o.status === 'offered' && !isOfferExpired(o, now)).length;

  const today = [
    { key: 'new', text: `${newCount} new ${newCount === 1 ? 'opportunity' : 'opportunities'}`, section: 'requests', count: newCount },
    { key: 'confirmed', text: `${confirmedToday} confirmed today`, section: 'bookings', count: confirmedToday },
  ];

  const upcoming = [];
  if (confirmedLater > 0) upcoming.push({ key: 'later', text: `${confirmedLater} confirmed ${confirmedLater === 1 ? 'visit' : 'visits'} coming up`, section: 'bookings', count: confirmedLater });
  if (awaiting > 0) upcoming.push({ key: 'awaiting', text: `${awaiting} ${awaiting === 1 ? 'offer' : 'offers'} awaiting a reply`, section: 'requests', count: awaiting });

  const month = [];
  if (owed && owed.redemptionCount != null && Number.isFinite(Number(owed.redemptionCount))) {
    month.push({ key: 'redemptions', text: countLabel(Number(owed.redemptionCount), 'redemption') });
    const amount = owed.billingModel && owed.billingModel !== 'custom' ? offerPriceLabel(owed.estimatedAmount) : null;
    if (amount) month.push({ key: 'estimate', text: `${amount} estimated` });
  }
  return { today, upcoming, month };
}

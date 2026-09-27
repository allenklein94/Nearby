import { formatDateTime } from './timeLabels';
import { offerPriceLabel } from './outcomeDisplay';
import { businessReplyTitle, businessReplyKind } from './offerCopy';
import { requestLifecycleState, offerLifecycleState } from './objectLifecycle';

// Consumer-facing request status line (owner rule, item 39): Request sent -> <the reply> -> You're booked, then one Next line
// while the request is still actionable (item 122). The reply is named by its real kind through offerCopy.js (item 121):
// "Coastal Coffee can take you" / "...suggested another time" / "...made you an offer"; several = "3 businesses responded".
// Each step exists only when its real event happened (request created_at, an offer's responded_at, accepted_at); a
// missing timestamp drops the time, never invents one. Deliberately NO "viewed" step, no business viewer identity or
// count, and no requester identity: what a business did before responding is not shown to the consumer.
const OFFERED = ['offered', 'accepted', 'completed'];
const WON = ['accepted', 'completed'];

function earliest(list, field) {
  const times = list.map((o) => o[field]).filter((t) => t && !Number.isNaN(new Date(t).getTime()));
  return times.length ? times.reduce((a, b) => (new Date(a) <= new Date(b) ? a : b)) : null;
}

function offerDetail(o) {
  if (!o || businessReplyKind(o) !== 'offer') return null;
  if (o.discount_pct != null && Number(o.discount_pct) > 0) return `${Number(o.discount_pct)}% off`;
  return offerPriceLabel(o.offer_price, !!o.price_is_per_person) || (o.offer_title || null);
}

export function requestTimeline(request, offers) {
  if (!request) return [];
  const list = offers ?? [];
  const steps = [{ key: 'sent', label: 'Request sent', detail: null, at: formatDateTime(request.created_at) }];

  const offered = list.filter((o) => OFFERED.includes(o.status));
  if (offered.length > 0) {
    const first = [...offered].sort((a, b) => new Date(a.responded_at ?? a.created_at) - new Date(b.responded_at ?? b.created_at))[0];
    steps.push({
      key: 'offer_received',
      label: offered.length > 1 ? `${offered.length} businesses responded` : businessReplyTitle(first.brand_partners?.name, first),
      detail: offered.length === 1 ? offerDetail(first) : null,
      at: formatDateTime(earliest(offered, 'responded_at')),
    });
  }

  const won = list.filter((o) => WON.includes(o.status));
  if (won.length > 0) {
    steps.push({ key: 'accepted', label: "You're booked", detail: null, at: formatDateTime(earliest(won, 'accepted_at')) });
  }
  return steps;
}

export function timelineStepLine(step) {
  return [step.detail, step.at].filter(Boolean).join(' · ') || null;
}

// Item 122: what happens next, only while the request is still actionable. Booked / expired / cancelled / merged get none
// (the header or banner already says so). A reply still counts only while it can be accepted (an offer past its own
// valid_until does not). A group-plan request is chosen with the group, so its line says so.
export function requestNextStep(request, offers, now = new Date()) {
  if (requestLifecycleState(request, now) !== 'open') return null;
  const live = (offers ?? []).filter((o) => offerLifecycleState(o, now) === 'offered');
  if (live.length === 0) return "We'll let you know when a business responds.";
  return request.group_plan_id ? 'Pick one to confirm with your group.' : 'Pick one to book it.';
}

// The line right after sending (AskBusiness and the other creators land here with justSubmitted).
export function justSentLine(notifiedCount) {
  if (!(notifiedCount > 0)) return null;
  return `We asked ${notifiedCount} nearby business${notifiedCount === 1 ? '' : 'es'}. You'll be notified when they respond.`;
}

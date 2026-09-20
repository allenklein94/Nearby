import { formatDateTime } from './timeLabels';
import { offerPriceLabel } from './outcomeDisplay';

// Consumer-facing request status line (owner rule, item 39): Request sent -> Offer received -> Offer accepted.
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
  if (!o) return null;
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
      label: offered.length > 1 ? `${offered.length} offers received` : 'Offer received',
      detail: offered.length === 1 ? offerDetail(first) : null,
      at: formatDateTime(earliest(offered, 'responded_at')),
    });
  }

  const won = list.filter((o) => WON.includes(o.status));
  if (won.length > 0) {
    steps.push({ key: 'accepted', label: 'Offer accepted', detail: null, at: formatDateTime(earliest(won, 'accepted_at')) });
  }
  return steps;
}

export function timelineStepLine(step) {
  return [step.detail, step.at].filter(Boolean).join(' · ') || null;
}

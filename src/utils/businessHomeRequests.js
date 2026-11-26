// Owner, 2026-11-22: business Home previews the business's actual requests (up to 3), not just a count.
// ONE rule for which rows show; nothing here decides a request's state itself:
//   * a row = a request this business can answer right now = the pipeline's New stage (`isPipelineNew`: offer row
//     pending, request open and before its own deadline, not a reply Nearby is still checking), the same rule as the
//     Opportunities tile's "N new requests" count, so the preview and the count can never disagree;
//   * only rows of the location the dashboard is showing (`partner_id`), never another location's (multi-location);
//   * in the order Opportunities lists them (the caller passes its already-scored list), first 3;
//   * the words = the Opportunity card's own title + who/when line (`buildOpportunityCard`: category, party size, day,
//     time; structured fields only, never the customer's typed words, name or identity);
//   * nothing loaded / failed / none open = no rows (the section is hidden, never a placeholder or "0").
// A request that expires drops out at its deadline (`nextHomeRequestChangeAt` + startDeadlineClock); one that is booked,
// cancelled, answered or newly arrived changes the list on the dashboard's existing (live) reload.
import { isPipelineNew, reviewingRequestIds } from './businessPipeline';
import { buildOpportunityCard } from './businessOpportunityCard';

export const HOME_REQUEST_MAX = 3;

function openRows(opportunities, { submissions = [], partnerId, now = new Date() } = {}) {
  if (!partnerId) return [];
  const reviewing = reviewingRequestIds(submissions);
  return (opportunities ?? []).filter((o) => o && o.partner_id === partnerId && isPipelineNew(o, reviewing, now));
}

// -> { rows: [opportunity row, ...] (max 3), total } ; total = every open request (the "N new requests" heading).
export function homeRequestPreview(opportunities, { submissions = [], partnerId, loaded, now = new Date(), max = HOME_REQUEST_MAX } = {}) {
  if (loaded !== true) return { rows: [], total: 0 };
  const open = openRows(opportunities, { submissions, partnerId, now });
  return { rows: open.slice(0, max), total: open.length };
}

// The next instant an open request stops being answerable (its own deadline), or null. Re-arming after each change lets
// the 4th request move up when one of the first 3 expires.
export function nextHomeRequestChangeAt(opportunities, { submissions = [], partnerId, now = Date.now() } = {}) {
  const nowMs = typeof now === 'number' ? now : now.getTime();
  let best = null;
  for (const o of openRows(opportunities, { submissions, partnerId, now: new Date(nowMs) })) {
    const at = o.business_requests?.expires_at ? new Date(o.business_requests.expires_at).getTime() : null;
    if (Number.isFinite(at) && at > nowMs && (best == null || at < best)) best = at;
  }
  return best;
}

// One preview row's words, from the Opportunity card's own builder. `categoryLabel` = the category in the viewer's
// language (the caller translates it, as the Opportunities card does).
export function homeRequestRow(o, { categoryLabel = null } = {}) {
  const card = buildOpportunityCard(o?.business_requests, { categoryLabel });
  return { key: o?.id ?? o?.request_id, requestId: o?.request_id, title: card.title, line: card.whenLine };
}

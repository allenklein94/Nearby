// Admin offer history (20270416, owner idea 39): one line per offer from admin_business_offer_history, business side only.
// Every step shown is a stored time; a missing step shows nothing (never guessed). Kept = the offer row is gone (its customer
// or the business was deleted) and Nearby kept the business side because a report, case or hold covered it.
const SCREENING = { low: 'Screened: passed', medium: 'Screened: held for review', high: 'Screened: blocked', automatic: 'Automatic reply (not screened)' };

const day = (t) => (t ? new Date(t).toLocaleDateString() : null);

export function offerHistorySteps(row) {
  if (!row) return [];
  const steps = [];
  if (row.created_at) steps.push(`Created ${day(row.created_at)}`);
  steps.push(row.screening ? SCREENING[row.screening] ?? `Screened: ${row.screening}` : 'Screening: no record');
  if (row.viewed_at) steps.push(`Viewed ${day(row.viewed_at)}`);
  if (row.accepted_at) steps.push(`Accepted ${day(row.accepted_at)}`);
  if (row.completed_at) steps.push(`Redeemed ${day(row.completed_at)}`);
  if (row.cancelled_at) steps.push(`Cancelled ${day(row.cancelled_at)}`);
  return steps;
}

export function offerHistoryTitle(row) {
  const what = (row?.offer_title || row?.offer_description || 'Offer').trim();
  const short = what.length > 80 ? `${what.slice(0, 79)}…` : what;
  const tags = [row?.source === 'kept' ? 'kept after deletion' : null, row?.reported ? 'reported' : null].filter(Boolean);
  return tags.length ? `${short} (${tags.join(', ')})` : short;
}

// Before 20270416 is live the function doesn't exist (PGRST202): treated as "nothing to show", never an error.
export function historyUnavailable(error) {
  return error?.code === 'PGRST202';
}

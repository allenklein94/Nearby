// State-machine audit gap 6: "nobody is available" is derived from real offer rows, never stored -- the request is still
// open, at least one business actually passed (declined/withdrew), and no offer is live or won. Mirrors the server-side
// check in decline_business_offer (which sends the one push).
const PASSED = ['declined', 'withdrawn'];
const DEAD = ['declined', 'withdrawn', 'expired', 'cancelled'];

export function isAllDeclined(request, offers) {
  if (!request || request.status !== 'open' || !offers || offers.length === 0) return false;
  return offers.every((o) => DEAD.includes(o.status)) && offers.some((o) => PASSED.includes(o.status));
}

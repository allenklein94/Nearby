// Item 128 (owner, 2026-10-16): business Home's "N people are looking for something nearby that you offer" and
// "Your best opportunity" read get_aggregated_demand_for_partner (migration 20270316) through this ONE split.
//   categories    the per-category rows (Match Radar, demand gaps): category NOT null, unchanged.
//   offeredPeople distinct people with an open nearby request in the business's OWN primary/secondary categories, from
//                 the server's summary row (category null). The server sends it only at >= demand_min_people() and
//                 never for a business with no declared category; absent = null (no line, never 0 or a sum).
//   best          the largest category row the business offers (is_offered), or null. Never a category it doesn't offer.
export function splitAggregatedDemand(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const categories = list.filter((r) => r && r.category != null);
  const summary = list.find((r) => r && r.category == null);
  const n = Number(summary?.offered_people);
  const offeredPeople = Number.isInteger(n) && n > 0 ? n : null;
  const best = categories
    .filter((r) => r.is_offered === true && Number(r.request_count) > 0)
    .sort((a, b) => Number(b.request_count) - Number(a.request_count))[0] ?? null;
  return { categories, offeredPeople, best };
}
